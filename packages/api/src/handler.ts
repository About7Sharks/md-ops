/**
 * Request handler for md-ops-api (no server). Used by index and by tests.
 */

import { resolve, relative, sep } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, renameSync, unlinkSync, rmSync, lstatSync } from "fs";
import {
  getRoots,
  resolveAndValidate,
  resolveAndValidateFolder,
  resolveAndValidateImage,
  resolveAndValidateTextPreview,
  listMdUnderRoot,
  listFilesUnderRoot,
  listFoldersUnderRoot,
} from "./path-utils";
import { mutationsEnabled, readiness } from "./config";
import { MAX_RETRIEVE_QUERY_LENGTH, parseRetrieveLimit, qmdCollectionForRoot, QmdUnavailableError, retrieveWithQmd } from "./qmd";
import { logWrite } from "./audit";
import { extractMermaidBlocks } from "./mermaid";

const WRITE_CONFIRM_HEADER = "x-confirm-write";
const IF_MATCH_HEADER = "if-match";
const IF_NONE_MATCH_HEADER = "if-none-match";
const READ_ONLY_ALLOWED_METHODS = ["GET"];
const FOLDER_ALLOWED_METHODS = ["PUT", "PATCH", "DELETE"];
const ASSET_ALLOWED_METHODS = ["GET", "HEAD"];
const FILE_ALLOWED_METHODS = ["GET", "HEAD", "PUT", "DELETE"];

/** Compute weak ETag from mtime + size for conflict detection. */
function fileEtag(absolutePath: string): string {
  const st = statSync(absolutePath);
  return `W/"${st.mtimeMs}-${st.size}"`;
}

function json(body: unknown, res: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...res,
    headers: { "Content-Type": "application/json", ...(res.headers ?? {}) },
  });
}

function methodNotAllowed(allowedMethods: string[]) {
  return json(
    { error: "method not allowed", allowed: allowedMethods },
    { status: 405, headers: { Allow: allowedMethods.join(", ") } }
  );
}

function mutationsNotEnabled() {
  return json(
    { error: "mutations are disabled; set MD_OPS_ALLOW_MUTATIONS=true only for a trusted local service" },
    { status: 403 }
  );
}

function parseSearchLimit(raw: string | null): number {
  const fallback = 30;
  const parsed = raw == null ? fallback : parseInt(raw, 10);
  if (!isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 100);
}

function staticContentType(pathname: string): string {
  if (pathname.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
  if (pathname.endsWith('.html')) return 'text/html; charset=utf-8';
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.gif')) return 'image/gif';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.avif')) return 'image/avif';
  if (pathname.endsWith('.bmp')) return 'image/bmp';
  if (pathname.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

function hasMarkdownExtension(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.mmd') || lower.endsWith('.mermaid');
}

function getWho(req: Request): string {
  return req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "anonymous";
}

const DEFAULT_TRUSTED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function canonicalRequestHost(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

/**
 * Restrict browser-visible requests to explicit hostnames. Loopback binding is
 * not sufficient on its own because a hostile site can use DNS rebinding to
 * make its own origin resolve to 127.0.0.1.
 */
export function isTrustedRequestHost(req: Request, env: Record<string, string | undefined> = process.env): boolean {
  let requestHost: string;
  try {
    requestHost = canonicalRequestHost(new URL(req.url).hostname);
  } catch {
    return false;
  }

  const trusted = new Set(DEFAULT_TRUSTED_HOSTS);
  for (const raw of (env.MD_OPS_TRUSTED_HOSTS ?? "").split(",")) {
    const host = canonicalRequestHost(raw);
    if (host && /^[a-z0-9._:-]{1,253}$/.test(host)) trusted.add(host);
  }
  return trusted.has(requestHost);
}

type GraphNode = { id: string; type: string; label: string; props?: Record<string, unknown> };
type GraphEdge = { from: string; to: string; type: string };

function parseWikilinkTargets(markdown: string): string[] {
  const matches = markdown.matchAll(/\[\[([^\]]+)\]\]/g);
  const targets = new Set<string>();
  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const target = raw.split("|")[0]?.split("#")[0]?.trim();
    if (!target) continue;
    targets.add(target);
  }
  return [...targets];
}

