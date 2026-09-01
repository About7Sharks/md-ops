export type Environment = Record<string, string | undefined>;

export type Root = { id: string; label?: string };
export type Tree = { root: string; files: string[]; markdownFiles: string[]; folders: string[] };
export type SearchResult = { file: string; matches: Array<{ line: number; text: string }> };
export type SearchResponse = { root: string; query: string; results: SearchResult[]; total: number };
export type RetrieveResult = { path: string; title: string; score: number; excerpt: string; url: string };
export type RetrieveResponse = { root: string; query: string; mode: "keyword"; results: RetrieveResult[]; total: number };
export type ReadFile = { content: string; etag?: string; lastModified?: string; url: string };

export class MdOpsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MdOpsApiError";
  }
}

function apiBaseUrl(env: Environment): URL {
  const raw = env.MD_OPS_API_URL?.trim();
  if (!raw) throw new Error("MD_OPS_API_URL is required");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MD_OPS_API_URL must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MD_OPS_API_URL must use HTTP(S)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("MD_OPS_API_URL must not contain credentials, query text, or fragments");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function bearerToken(env: Environment): string | undefined {
  const token = env.MD_OPS_API_BEARER_TOKEN?.trim();
  if (!token) return undefined;
  if (/\s/.test(token) || token.length > 4096) throw new Error("MD_OPS_API_BEARER_TOKEN is invalid");
  return token;
}

function responseError(status: number, body: string): MdOpsApiError {
  try {
    const json = JSON.parse(body) as { error?: unknown; message?: unknown };
    const message = typeof json.message === "string" ? json.message : typeof json.error === "string" ? json.error : "MD Ops API request failed";
    return new MdOpsApiError(message.slice(0, 300), status);
  } catch {
    return new MdOpsApiError("MD Ops API request failed", status);
  }
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class MdOpsClient {
  readonly baseUrl: URL;
  private readonly token?: string;

  constructor(env: Environment = process.env, private readonly fetchImpl: FetchLike = fetch) {
    this.baseUrl = apiBaseUrl(env);
    this.token = bearerToken(env);
  }

  private endpoint(path: string, params?: Record<string, string | undefined>): URL {
    const basePath = this.baseUrl.pathname.replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${basePath}${normalizedPath}`, this.baseUrl.origin);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return url;
  }

  private async request(path: string, init: RequestInit = {}, params?: Record<string, string | undefined>): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json, text/plain;q=0.9");
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    const response = await this.fetchImpl(this.endpoint(path, params), { ...init, headers });
    if (!response.ok) throw responseError(response.status, await response.text());
    return response;
  }

  browserFileUrl(logicalPath: string): string {
    const [root, ...segments] = logicalPath.split("/");
    if (!root || segments.length === 0 || segments.some((segment) => !segment)) {
      throw new MdOpsApiError("A logical path must include a root and relative file path");
    }
    const url = new URL(this.baseUrl);
    // A reverse proxy may canonicalize a mounted app path such as
    // `/app/md-ops` to `/app/md-ops/`. Some proxies drop the query string on
    // that redirect, which turns a file deep link into the workspace home.
    // Emit the canonical directory URL directly so root/path/view survive.
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    url.searchParams.set("root", root);
    url.searchParams.set("path", segments.join("/"));
    url.searchParams.set("view", "read");
    return url.toString();
  }

  async listRoots(): Promise<Root[]> {
    const response = await this.request("/api/roots");
    const payload = await response.json() as { roots?: unknown };
    if (!Array.isArray(payload.roots)) throw new MdOpsApiError("MD Ops API returned an invalid roots response");
    return payload.roots as Root[];
  }

  async listFiles(root: string): Promise<Tree> {
    return await (await this.request("/api/tree", {}, { root })).json() as Tree;
  }

  async search(root: string, query: string, limit?: number): Promise<SearchResponse> {
    return await (await this.request("/api/search", {}, { root, q: query, limit: limit?.toString() })).json() as SearchResponse;
  }

  async retrieve(root: string, query: string, limit?: number): Promise<RetrieveResponse> {
    const payload = await (await this.request("/api/retrieve", {}, { root, q: query, limit: limit?.toString() })).json() as {
      root?: unknown;
      query?: unknown;
      mode?: unknown;
      results?: unknown;
      total?: unknown;
    };
    if (payload.root !== root || typeof payload.query !== "string" || payload.mode !== "keyword" || !Array.isArray(payload.results) || typeof payload.total !== "number") {
      throw new MdOpsApiError("MD Ops API returned an invalid retrieval response");
    }
    const results = payload.results.map((result): RetrieveResult => {
      if (!result || typeof result !== "object") throw new MdOpsApiError("MD Ops API returned an invalid retrieval result");
      const { path, title, score, excerpt } = result as Record<string, unknown>;
      if (
        typeof path !== "string" || !path || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")
        || typeof title !== "string" || typeof score !== "number" || !Number.isFinite(score) || typeof excerpt !== "string"
      ) {
        throw new MdOpsApiError("MD Ops API returned an invalid retrieval result");
      }
      const logicalPath = `${root}/${path}`;
      return { path: logicalPath, title, score, excerpt, url: this.browserFileUrl(logicalPath) };
    });
    return { root, query: payload.query, mode: "keyword", results, total: payload.total };
  }

  async readFile(path: string): Promise<ReadFile> {
    const response = await this.request("/api/file", {}, { path });
    return {
      content: await response.text(),
      etag: response.headers.get("ETag") ?? undefined,
      lastModified: response.headers.get("Last-Modified") ?? undefined,
      url: this.browserFileUrl(path),
    };
  }

  async writeFile(path: string, content: string, etag?: string): Promise<{ etag?: string; lastModified?: string; url: string }> {
    const headers = new Headers({ "Content-Type": "text/markdown; charset=utf-8", "X-Confirm-Write": "1" });
    if (etag) headers.set("If-Match", etag);
    else headers.set("If-None-Match", "*");
    const response = await this.request("/api/file", { method: "PUT", headers, body: content }, { path });
    return {
      etag: response.headers.get("ETag") ?? undefined,
      lastModified: response.headers.get("Last-Modified") ?? undefined,
      url: this.browserFileUrl(path),
    };
  }
}
