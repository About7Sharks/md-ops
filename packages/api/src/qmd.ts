/**
 * Bounded QMD keyword retrieval for MD Ops.
 *
 * QMD stays behind the MD Ops root allowlist. This module never returns a
 * physical path or accepts a shell command from an HTTP request.
 */

export const DEFAULT_RETRIEVE_LIMIT = 3;
export const MAX_RETRIEVE_LIMIT = 8;
export const MAX_RETRIEVE_QUERY_LENGTH = 500;
const MAX_QMD_OUTPUT_BYTES = 64 * 1024;
const QMD_TIMEOUT_MS = 8_000;

export type QmdResult = {
  path: string;
  title: string;
  score: number;
  excerpt: string;
};

type QmdJsonResult = {
  file?: unknown;
  title?: unknown;
  score?: unknown;
  snippet?: unknown;
};

export type QmdRunner = (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

class QmdError extends Error {}
export class QmdUnavailableError extends QmdError {}

function qmdExecutable(): string {
  const configured = process.env.QMD_BIN?.trim();
  if (configured) return configured;
  const home = process.env.HOME?.trim();
  return home ? `${home}/.local/bin/qmd` : "qmd";
}

async function defaultRunner(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([qmdExecutable(), ...args], { stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, QMD_TIMEOUT_MS);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) throw new QmdUnavailableError("QMD retrieval timed out");
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

let runner: QmdRunner = defaultRunner;

/** Focused test hook. Production code always uses the local QMD executable. */
export function setQmdRunnerForTests(nextRunner?: QmdRunner): void {
  runner = nextRunner ?? defaultRunner;
}

export function parseRetrieveLimit(raw: string | null): number {
  const parsed = raw == null ? DEFAULT_RETRIEVE_LIMIT : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_RETRIEVE_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_RETRIEVE_LIMIT);
}

/**
 * The QMD URI is a normalized slug, while MD Ops must retain canonical casing
 * and spacing. Create the same conservative lookup key for both sides. Any
 * collision is rejected rather than returning the wrong note.
 */
export function qmdPathKey(path: string): string {
  return path.normalize("NFKC").split("/").filter(Boolean).map((segment) => {
    const extensionIndex = segment.lastIndexOf(".");
    const stem = extensionIndex > 0 ? segment.slice(0, extensionIndex) : segment;
    const extension = extensionIndex > 0 ? segment.slice(extensionIndex).toLowerCase() : "";
    const slug = stem
      .toLocaleLowerCase("en-US")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
    return `${slug}${extension}`;
  }).join("/");
}

function canonicalPathLookup(files: readonly string[]): Map<string, string | null> {
  const lookup = new Map<string, string | null>();
  for (const file of files) {
    const key = qmdPathKey(file);
    const existing = lookup.get(key);
    if (existing !== undefined && existing !== file) {
      lookup.set(key, null);
    } else {
      lookup.set(key, file);
    }
  }
  return lookup;
}

function boundedExcerpt(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 280);
}

function normalizedScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizedTitle(value: unknown, fallbackPath: string): string {
  if (typeof value !== "string") return fallbackPath;
  const title = value.replace(/\s+/g, " ").trim().slice(0, 200);
  return title || fallbackPath;
}

export function normalizeQmdResults(
  raw: unknown,
  collection: string,
  files: readonly string[],
  limit: number,
): QmdResult[] {
  if (!Array.isArray(raw)) throw new QmdUnavailableError("QMD returned an invalid result payload");

  const lookup = canonicalPathLookup(files);
  const prefix = `qmd://${collection}/`;
  const results: QmdResult[] = [];
  const seen = new Set<string>();

  for (const candidate of raw as QmdJsonResult[]) {
    if (results.length >= limit || !candidate || typeof candidate.file !== "string") continue;
    if (!candidate.file.startsWith(prefix)) continue;
    const qmdPath = candidate.file.slice(prefix.length);
    if (!qmdPath || qmdPath.startsWith("/") || qmdPath.split("/").some((part) => !part || part === "." || part === "..")) continue;
    const canonicalPath = lookup.get(qmdPathKey(qmdPath));
    if (!canonicalPath || seen.has(canonicalPath)) continue;
    seen.add(canonicalPath);
    results.push({
      path: canonicalPath,
      title: normalizedTitle(candidate.title, canonicalPath),
      score: normalizedScore(candidate.score),
      excerpt: boundedExcerpt(candidate.snippet),
    });
  }

  return results;
}

export async function retrieveWithQmd(
  query: string,
  collection: string,
  files: readonly string[],
  limit: number,
): Promise<QmdResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || trimmedQuery.length > MAX_RETRIEVE_QUERY_LENGTH) {
    throw new QmdUnavailableError("QMD query is invalid");
  }

  let run;
  try {
    run = await runner(["search", trimmedQuery, "-c", collection, "-n", String(limit), "--json"]);
  } catch (error) {
    if (error instanceof QmdError) throw error;
    throw new QmdUnavailableError("QMD retrieval is unavailable");
  }
  if (run.exitCode !== 0 || run.stdout.length > MAX_QMD_OUTPUT_BYTES) {
    throw new QmdUnavailableError("QMD retrieval is unavailable");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(run.stdout);
  } catch {
    throw new QmdUnavailableError("QMD returned invalid JSON");
  }
  return normalizeQmdResults(raw, collection, files, limit);
}

/** Returns one configured collection name or null when the root has no QMD index. */
export function qmdCollectionForRoot(rootId: string, env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.MD_OPS_QMD_ROOTS?.trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const collection = (parsed as Record<string, unknown>)[rootId];
    if (typeof collection !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(collection)) return null;
    return collection;
  } catch {
    return null;
  }
}