type LogicalWikilinkLookup = {
  orderByFile: Map<string, number>;
  exactByPath: Map<string, string>;
  suffixByPath: Map<string, string>;
  basename: Map<string, string>;
};

function recordFirstSorted(map: Map<string, string>, key: string, file: string): void {
  if (!map.has(key)) map.set(key, file);
}

function buildLogicalWikilinkLookup(files: string[]): LogicalWikilinkLookup {
  const orderByFile = new Map<string, number>();
  const exactByPath = new Map<string, string>();
  const suffixByPath = new Map<string, string>();
  const basename = new Map<string, string>();

  // files is already lexically sorted. Recording only the first occurrence
  // preserves the legacy full-list scan's deterministic winner selection.
  for (const [order, file] of files.entries()) {
    const logical = file.toLowerCase();
    const segments = logical.split('/');
    orderByFile.set(file, order);
    recordFirstSorted(exactByPath, logical, file);
    recordFirstSorted(basename, segments[segments.length - 1]!, file);
    // A suffix match required a preceding slash in the old scan, so only
    // retain proper suffixes rather than the complete logical path.
    for (let start = 1; start < segments.length; start += 1) {
      recordFirstSorted(suffixByPath, segments.slice(start).join('/'), file);
    }
  }

  return { orderByFile, exactByPath, suffixByPath, basename };
}

function firstSortedCandidate(candidates: string[], lookup: Map<string, string>, orderByFile: Map<string, number>): string | null {
  let winner: string | null = null;
  let winnerOrder = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const file = lookup.get(candidate);
    if (!file) continue;
    const order = orderByFile.get(file);
    if (order !== undefined && order < winnerOrder) {
      winner = file;
      winnerOrder = order;
    }
  }
  return winner;
}

function resolveWikilinkTarget(target: string, lookup: LogicalWikilinkLookup): string | null {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return null;
  const exactCandidates = [normalized, normalized.endsWith('.md') ? normalized : `${normalized}.md`];

  return firstSortedCandidate(exactCandidates, lookup.exactByPath, lookup.orderByFile)
    ?? firstSortedCandidate(exactCandidates, lookup.suffixByPath, lookup.orderByFile)
    ?? firstSortedCandidate(exactCandidates, lookup.basename, lookup.orderByFile);
}

/**
 * A short-lived, per-root graph index. It deliberately contains only logical
 * relative paths and resolved logical targets: never root paths or document
 * bodies. API-owned writes invalidate the affected entry immediately; the TTL
 * bounds staleness from editors or other processes that write outside the API.
 */
type LogicalGraphIndex = {
  expiresAt: number;
  files: string[];
  wikilinkLookup: LogicalWikilinkLookup;
  resolvedTargetsByFile: Map<string, string[]>;
};

const GRAPH_INDEX_TTL_MS = 5_000;
const logicalGraphIndexes = new Map<string, LogicalGraphIndex>();

function buildLogicalGraphIndex(root: { path: string }): LogicalGraphIndex {
  // listMdUnderRoot returns a stable lexical sort. Keep that order so target
  // selection remains exact, suffix, then basename with first-sorted wins.
  const files = listMdUnderRoot(root.path, ".");
  const fileSet = new Set(files);
  const wikilinkLookup = buildLogicalWikilinkLookup(files);
  const resolvedTargetsByFile = new Map<string, string[]>();

  for (const rel of files) {
    try {
      const targets = parseWikilinkTargets(readFileSync(resolve(root.path, rel), "utf8"));
      const resolvedTargets: string[] = [];
      for (const target of targets) {
        const resolved = resolveWikilinkTarget(target, wikilinkLookup);
        if (resolved && fileSet.has(resolved) && resolved !== rel) resolvedTargets.push(resolved);
      }
      resolvedTargetsByFile.set(rel, resolvedTargets);
    } catch {
      // Match the prior best-effort graph behavior for unreadable markdown.
      resolvedTargetsByFile.set(rel, []);
    }
  }

  return { expiresAt: Date.now() + GRAPH_INDEX_TTL_MS, files, wikilinkLookup, resolvedTargetsByFile };
}

