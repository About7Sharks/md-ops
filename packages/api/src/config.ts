/** Runtime configuration validation for md-ops-api. */

import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "fs";
import { isAbsolute, parse, relative, resolve, sep } from "path";

export const ROOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface RootConfig {
  id: string;
  path: string;
  label?: string;
  home?: string;
}

export interface RuntimeConfig {
  roots: RootConfig[];
  mutationsEnabled: boolean;
}

export interface ServerBinding {
  host: string;
  port: number;
}

export type ConfigValidation =
  | { ok: true; config: RuntimeConfig }
  | { ok: false; code: "roots_not_configured" | "roots_invalid_json" | "roots_invalid" | "root_unavailable" };

type Environment = Record<string, string | undefined>;

export function serverBinding(env: Environment = process.env): ServerBinding {
  const host = env.HOST?.trim() || "127.0.0.1";
  const rawPort = env.PORT?.trim() || "3098";
  if (!/^[A-Za-z0-9.:[\]_-]+$/.test(host) || host.length > 253) {
    throw new Error("Invalid HOST configuration");
  }
  if (!/^\d{1,5}$/.test(rawPort)) throw new Error("Invalid PORT configuration");
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT configuration");
  return { host, port };
}

export function mutationsEnabled(env: Environment = process.env): boolean {
  return env.MD_OPS_ALLOW_MUTATIONS === "true";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("invalid label");
  const label = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!label || label.length > 120 || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new Error("invalid label");
  }
  return label;
}

function sanitizeLogicalHome(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("invalid home");
  const home = value.normalize("NFC").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !home ||
    home.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(home) ||
    home.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !/\.m(?:d|md|ermaid)$/i.test(home)
  ) {
    throw new Error("invalid home");
  }
  return home;
}

function containsPath(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Validates MD_OPS_ROOTS without retaining raw configuration values in errors.
 * The returned paths are real, absolute directories that this process can read
 * and write only when MD_OPS_ALLOW_MUTATIONS=true. Read-only mode requires
 * only read access and is the safe default for a fresh installation.
 */
export function validateRuntimeConfig(env: Environment = process.env): ConfigValidation {
  const raw = env.MD_OPS_ROOTS;
  if (!raw || !raw.trim()) return { ok: false, code: "roots_not_configured" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "roots_invalid_json" };
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 32) {
    return { ok: false, code: "roots_invalid" };
  }

  const ids = new Set<string>();
  const roots: RootConfig[] = [];
  const allowMutations = mutationsEnabled(env);
  try {
    for (const candidate of parsed) {
      if (!isRecord(candidate)) throw new Error("invalid root");
      if (!Object.keys(candidate).every((key) => key === "id" || key === "path" || key === "label" || key === "home")) {
        throw new Error("unknown root field");
      }

      const { id, path } = candidate;
      if (typeof id !== "string" || id !== id.trim() || !ROOT_ID_PATTERN.test(id) || ids.has(id)) {
        throw new Error("invalid root id");
      }
      if (typeof path !== "string" || path !== path.trim() || !isAbsolute(path)) {
        throw new Error("invalid root path");
      }

      const realPath = realpathSync(path);
      if (!statSync(realPath).isDirectory()) throw new Error("root is not a directory");
      if (realPath === parse(realPath).root) throw new Error("filesystem root is too broad");
      if (roots.some((root) => containsPath(root.path, realPath) || containsPath(realPath, root.path))) {
        throw new Error("overlapping roots are not supported");
      }
      accessSync(realPath, constants.R_OK);
      if (allowMutations) accessSync(realPath, constants.W_OK);

      ids.add(id);
      const label = sanitizeLabel(candidate.label);
      const home = sanitizeLogicalHome(candidate.home);
      if (home !== undefined) {
        const homePath = resolve(realPath, home);
        const realHomePath = realpathSync(homePath);
        if (!containsPath(realPath, realHomePath) || !statSync(realHomePath).isFile()) {
          throw new Error("home is unavailable");
        }
        accessSync(realHomePath, constants.R_OK);
      }
      roots.push({ id, path: realPath, ...(label === undefined ? {} : { label }), ...(home === undefined ? {} : { home }) });
    }
  } catch {
    return { ok: false, code: "root_unavailable" };
  }

  return { ok: true, config: { roots, mutationsEnabled: allowMutations } };
}

/** Fail startup before the server can accept requests with an invalid allowlist. */
export function requireRuntimeConfig(env: Environment = process.env): RuntimeConfig {
  const result = validateRuntimeConfig(env);
  if (!result.ok) throw new Error(`Invalid MD_OPS_ROOTS configuration (${result.code})`);
  return result.config;
}

function bundledUiReady(): boolean {
  try {
    const uiRoot = resolve(import.meta.dir, "../ui");
    const indexPath = resolve(uiRoot, "index.html");
    if (!existsSync(indexPath)) return false;
    const html = readFileSync(indexPath, "utf8");
    const assets = [...html.matchAll(/(?:src|href)=["']\.\/assets\/([^"']+)["']/g)].map((match) => match[1]);
    return assets.length > 0 && assets.every((asset) => existsSync(resolve(uiRoot, "assets", asset!)));
  } catch {
    return false;
  }
}

export function readiness():
  | { ready: true; roots: Array<Pick<RootConfig, "id" | "label" | "home">>; writes: "enabled" | "disabled"; ui: "bundled" }
  | { ready: false } {
  const result = validateRuntimeConfig();
  if (!result.ok || !bundledUiReady()) return { ready: false };
  return {
    ready: true,
    roots: result.config.roots.map(({ id, label, home }) => ({
      id,
      ...(label === undefined ? {} : { label }),
      ...(home === undefined ? {} : { home }),
    })),
    writes: result.config.mutationsEnabled ? "enabled" : "disabled",
    ui: "bundled",
  };
}
