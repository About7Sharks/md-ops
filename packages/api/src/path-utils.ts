/**
 * Path validation and allowlist resolution for md-ops-api.
 * Blocks: .., absolute paths, symlink escapes. Markdown endpoints only allow .md/.mmd/.mermaid;
 * read-only asset endpoints allow common raster image extensions.
 */

import { isAbsolute, resolve, relative, sep } from "path";
import { realpathSync, existsSync, readdirSync } from "fs";
import { validateRuntimeConfig, type RootConfig } from "./config";

const MARKDOWN_EXT = [".md", ".mmd", ".mermaid"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp"];
const TEXT_PREVIEW_EXT = [
  ...MARKDOWN_EXT,
  ".txt", ".json", ".jsonl", ".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".sh", ".yml", ".yaml",
  ".xml", ".csv", ".srt", ".log", ".plist", ".toml", ".ini", ".conf", ".excalidraw", ".canvas", ".base",
];
const ALLOWED_EXT_MESSAGE = "only .md, .mmd, or .mermaid files allowed";
const ALLOWED_IMAGE_EXT_MESSAGE = "only image files allowed (.png, .jpg, .jpeg, .gif, .webp, .avif, .bmp)";
const ALLOWED_TEXT_EXT_MESSAGE = "only markdown or safe text-preview files allowed";

export type { RootConfig } from "./config";

/** Returns strictly validated runtime roots, or no roots before a failed startup. */
export function getRoots(): RootConfig[] {
  const result = validateRuntimeConfig();
  return result.ok ? result.config.roots : [];
}

export type ValidationResult =
  | { ok: true; absolutePath: string; requestedPath: string; rootId: string }
  | { ok: false; status: number; message: string };

export type FolderValidationResult =
  | { ok: true; absolutePath: string; requestedPath: string; rootId: string; logicalPath: string }
  | { ok: false; status: number; message: string };

function isInsideRoot(rootReal: string, candidateReal: string): boolean {
  const rel = relative(rootReal, candidateReal);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Validates that path has an allowed markdown extension (.md, .mmd, or .mermaid).
 */
function hasAllowedExtension(p: string, allowedExt: string[]): boolean {
  const lower = p.toLowerCase();
  return allowedExt.some((ext) => lower === ext || lower.endsWith(ext));
}

export function hasAllowedExt(p: string): boolean {
  return hasAllowedExtension(p, MARKDOWN_EXT);
}

export function hasAllowedImageExt(p: string): boolean {
  return hasAllowedExtension(p, IMAGE_EXT);
}

export function hasAllowedTextPreviewExt(p: string): boolean {
  const lower = p.toLowerCase();
  return hasAllowedExtension(lower, TEXT_PREVIEW_EXT) || /\.md\.bak$/.test(lower);
}

function resolveAndValidateWithExt(
  roots: RootConfig[],
  rootId: string,
  logicalPath: string,
  hasAllowed: (path: string) => boolean,
  allowedMessage: string
): ValidationResult {
  if (!logicalPath || typeof logicalPath !== "string") {
    return { ok: false, status: 400, message: "path is required" };
  }

  // Block absolute paths and path traversal in input
  const normalized = logicalPath.replace(/\\/g, "/").trim();
  const pathSegments = normalized.split("/").filter(Boolean);
  if (normalized.startsWith("/") || pathSegments.includes("..")) {
    return { ok: false, status: 400, message: "path traversal or absolute path not allowed" };
  }

  const root = roots.find((r) => r.id === rootId);
  if (!root) {
    return { ok: false, status: 404, message: "root not found" };
  }

  const rootAbs = resolve(root.path);
  if (!existsSync(rootAbs)) {
    return { ok: false, status: 500, message: "root directory not accessible" };
  }

  const joined = resolve(rootAbs, normalized);
  if (!isInsideRoot(rootAbs, joined)) {
    return { ok: false, status: 403, message: "path outside allowlisted root" };
  }

  // Resolve symlinks so we stay within real root
  let realJoined: string;
  try {
    realJoined = realpathSync(joined);
  } catch {
    // File or parent dir may not exist yet (write). Walk up and resolve first existing ancestor;
    // must be under real root (catches symlink escape).
    let dir = resolve(joined, "..");
    const rootReal = realpathSync(rootAbs);
    for (;;) {
      try {
        const realDir = realpathSync(dir);
        if (!isInsideRoot(rootReal, realDir)) {
          return { ok: false, status: 403, message: "path outside allowlisted root" };
        }
        if (!hasAllowed(joined)) {
          return { ok: false, status: 400, message: allowedMessage };
        }
        return { ok: true, absolutePath: joined, requestedPath: joined, rootId };
      } catch {
        const parent = resolve(dir, "..");
        if (parent === dir) break;
        dir = parent;
      }
    }
    return { ok: false, status: 403, message: "path outside allowlisted root" };
  }

  const realRoot = realpathSync(rootAbs);
  if (!isInsideRoot(realRoot, realJoined)) {
    return { ok: false, status: 403, message: "path outside allowlisted root" };
  }

  if (!hasAllowed(joined)) {
    return { ok: false, status: 400, message: allowedMessage };
  }

  return { ok: true, absolutePath: realJoined, requestedPath: joined, rootId };
}

/**
 * Resolves and validates a markdown path against an allowlisted root.
 * - Rejects .., absolute input paths, and paths that resolve outside root (symlink escape).
 * - Only allows .md, .mmd, and .mermaid files.
 */
export function resolveAndValidate(
  roots: RootConfig[],
  rootId: string,
  logicalPath: string
): ValidationResult {
  return resolveAndValidateWithExt(roots, rootId, logicalPath, hasAllowedExt, ALLOWED_EXT_MESSAGE);
}

/** Resolve a read-only image asset path against an allowlisted root. */
export function resolveAndValidateImage(
  roots: RootConfig[],
  rootId: string,
  logicalPath: string
): ValidationResult {
  return resolveAndValidateWithExt(roots, rootId, logicalPath, hasAllowedImageExt, ALLOWED_IMAGE_EXT_MESSAGE);
}

/** Resolve a read-only text/code/data preview path against an allowlisted root. */
export function resolveAndValidateTextPreview(
  roots: RootConfig[],
  rootId: string,
  logicalPath: string
): ValidationResult {
  return resolveAndValidateWithExt(roots, rootId, logicalPath, hasAllowedTextPreviewExt, ALLOWED_TEXT_EXT_MESSAGE);
}

export function resolveAndValidateFolder(
  roots: RootConfig[],
  rootId: string,
  logicalPath: string
): FolderValidationResult {
  if (!logicalPath || typeof logicalPath !== "string") {
    return { ok: false, status: 400, message: "folder path is required" };
  }

  const raw = logicalPath.replace(/\\/g, "/").trim();
  const normalized = raw.replace(/\/+$/g, "");
  const pathSegments = normalized.split("/").filter(Boolean);
  if (!normalized || normalized.startsWith("/") || pathSegments.includes("..") || pathSegments.includes(".")) {
    return { ok: false, status: 400, message: "path traversal, absolute path, or . segments not allowed" };
  }

  const root = roots.find((r) => r.id === rootId);
  if (!root) {
    return { ok: false, status: 404, message: "root not found" };
  }

  const rootAbs = resolve(root.path);
  if (!existsSync(rootAbs)) {
    return { ok: false, status: 500, message: "root directory not accessible" };
  }

  const joined = resolve(rootAbs, normalized);
  if (!isInsideRoot(rootAbs, joined)) {
    return { ok: false, status: 403, message: "path outside allowlisted root" };
  }

  const rootReal = realpathSync(rootAbs);
  try {
    const realJoined = realpathSync(joined);
    if (!isInsideRoot(rootReal, realJoined)) {
      return { ok: false, status: 403, message: "path outside allowlisted root" };
    }
    return { ok: true, absolutePath: realJoined, requestedPath: joined, rootId, logicalPath: normalized };
  } catch {
    let dir = resolve(joined, "..");
    for (;;) {
      try {
        const realDir = realpathSync(dir);
        if (!isInsideRoot(rootReal, realDir)) {
          return { ok: false, status: 403, message: "path outside allowlisted root" };
        }
        return { ok: true, absolutePath: joined, requestedPath: joined, rootId, logicalPath: normalized };
      } catch {
        const parent = resolve(dir, "..");
        if (parent === dir) break;
        dir = parent;
      }
    }
  }

  return { ok: false, status: 403, message: "path outside allowlisted root" };
}

const SKIP_DIRS = new Set([
  "node_modules", "packages", ".venv", ".venvs", ".pytest_cache", "dist-info",
  ".git", "__pycache__", ".mypy_cache", ".tox", "dist", "build",
]);

/**
 * List .md/.mmd/.mermaid files under a root (for tree). Rejects paths outside root.
 * Skips common noise directories (node_modules, .venv/.venvs, etc.).
 */
export function listMdUnderRoot(rootAbs: string, dirPath: string): string[] {
  const rootReal = realpathSync(resolve(rootAbs));
  const resolved = resolve(rootAbs, dirPath);
  const realResolved = realpathSync(resolved);
  if (!isInsideRoot(rootReal, realResolved)) {
    return [];
  }
  const entries = readdirSync(resolved, { withFileTypes: true });
  const out: string[] = [];
  const rootResolved = resolve(rootAbs);
  for (const e of entries) {
    const full = resolve(resolved, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...listMdUnderRoot(rootAbs, relative(rootResolved, full)));
    } else if (e.isFile() && hasAllowedExt(e.name)) {
      out.push(relative(resolve(rootAbs), full));
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const SKIP_FILE_NAMES = new Set([
  ".env", ".env.local", ".env.production", ".env.development", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
]);
const SKIP_FILE_EXT = new Set([".pem", ".key", ".p12", ".pfx"]);

function shouldSkipFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (SKIP_FILE_NAMES.has(lower)) return true;
  return [...SKIP_FILE_EXT].some((ext) => lower.endsWith(ext));
}

/**
 * List all non-secret files under a root (for tree visibility). Rejects paths outside root.
 * Skips common noise directories and obvious secret-bearing file names/extensions.
 */
export function listFilesUnderRoot(rootAbs: string, dirPath: string): string[] {
  const rootReal = realpathSync(resolve(rootAbs));
  const resolved = resolve(rootAbs, dirPath);
  const realResolved = realpathSync(resolved);
  if (!isInsideRoot(rootReal, realResolved)) {
    return [];
  }
  const entries = readdirSync(resolved, { withFileTypes: true });
  const out: string[] = [];
  const rootResolved = resolve(rootAbs);
  for (const e of entries) {
    const full = resolve(resolved, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...listFilesUnderRoot(rootAbs, relative(rootResolved, full)));
    } else if (e.isFile() && !shouldSkipFile(e.name)) {
      out.push(relative(rootResolved, full));
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function listFoldersUnderRoot(rootAbs: string, dirPath: string): string[] {
  const rootReal = realpathSync(resolve(rootAbs));
  const resolved = resolve(rootAbs, dirPath);
  const realResolved = realpathSync(resolved);
  if (!isInsideRoot(rootReal, realResolved)) {
    return [];
  }
  const entries = readdirSync(resolved, { withFileTypes: true });
  const out: string[] = [];
  const rootResolved = resolve(rootAbs);
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    const full = resolve(resolved, e.name);
    const rel = relative(rootResolved, full);
    out.push(rel);
    out.push(...listFoldersUnderRoot(rootAbs, rel));
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