function logicalGraphIndex(root: { id: string; path: string }, forceRefresh = false): LogicalGraphIndex {
  const cached = logicalGraphIndexes.get(root.id);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached;
  const index = buildLogicalGraphIndex(root);
  logicalGraphIndexes.set(root.id, index);
  return index;
}

function invalidateLogicalGraphIndex(rootId: string): void {
  logicalGraphIndexes.delete(rootId);
  invalidateTreeCache(rootId);
}

// --- /api/tree cache -------------------------------------------------------
// The tree endpoint does three synchronous directory walks (files, folders, md)
// and returns a large JSON payload (343KB for a 2k-file vault). Cache the
// serialized response per root and invalidate on every write so repeated
// opens are a cache hit instead of three fresh directory walks.
const TREE_CACHE = new Map<string, string>();
function invalidateTreeCache(rootId: string): void {
  TREE_CACHE.delete(rootId);
}

function buildTreeBody(root: { path: string }, rootId: string): string {
  const rootAbs = resolve(root.path);
  const markdownFiles = listMdUnderRoot(rootAbs, ".");
  const files = listFilesUnderRoot(rootAbs, ".");
  const folders = listFoldersUnderRoot(rootAbs, ".");
  return JSON.stringify({ root: rootId, files, markdownFiles, folders });
}

function shouldForceGraphRefresh(req: Request): boolean {
  const directives = req.headers.get("cache-control")?.split(",") ?? [];
  return directives.some((directive) => {
    const name = directive.trim().split(";", 1)[0]?.trim().toLowerCase();
    return name === "no-cache";
  });
}

/** Focused test hooks; production callers only use request-driven invalidation. */
export function resetLogicalGraphIndexCacheForTests(): void {
  logicalGraphIndexes.clear();
}

export function logicalGraphIndexCacheSizeForTests(): number {
  return logicalGraphIndexes.size;
}

function folderSegments(relPath: string): string[] {
  const parts = relPath.split('/').filter(Boolean);
  return parts.slice(0, -1);
}

function folderNodeId(rootId: string, folderPath: string): string {
  return `folder:${rootId}/${folderPath}`;
}

function rootLabel(root: { id: string; label?: string }): string {
  return root.label ?? root.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function orderedRoots<T extends { id: string }>(roots: T[]): T[] {
  return [...roots].sort((a, b) => a.id.localeCompare(b.id));
}

function buildSystemGraph(
  mdMode: "none" | "folders" | "files" = "none",
  rootFilter?: string | null,
  focusPath?: string | null,
  forceRefresh = false,
) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const addNode = (n: GraphNode) => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };
  const addEdge = (e: GraphEdge) => {
    const id = `${e.from}|${e.to}|${e.type}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push(e);
  };

  const includeSystemTopology = mdMode === "none" && !rootFilter;
  if (includeSystemTopology) {
    addNode({ id: "service:md-ops", type: "service", label: "MD Ops" });
  }

  // Roots + markdown currently indexed by md-ops.
  // mdMode controls whether we hide markdown entirely, show folders, or show files.
  try {
    const roots = getRoots();
    for (const r of roots) {
      if (rootFilter && r.id !== rootFilter) continue;
      const rootNodeId = `root:${r.id}`;
      addNode({ id: rootNodeId, type: "root", label: rootLabel(r), props: { id: r.id } });
      if (includeSystemTopology) addEdge({ from: rootNodeId, to: "service:md-ops", type: "mounted_by" });

      // Overview is deliberately topology-only: do not traverse markdown or
      // build an index when mdMode is none.
      if (mdMode === "none") continue;

      const index = logicalGraphIndex(r, forceRefresh);
      const files = index.files;

      if (mdMode === "folders") {
        const folderSet = new Set<string>();
        const folderLinkPairs = new Set<string>();
        const normalizedFocus = focusPath?.replace(/^\/+|\/+$/g, "") ?? null;

        for (const rel of files) {
          const segs = folderSegments(rel);
          const sourceFolder = segs.join('/');
          if (normalizedFocus) {
            const inFocus = sourceFolder === normalizedFocus || sourceFolder.startsWith(`${normalizedFocus}/`);
            if (!inFocus) continue;
          }

          let current = "";
          for (const seg of segs) {
            current = current ? `${current}/${seg}` : seg;
            if (normalizedFocus && current !== normalizedFocus && !normalizedFocus.startsWith(`${current}/`) && !current.startsWith(`${normalizedFocus}/`)) {
              continue;
            }
            if (!folderSet.has(current)) {
              folderSet.add(current);
              addNode({ id: folderNodeId(r.id, current), type: "folder", label: seg, props: { root: r.id, relPath: current } });
              const parent = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : null;
              const parentId = parent ? folderNodeId(r.id, parent) : rootNodeId;
              addEdge({ from: folderNodeId(r.id, current), to: parentId, type: "in_folder" });
            }
          }

          if (!sourceFolder) continue;
          for (const resolved of index.resolvedTargetsByFile.get(rel) ?? []) {
            const targetFolder = folderSegments(resolved).join('/');
            if (!targetFolder || targetFolder === sourceFolder) continue;
            if (normalizedFocus) {
              const targetInFocus = targetFolder === normalizedFocus || targetFolder.startsWith(`${normalizedFocus}/`);
              if (!targetInFocus) continue;
            }
            const pair = `${sourceFolder}|${targetFolder}`;
            if (folderLinkPairs.has(pair)) continue;
            folderLinkPairs.add(pair);
            addEdge({ from: folderNodeId(r.id, sourceFolder), to: folderNodeId(r.id, targetFolder), type: "folder_wikilink" });
          }
        }
        continue;
      }

      if (mdMode !== "files") continue;

      for (const rel of files) {
        const fileNodeId = `md:${r.id}/${rel}`;
        addNode({ id: fileNodeId, type: "md", label: rel, props: { root: r.id, relPath: rel } });
        addEdge({ from: fileNodeId, to: rootNodeId, type: "in_root" });

        for (const resolved of index.resolvedTargetsByFile.get(rel) ?? []) {
          addEdge({ from: fileNodeId, to: `md:${r.id}/${resolved}`, type: "wikilink" });
        }
      }
    }
  } catch {
    // best effort graph enrichment only
  }

  return { generatedAt: new Date().toISOString(), nodes, edges };
}

export async function fetchHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  try {
    if (!isTrustedRequestHost(req)) {
      return json({ error: "untrusted host" }, { status: 421 });
    }

    if (pathname === "/" || pathname === "/index.html") {
      const uiPath = resolve(import.meta.dir, "../ui/index.html");
      if (existsSync(uiPath)) {
        return new Response(readFileSync(uiPath, "utf8"), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("UI not found", { status: 404 });
    }

    if (pathname.startsWith('/assets/')) {
      const assetPath = resolve(import.meta.dir, `../ui${pathname}`);
      if (!existsSync(assetPath)) {
        return json({ error: 'asset not found' }, { status: 404 });
      }
      return new Response(readFileSync(assetPath), {
        status: 200,
        headers: { 'Content-Type': staticContentType(pathname), 'Cache-Control': 'public, max-age=300' },
      });
    }

    if (pathname === "/health") {
      return json({ status: 200 }, { status: 200 });
    }

    if (pathname === "/healthz") {
      return json({ status: 200 }, { status: 200 });
    }

    if (pathname === "/readyz") {
      const status = readiness();
      return json(status, { status: status.ready ? 200 : 503 });
    }

    if (pathname === "/api/roots") {
      if (req.method !== "GET") return methodNotAllowed(READ_ONLY_ALLOWED_METHODS);
      const roots = orderedRoots(getRoots());
      return json(
        { roots: roots.map((r) => ({ id: r.id, label: rootLabel(r), ...(r.home ? { home: r.home } : {}) })) },
        { status: 200 }
      );
    }

    if (pathname === "/api/tree") {
      if (req.method !== "GET") return methodNotAllowed(READ_ONLY_ALLOWED_METHODS);
      const rootId = url.searchParams.get("root");
      if (!rootId) {
        return json({ error: "root query param required" }, { status: 400 });
      }
      const roots = getRoots();
      const root = roots.find((r) => r.id === rootId);
      if (!root) {
        return json({ error: "root not found" }, { status: 404 });
      }
      const rootAbs = resolve(root.path);
      if (!existsSync(rootAbs)) {
        return json({ error: "root not accessible" }, { status: 500 });
      }
      const cached = TREE_CACHE.get(rootId);
      if (cached) {
        return new Response(cached, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const body = buildTreeBody(root, rootId);
      TREE_CACHE.set(rootId, body);
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (pathname === "/api/retrieve") {
      if (req.method !== "GET") return methodNotAllowed(READ_ONLY_ALLOWED_METHODS);
      const rootId = url.searchParams.get("root");
      const q = url.searchParams.get("q")?.trim();
      const limit = parseRetrieveLimit(url.searchParams.get("limit"));
      if (!rootId || !q || q.length > MAX_RETRIEVE_QUERY_LENGTH) {
        return json({ error: "root and non-empty q query params required" }, { status: 400 });
      }

      const roots = getRoots();
      const root = roots.find((r) => r.id === rootId);
      if (!root) {
        return json({ error: "root not found" }, { status: 404 });
      }
      const collection = qmdCollectionForRoot(rootId);
      if (!collection) {
        return json({ error: "QMD retrieval is not configured for this root" }, { status: 404 });
      }
      const rootAbs = resolve(root.path);
      if (!existsSync(rootAbs)) {
        return json({ error: "root not accessible" }, { status: 500 });
      }

      try {
        const files = listMdUnderRoot(rootAbs, ".");
        const results = await retrieveWithQmd(q, collection, files, limit);
        return json({ root: rootId, query: q, mode: "keyword", results, total: results.length }, { status: 200 });
      } catch (error) {
        if (error instanceof QmdUnavailableError) {
          return json({ error: "QMD retrieval is temporarily unavailable" }, { status: 503 });
        }
        throw error;
      }
    }

    if (pathname === "/api/search") {
      if (req.method !== "GET") return methodNotAllowed(READ_ONLY_ALLOWED_METHODS);
      const rootId = url.searchParams.get("root");
      const q = url.searchParams.get("q")?.trim();
      const limit = parseSearchLimit(url.searchParams.get("limit"));
      if (!rootId || !q) {
        return json({ error: "root and non-empty q query params required" }, { status: 400 });
      }
      const roots = getRoots();
      const root = roots.find((r) => r.id === rootId);
      if (!root) {
        return json({ error: "root not found" }, { status: 404 });
      }
      const rootAbs = resolve(root.path);
      if (!existsSync(rootAbs)) {
        return json({ error: "root not accessible" }, { status: 500 });
      }
      const files = listMdUnderRoot(rootAbs, ".");
      const qLower = q.toLowerCase();
      const results: Array<{ file: string; matches: Array<{ line: number; text: string }> }> = [];
      for (const f of files) {
        if (results.length >= limit) break;
        const absPath = resolve(rootAbs, f);
        try {
          const content = readFileSync(absPath, "utf8");
          if (!content.toLowerCase().includes(qLower)) continue;
          const lines = content.split("\n");
          const matches: Array<{ line: number; text: string }> = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(qLower)) {
              matches.push({ line: i + 1, text: lines[i].slice(0, 200) });
              if (matches.length >= 5) break;
            }
          }
          if (matches.length > 0) {
            results.push({ file: f, matches });
          }
        } catch { /* skip unreadable */ }
      }
      return json({ root: rootId, query: q, results, total: results.length }, { status: 200 });
    }

    if (pathname === "/api/diagrams") {
      if (req.method !== "GET") return methodNotAllowed(READ_ONLY_ALLOWED_METHODS);
      const rootId = url.searchParams.get("root");
      if (!rootId) {
        return json({ error: "root query param required" }, { status: 400 });
      }
      const roots = getRoots();
      const root = roots.find((r) => r.id === rootId);
      if (!root) {
        return json({ error: "root not found" }, { status: 404 });
      }
      const rootAbs = resolve(root.path);
      if (!existsSync(rootAbs)) {
        return json({ error: "root not accessible" }, { status: 500 });
      }
      const files = listMdUnderRoot(rootAbs, ".");
      const filesWithDiagrams: Array<{ path: string; blocks: Array<{ line: number; source: string }> }> = [];
      for (const f of files) {
        const absPath = resolve(rootAbs, f);
        try {
          const content = readFileSync(absPath, "utf8");
          const blocks = extractMermaidBlocks(content);
          if (blocks.length > 0) {
            filesWithDiagrams.push({
              path: f,
              blocks: blocks.map((b) => ({ line: b.startLine, source: b.source })),
            });
          }
        } catch { /* skip unreadable */ }
      }
      return json({ root: rootId, files: filesWithDiagrams, total: filesWithDiagrams.reduce((sum, f) => sum + f.blocks.length, 0) }, { status: 200 });
    }

    if (pathname === "/api/system-graph") {
      if (req.method !== "GET") return methodNotAllowed(READ_ONLY_ALLOWED_METHODS);
      const rawMode = url.searchParams.get("mdMode") ?? "none";
      const mdMode: "none" | "folders" | "files" = rawMode === "files" ? "files" : rawMode === "folders" ? "folders" : "none";
      const root = url.searchParams.get("root");
      const focus = url.searchParams.get("focus");
      return json(
        buildSystemGraph(mdMode, root, focus, shouldForceGraphRefresh(req)),
        { status: 200, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (pathname === "/api/folder") {
      if (!FOLDER_ALLOWED_METHODS.includes(req.method)) return methodNotAllowed(FOLDER_ALLOWED_METHODS);
      if (!mutationsEnabled()) return mutationsNotEnabled();

      const confirm = req.headers.get(WRITE_CONFIRM_HEADER);
      if (confirm !== "1" && confirm !== "true") {
        return json(
          { error: "folder write requires header X-Confirm-Write: 1" },
          { status: 400 }
        );
      }

      const pathParam = url.searchParams.get("path");
      if (!pathParam) {
        return json({ error: "path query param required" }, { status: 400 });
      }
      const parts = pathParam.replace(/\\/g, "/").split("/").filter(Boolean);
      if (parts.length < 2) {
        return json({ error: "path must be rootId/relative/folder" }, { status: 400 });
      }
      const [rootId, ...rest] = parts;
      const logicalPath = rest.join("/");
      const roots = getRoots();
      const result = resolveAndValidateFolder(roots, rootId!, logicalPath);
      if (!result.ok) {
        return json({ error: result.message }, { status: result.status });
      }

      if (req.method === "DELETE") {
        const recursive = ["1", "true"].includes((url.searchParams.get("recursive") ?? "").toLowerCase());
        if (!existsSync(result.requestedPath)) {
          return json({ error: "folder not found" }, { status: 404 });
        }
        const st = lstatSync(result.requestedPath);
        if (st.isSymbolicLink()) {
          return json({ error: "symbolic link deletion is not supported" }, { status: 400 });
        }
        if (!st.isDirectory()) {
          return json({ error: "path is not a folder" }, { status: 400 });
        }
        const entries = readdirSync(result.requestedPath);
        if (entries.length > 0 && !recursive) {
          return json(
            { error: "folder not empty", message: "Pass recursive=1 to delete a non-empty folder." },
            { status: 409 }
          );
        }
        rmSync(result.requestedPath, { recursive: true, force: false });
        invalidateLogicalGraphIndex(result.rootId);
        logWrite(getWho(req), pathParam, "delete", JSON.stringify({ recursive }), undefined);
        return json({ ok: true, path: pathParam, recursive }, { status: 200 });
      }

      if (req.method === "PUT") {
        if (existsSync(result.absolutePath)) {
          const st = statSync(result.absolutePath);
          return json(
            { error: st.isDirectory() ? "folder exists" : "path exists", message: "Refusing to overwrite an existing path." },
            { status: 409 }
          );
        }
        mkdirSync(result.absolutePath, { recursive: true });
        invalidateLogicalGraphIndex(result.rootId);
        logWrite(getWho(req), pathParam, "put", "", undefined);
        return json({ ok: true, path: pathParam }, { status: 200 });
      }

      if (req.method === "PATCH") {
        let body: { to?: unknown };
        try {
          body = await req.json();
        } catch {
          return json({ error: "JSON body required" }, { status: 400 });
        }
        const rawTo = typeof body.to === "string" ? body.to.trim() : "";
        if (!rawTo) {
          return json({ error: "to is required" }, { status: 400 });
        }
        const toParts = rawTo.replace(/\\/g, "/").split("/").filter(Boolean);
        const knownRoot = roots.find((root) => root.id === toParts[0]);
        const targetRootId = knownRoot ? knownRoot.id : rootId!;
        const targetLogicalPath = knownRoot ? toParts.slice(1).join("/") : rawTo;
        if (targetRootId !== rootId) {
          return json({ error: "folder rename must stay within the same root" }, { status: 400 });
        }
        const target = resolveAndValidateFolder(roots, targetRootId, targetLogicalPath);
        if (!target.ok) {
          return json({ error: target.message }, { status: target.status });
        }
        if (!existsSync(result.absolutePath) || !statSync(result.absolutePath).isDirectory()) {
          return json({ error: "source folder not found" }, { status: 404 });
        }
        if (result.absolutePath === target.absolutePath) {
          return json({ error: "target folder is unchanged" }, { status: 400 });
        }
        const descendantRel = relative(result.absolutePath, target.absolutePath);
        if (descendantRel && !descendantRel.startsWith(`..${sep}`) && descendantRel !== ".." && !descendantRel.startsWith("/")) {
          return json({ error: "cannot rename a folder into itself" }, { status: 400 });
        }
        if (existsSync(target.absolutePath)) {
          return json({ error: "target exists", message: "Refusing to overwrite an existing folder or file." }, { status: 409 });
        }
        const targetParent = resolve(target.absolutePath, "..");
        if (!existsSync(targetParent)) mkdirSync(targetParent, { recursive: true });
        renameSync(result.absolutePath, target.absolutePath);
        invalidateLogicalGraphIndex(result.rootId);
        logWrite(getWho(req), pathParam, "rename", JSON.stringify({ to: `${targetRootId}/${target.logicalPath}` }), undefined);
        return json({ ok: true, path: pathParam, to: `${targetRootId}/${target.logicalPath}` }, { status: 200 });
      }

      return methodNotAllowed(FOLDER_ALLOWED_METHODS);
    }

    if (pathname === "/api/asset") {
      if (!ASSET_ALLOWED_METHODS.includes(req.method)) return methodNotAllowed(ASSET_ALLOWED_METHODS);

      const pathParam = url.searchParams.get("path");
      if (!pathParam) {
        return json({ error: "path query param required" }, { status: 400 });
      }
      const parts = pathParam.replace(/\\/g, "/").split("/").filter(Boolean);
      if (parts.length < 2) {
        return json({ error: "path must be rootId/relative/image-path" }, { status: 400 });
      }
      const [rootId, ...rest] = parts;
      const logicalPath = rest.join("/");
      const roots = getRoots();
      const result = resolveAndValidateImage(roots, rootId!, logicalPath);
      if (!result.ok) {
        return json({ error: result.message }, { status: result.status });
      }
      if (!existsSync(result.absolutePath)) {
        return json({ error: "asset not found" }, { status: 404 });
      }

      const etag = fileEtag(result.absolutePath);
      const mtime = statSync(result.absolutePath).mtime;
      const headers = {
        "Content-Type": staticContentType(result.absolutePath),
        "Cache-Control": "private, max-age=300",
        ETag: etag,
        "Last-Modified": mtime.toUTCString(),
      };
      if (req.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }
      return new Response(readFileSync(result.absolutePath), { status: 200, headers });
    }

    if (pathname === "/api/file") {
      if (!FILE_ALLOWED_METHODS.includes(req.method)) return methodNotAllowed(FILE_ALLOWED_METHODS);

      const pathParam = url.searchParams.get("path");
      if (!pathParam) {
        return json({ error: "path query param required" }, { status: 400 });
      }
      const parts = pathParam.replace(/\\/g, "/").split("/").filter(Boolean);
      if (parts.length < 2) {
        return json({ error: "path must be rootId/relative/path.md" }, { status: 400 });
      }
      const [rootId, ...rest] = parts;
      const logicalPath = rest.join("/");
      const roots = getRoots();

      if (req.method === "GET" || req.method === "HEAD") {
        const result = resolveAndValidateTextPreview(roots, rootId!, logicalPath);
        if (!result.ok) {
          return json({ error: result.message }, { status: result.status });
        }
        if (!existsSync(result.absolutePath)) {
          return json({ error: "file not found" }, { status: 404 });
        }
        const etag = fileEtag(result.absolutePath);
        const mtime = statSync(result.absolutePath).mtime;
        const headers = {
          "Content-Type": hasMarkdownExtension(result.absolutePath) ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
          ETag: etag,
          "Last-Modified": mtime.toUTCString(),
        };
        if (req.method === "HEAD") {
          return new Response(null, { status: 200, headers });
        }
        const content = readFileSync(result.absolutePath, "utf8");
        return new Response(content, { status: 200, headers });
      }

      if (!mutationsEnabled()) return mutationsNotEnabled();

      if (req.method === "DELETE") {
        const result = resolveAndValidate(roots, rootId!, logicalPath);
        if (!result.ok) {
          return json({ error: result.message }, { status: result.status });
        }
        const confirm = req.headers.get(WRITE_CONFIRM_HEADER);
        if (confirm !== "1" && confirm !== "true") {
          return json(
            { error: "delete requires header X-Confirm-Write: 1" },
            { status: 400 }
          );
        }
        if (!existsSync(result.requestedPath)) {
          return json({ error: "file not found" }, { status: 404 });
        }
        const st = lstatSync(result.requestedPath);
        if (st.isSymbolicLink()) {
          return json({ error: "symbolic link deletion is not supported" }, { status: 400 });
        }
        if (!st.isFile()) {
          return json({ error: "path is not a file" }, { status: 400 });
        }
        const prevContent = readFileSync(result.requestedPath, "utf8");
        unlinkSync(result.requestedPath);
        invalidateLogicalGraphIndex(result.rootId);
        logWrite(getWho(req), pathParam, "delete", "", prevContent);
        return json({ ok: true, path: pathParam }, { status: 200 });
      }

      if (req.method === "PUT") {
        const result = resolveAndValidate(roots, rootId!, logicalPath);
        if (!result.ok) {
          return json({ error: result.message }, { status: result.status });
        }
        const confirm = req.headers.get(WRITE_CONFIRM_HEADER);
        if (confirm !== "1" && confirm !== "true") {
          return json(
            { error: "write requires header X-Confirm-Write: 1" },
            { status: 400 }
          );
        }
        const fileExists = existsSync(result.absolutePath);
        const ifNoneMatch = req.headers.get(IF_NONE_MATCH_HEADER)?.trim();
        if (fileExists && ifNoneMatch === "*") {
          const currentEtag = fileEtag(result.absolutePath);
          const mtime = statSync(result.absolutePath).mtime;
          return json(
            { error: "file exists", message: "Refusing to overwrite an existing file." },
            {
              status: 412,
              headers: {
                ETag: currentEtag,
                "Last-Modified": mtime.toUTCString(),
              },
            }
          );
        }
        if (fileExists) {
          const ifMatch = req.headers.get(IF_MATCH_HEADER);
          if (ifMatch) {
            const currentEtag = fileEtag(result.absolutePath);
            const want = ifMatch.trim().replace(/^W\//i, "");
            const have = currentEtag.replace(/^W\//i, "").replace(/"/g, "");
            const wantNorm = want.replace(/"/g, "");
            if (wantNorm !== have) {
              const mtime = statSync(result.absolutePath).mtime;
              return json(
                { error: "conflict", message: "File was modified elsewhere; refetch to get latest." },
                {
                  status: 409,
                  headers: {
                    ETag: currentEtag,
                    "Last-Modified": mtime.toUTCString(),
                  },
                }
              );
            }
          }
        }
        const body = await req.text();
        let prevContent: string | undefined;
        if (existsSync(result.absolutePath)) {
          prevContent = readFileSync(result.absolutePath, "utf8");
        }
        const dir = resolve(result.absolutePath, "..");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(result.absolutePath, body, "utf8");
        invalidateLogicalGraphIndex(result.rootId);
        logWrite(getWho(req), pathParam, "put", body, prevContent);
        const savedEtag = fileEtag(result.absolutePath);
        const savedMtime = statSync(result.absolutePath).mtime;
        return json(
          { ok: true, path: pathParam },
          {
            status: 200,
            headers: {
              ETag: savedEtag,
              "Last-Modified": savedMtime.toUTCString(),
            },
          }
        );
      }

      return methodNotAllowed(FILE_ALLOWED_METHODS);
    }

    return json({ error: "not found" }, { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
}
