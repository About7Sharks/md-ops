/**
 * Integration tests: health and happy-path read/write.
 * Path traversal (400), allowlist (403), and X-Confirm-Write (400) are covered by path.test.ts.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { realpathSync } from "fs";
import {
  fetchHandler,
  isTrustedRequestHost,
  logicalGraphIndexCacheSizeForTests,
  resetLogicalGraphIndexCacheForTests,
} from "../src/handler";

let allowedDir: string;
let otherDir: string;

function req(path: string, init?: RequestInit): Promise<Response> {
  return fetchHandler(new Request(`https://localhost/api${path}`, init));
}

beforeAll(async () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "md-ops-int-")));
  allowedDir = join(work, "allowed");
  otherDir = join(work, "other");
  mkdirSync(allowedDir, { recursive: true });
  mkdirSync(otherDir, { recursive: true });
  mkdirSync(join(allowedDir, "guide"), { recursive: true });
  writeFileSync(join(allowedDir, "readme.md"), "# Hello\n");
  writeFileSync(join(allowedDir, "data.json"), "{\"hello\":true}\n");
  writeFileSync(join(allowedDir, "photo.jpg"), "fake image bytes");
  writeFileSync(join(allowedDir, "guide", "start.md"), "# Start\n");
  writeFileSync(
    join(allowedDir, "flow.md"),
    "# Flow\n\n```mermaid\nflowchart TD\n    A --> B\n```\n\nSome text.\n\n```mermaid\nsequenceDiagram\n    A->>B: hi\n```\n"
  );
  for (let i = 0; i < 35; i += 1) {
    const suffix = i < 10 ? `0${i}` : String(i);
    writeFileSync(join(allowedDir, `search-${suffix}.md`), "needle\n");
  }
  process.env.MD_OPS_ROOTS = JSON.stringify([{ id: "docs", path: allowedDir, home: "readme.md" }, { id: "other", path: otherDir }]);
  process.env.MD_OPS_ALLOW_MUTATIONS = "true";
});

describe("integration", () => {
  test("GET /health returns 200", async () => {
    const res = await fetchHandler(new Request("https://localhost/health"));
    expect(res.status).toBe(200);
  });

  test("rejects untrusted hosts to block DNS rebinding", async () => {
    const request = new Request("https://attacker.example/api/roots");
    expect(isTrustedRequestHost(request)).toBe(false);
    expect(isTrustedRequestHost(new Request("https://LOCALHOST./health"))).toBe(true);
    expect(isTrustedRequestHost(new Request("http://127.0.0.1:3098/health"))).toBe(true);
    expect(isTrustedRequestHost(new Request("http://[::1]:3098/health"))).toBe(true);
    expect(isTrustedRequestHost(request, { MD_OPS_TRUSTED_HOSTS: "notes.example, attacker.example" })).toBe(true);
    expect(isTrustedRequestHost(request, { MD_OPS_TRUSTED_HOSTS: "*, attacker.example/path" })).toBe(false);

    const response = await fetchHandler(request);
    expect(response.status).toBe(421);
    expect(await response.json()).toEqual({ error: "untrusted host" });
  });

  test("GET /api/file returns ETag and Last-Modified", async () => {
    const res = await req("/file?path=docs/readme.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("last-modified")).toBeTruthy();
  });

  test("GET /api/file can read safe non-markdown text previews", async () => {
    const res = await req("/file?path=docs/data.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("{\"hello\":true}\n");
  });

  test("GET /api/asset serves image files read-only with validators", async () => {
    const res = await req("/asset?path=docs/photo.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/jpeg");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("last-modified")).toBeTruthy();
    expect(await res.text()).toBe("fake image bytes");

    const head = await req("/asset?path=docs/photo.jpg", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("GET /api/asset rejects non-image files and writes", async () => {
    let res = await req("/asset?path=docs/readme.md");
    expect(res.status).toBe(400);
    let body = await res.json();
    expect(body.error).toContain("image");

    res = await req("/asset?path=docs/photo.jpg", { method: "PUT", body: "nope" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  test("HEAD /api/file returns validators without a response body", async () => {
    const res = await req("/file?path=docs/readme.md", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("last-modified")).toBeTruthy();
    expect(await res.text()).toBe("");
  });

  test("unsupported /api/file methods advertise allowed methods", async () => {
    const res = await req("/file?path=docs/readme.md", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD, PUT, DELETE");
    const body = await res.json();
    expect(body).toEqual({ error: "method not allowed", allowed: ["GET", "HEAD", "PUT", "DELETE"] });
  });

  test("unsupported /api/file methods return 405 before path validation", async () => {
    const res = await req("/file", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD, PUT, DELETE");
    const body = await res.json();
    expect(body).toEqual({ error: "method not allowed", allowed: ["GET", "HEAD", "PUT", "DELETE"] });
  });

  test("read-only roots and system graph endpoints reject unsupported methods", async () => {
    let res = await fetchHandler(new Request("https://localhost/api/roots", { method: "POST" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    let body = await res.json();
    expect(body).toEqual({ error: "method not allowed", allowed: ["GET"] });

    res = await fetchHandler(new Request("https://localhost/api/system-graph", { method: "POST" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    body = await res.json();
    expect(body).toEqual({ error: "method not allowed", allowed: ["GET"] });
  });

  test("GET /api/roots returns labels without physical filesystem paths", async () => {
    const res = await fetchHandler(new Request("https://localhost/api/roots"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.roots).toEqual([{ id: "docs", label: "Docs", home: "readme.md" }, { id: "other", label: "Other" }]);
    expect(JSON.stringify(body)).not.toContain(allowedDir);
    expect(JSON.stringify(body)).not.toContain(otherDir);
  });

  test("GET /api/system-graph returns nodes and edges", async () => {
    const res = await fetchHandler(new Request("https://localhost/api/system-graph"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(body.nodes.length).toBeGreaterThan(0);
  });

  test("GET /api/system-graph exposes only logical root and file metadata", async () => {
    const res = await fetchHandler(new Request("https://localhost/api/system-graph?mdMode=folders&root=docs"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const labels = body.nodes.map((node: { label: string }) => node.label);
    expect(labels).toContain("Docs");
    expect(labels).toContain("guide");
    expect(JSON.stringify(body)).not.toContain(allowedDir);
    expect(JSON.stringify(body)).not.toContain(otherDir);
  });

  test("system graph overview does not traverse or populate the markdown index", async () => {
    resetLogicalGraphIndexCacheForTests();

    const overview = await fetchHandler(new Request("https://localhost/api/system-graph?mdMode=none"));
    expect(overview.status).toBe(200);
    expect(logicalGraphIndexCacheSizeForTests()).toBe(0);

    const detailed = await req("/system-graph?mdMode=files&root=docs");
    expect(detailed.status).toBe(200);
    expect(logicalGraphIndexCacheSizeForTests()).toBe(1);
  });

  test("system graph reuses a root index until a cache-control refresh rebuilds it", async () => {
    const source = join(allowedDir, "graph-cache-source.md");
    writeFileSync(source, "[[graph-cache-target-a]]\n");
    writeFileSync(join(allowedDir, "graph-cache-target-a.md"), "# A\n");
    writeFileSync(join(allowedDir, "graph-cache-target-b.md"), "# B\n");
    resetLogicalGraphIndexCacheForTests();

    let res = await req("/system-graph?mdMode=files&root=docs");
    let graph = await res.json();
    expect(graph.edges).toContainEqual({
      from: "md:docs/graph-cache-source.md",
      to: "md:docs/graph-cache-target-a.md",
      type: "wikilink",
    });
    expect(logicalGraphIndexCacheSizeForTests()).toBe(1);

    // An external writer is intentionally hidden until the short TTL or an
    // explicit Refresh request, preventing repeated full traversals.
    writeFileSync(source, "[[graph-cache-target-b]]\n");
    res = await req("/system-graph?mdMode=files&root=docs");
    graph = await res.json();
    expect(graph.edges).toContainEqual({
      from: "md:docs/graph-cache-source.md",
      to: "md:docs/graph-cache-target-a.md",
      type: "wikilink",
    });

    res = await req("/system-graph?mdMode=files&root=docs", { headers: { "Cache-Control": "no-cache" } });
    graph = await res.json();
    expect(graph.edges).toContainEqual({
      from: "md:docs/graph-cache-source.md",
      to: "md:docs/graph-cache-target-b.md",
      type: "wikilink",
    });
    expect(graph.edges).not.toContainEqual({
      from: "md:docs/graph-cache-source.md",
      to: "md:docs/graph-cache-target-a.md",
      type: "wikilink",
    });
  });

  test("API markdown writes invalidate the affected root graph index", async () => {
    writeFileSync(join(allowedDir, "graph-api-target-a.md"), "# A\n");
    writeFileSync(join(allowedDir, "graph-api-target-b.md"), "# B\n");
    writeFileSync(join(allowedDir, "graph-api-source.md"), "[[graph-api-target-a]]\n");
    resetLogicalGraphIndexCacheForTests();

    let res = await req("/system-graph?mdMode=files&root=docs");
    expect(res.status).toBe(200);
    expect(logicalGraphIndexCacheSizeForTests()).toBe(1);

    res = await req("/file?path=docs/graph-api-source.md", {
      method: "PUT",
      headers: { "X-Confirm-Write": "1" },
      body: "[[graph-api-target-b]]\n",
    });
    expect(res.status).toBe(200);
    expect(logicalGraphIndexCacheSizeForTests()).toBe(0);

    res = await req("/system-graph?mdMode=files&root=docs");
    const graph = await res.json();
    expect(graph.edges).toContainEqual({
      from: "md:docs/graph-api-source.md",
      to: "md:docs/graph-api-target-b.md",
      type: "wikilink",
    });
  });

  test("cached wikilink targets preserve exact, suffix, then first-sorted basename resolution", async () => {
    mkdirSync(join(allowedDir, "graph-links", "archive"), { recursive: true });
    mkdirSync(join(allowedDir, "graph-links", "alpha"), { recursive: true });
    mkdirSync(join(allowedDir, "graph-links", "beta"), { recursive: true });
    writeFileSync(join(allowedDir, "Exact.md"), "# Exact root\n");
    writeFileSync(join(allowedDir, "graph-links", "Exact.md"), "# Exact nested\n");
    writeFileSync(join(allowedDir, "graph-links", "archive", "Suffix.md"), "# Suffix\n");
    writeFileSync(join(allowedDir, "graph-links", "alpha", "Name.md"), "# Alpha\n");
    writeFileSync(join(allowedDir, "graph-links", "beta", "Name.md"), "# Beta\n");
    writeFileSync(
      join(allowedDir, "graph-link-source.md"),
      "[[Exact]] [[archive/Suffix]] [[Name]]\n",
    );
    resetLogicalGraphIndexCacheForTests();

    const res = await req("/system-graph?mdMode=files&root=docs", { headers: { "Cache-Control": "no-cache" } });
    const graph = await res.json();
    const sourceId = "md:docs/graph-link-source.md";
    expect(graph.edges).toContainEqual({ from: sourceId, to: "md:docs/Exact.md", type: "wikilink" });
    expect(graph.edges).toContainEqual({ from: sourceId, to: "md:docs/graph-links/archive/Suffix.md", type: "wikilink" });
    expect(graph.edges).toContainEqual({ from: sourceId, to: "md:docs/graph-links/alpha/Name.md", type: "wikilink" });
    expect(graph.edges).not.toContainEqual({ from: sourceId, to: "md:docs/graph-links/Exact.md", type: "wikilink" });
    expect(graph.edges).not.toContainEqual({ from: sourceId, to: "md:docs/graph-links/beta/Name.md", type: "wikilink" });
  });

  test("GET /api/tree returns markdown files, non-markdown files, and empty folders", async () => {
    mkdirSync(join(allowedDir, "empty-folder", "nested"), { recursive: true });
    const res = await req("/tree?root=docs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toContain("readme.md");
    expect(body.files).toContain("data.json");
    expect(body.files).toContain("photo.jpg");
    expect(body.markdownFiles).toContain("readme.md");
    expect(body.markdownFiles).not.toContain("data.json");
    expect(body.folders).toContain("guide");
    expect(body.folders).toContain("empty-folder");
    expect(body.folders).toContain("empty-folder/nested");
  });

  test("GET /api/search clamps invalid or tiny limits", async () => {
    let res = await req("/search?root=docs&q=needle&limit=0");
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.results).toHaveLength(1);

    res = await req("/search?root=docs&q=needle&limit=abc");
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.results).toHaveLength(30);
  });

  test("GET /api/search trims queries and rejects blank searches", async () => {
    let res = await req("/search?root=docs&q=%20needle%20&limit=1");
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.query).toBe("needle");
    expect(body.results).toHaveLength(1);

    res = await req("/search?root=docs&q=%20%20%20");
    expect(res.status).toBe(400);
    body = await res.json();
    expect(body.error).toContain("non-empty q");
  });

  test("read-only tree and search endpoints reject unsupported methods", async () => {
    let res = await req("/tree?root=docs", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    let body = await res.json();
    expect(body).toEqual({ error: "method not allowed", allowed: ["GET"] });

    res = await req("/search?root=docs&q=needle", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    body = await res.json();
    expect(body).toEqual({ error: "method not allowed", allowed: ["GET"] });
  });

  test("GET /api/diagrams lists mermaid blocks grouped by file", async () => {
    const res = await req("/diagrams?root=docs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.root).toBe("docs");
    expect(body.total).toBe(2);
    const flow = body.files.find((f: { path: string }) => f.path === "flow.md");
    expect(flow).toBeTruthy();
    expect(flow.blocks).toHaveLength(2);
    expect(flow.blocks[0].line).toBe(3);
    expect(flow.blocks[0].source).toContain("flowchart TD");
    expect(flow.blocks[1].source).toContain("sequenceDiagram");
  });

  test("GET /api/diagrams rejects a missing root and non-GET methods", async () => {
    let res = await req("/diagrams");
    expect(res.status).toBe(400);

    res = await req("/diagrams?root=missing");
    expect(res.status).toBe(404);

    res = await req("/diagrams?root=docs", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  test("legacy activity-feed endpoints are not exposed", async () => {
    for (const path of ["/api/neuron/event", "/api/neuron/stats", "/api/neuron/stream"]) {
      const response = await fetchHandler(new Request(`https://localhost${path}`));
      expect(response.status).toBe(404);
    }
  });

  test("happy path: GET file then PUT file", async () => {
    let res = await req("/file?path=docs/readme.md");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("# Hello");
    expect(res.headers.get("ETag")).toBeTruthy();
    expect(res.headers.get("Last-Modified")).toBeTruthy();

    const etag = res.headers.get("ETag");
    res = await req("/file?path=docs/readme.md", {
      method: "PUT",
      headers: { "X-Confirm-Write": "1", "If-Match": etag! },
      body: "# Updated",
    });
    expect(res.status).toBe(200);
    const savedEtag = res.headers.get("ETag");
    expect(savedEtag).toBeTruthy();
    expect(savedEtag).not.toBe(etag);
    expect(res.headers.get("Last-Modified")).toBeTruthy();
    expect(await res.json()).toEqual({ ok: true, path: "docs/readme.md" });

    res = await req("/file?path=docs/readme.md");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# Updated");
    expect(res.headers.get("ETag")).toBe(savedEtag);
  });

  test("PUT /api/folder creates folders and PATCH renames them safely", async () => {
    let res = await req("/folder?path=docs/side-nav/new-folder", {
      method: "PUT",
      headers: { "X-Confirm-Write": "1" },
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(allowedDir, "side-nav", "new-folder"))).toBe(true);

    res = await req("/folder?path=docs/side-nav/new-folder", {
      method: "PUT",
      headers: { "X-Confirm-Write": "1" },
    });
    expect(res.status).toBe(409);

    res = await req("/folder?path=docs/side-nav/new-folder", {
      method: "PATCH",
      headers: { "X-Confirm-Write": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ to: "docs/side-nav/renamed-folder" }),
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(allowedDir, "side-nav", "new-folder"))).toBe(false);
    expect(existsSync(join(allowedDir, "side-nav", "renamed-folder"))).toBe(true);
  });

  test("/api/folder rejects unsafe writes", async () => {
    let res = await req("/folder?path=docs/no-confirm", { method: "PUT" });
    expect(res.status).toBe(400);

    res = await req("/folder?path=docs/../escape", {
      method: "PUT",
      headers: { "X-Confirm-Write": "1" },
    });
    expect(res.status).toBe(400);

    res = await req("/folder?path=docs/guide", {
      method: "PATCH",
      headers: { "X-Confirm-Write": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ to: "other/new-name" }),
    });
    expect(res.status).toBe(400);
  });

  test("DELETE /api/file removes markdown files only with explicit confirmation", async () => {
    writeFileSync(join(allowedDir, "delete-me.md"), "# Delete me\n");

    let res = await req("/file?path=docs/delete-me.md", { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(existsSync(join(allowedDir, "delete-me.md"))).toBe(true);

    res = await req("/file?path=docs/delete-me.md", {
      method: "DELETE",
      headers: { "X-Confirm-Write": "1" },
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(allowedDir, "delete-me.md"))).toBe(false);

    res = await req("/file?path=docs/delete-me.md", {
      method: "DELETE",
      headers: { "X-Confirm-Write": "1" },
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/folder requires recursive=1 for non-empty folders", async () => {
    mkdirSync(join(allowedDir, "delete-folder", "nested"), { recursive: true });
    writeFileSync(join(allowedDir, "delete-folder", "nested", "note.md"), "# Nested\n");

    let res = await req("/folder?path=docs/delete-folder", {
      method: "DELETE",
      headers: { "X-Confirm-Write": "1" },
    });
    expect(res.status).toBe(409);
    expect(existsSync(join(allowedDir, "delete-folder"))).toBe(true);

    res = await req("/folder?path=docs/delete-folder&recursive=1", {
      method: "DELETE",
      headers: { "X-Confirm-Write": "1" },
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(allowedDir, "delete-folder"))).toBe(false);
  });

  test("PUT with If-None-Match creates new markdown files without overwriting existing files", async () => {
    let res = await req("/file?path=docs/guide/new-note.md", {
      method: "PUT",
      headers: { "X-Confirm-Write": "1", "If-None-Match": "*" },
      body: "# New Note\n",
    });
    expect(res.status).toBe(200);

    res = await req("/file?path=docs/guide/new-note.md");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# New Note\n");

    res = await req("/file?path=docs/guide/new-note.md", {
      method: "PUT",
      headers: { "X-Confirm-Write": "1", "If-None-Match": "*" },
      body: "# Overwrite attempt\n",
    });
    expect(res.status).toBe(412);
    expect(res.headers.get("etag")).toBeTruthy();
    const body = await res.json();
    expect(body.error).toBe("file exists");
  });

  test("PUT with wrong If-Match returns 409 conflict", async () => {
    const { writeFileSync } = await import("fs");
    const { join } = await import("path");
    const conflictFile = join(allowedDir, "conflict-test.md");
    writeFileSync(conflictFile, "# Original\n", "utf8");
    const getRes = await req("/file?path=docs/conflict-test.md");
    expect(getRes.status).toBe(200);
    const originalEtag = getRes.headers.get("etag");
    expect(originalEtag).toBeTruthy();
    // Simulate another writer: change file on disk
    writeFileSync(conflictFile, "# Modified on disk\n", "utf8");
    const putHeaders = new Headers([["X-Confirm-Write", "1"], ["If-Match", originalEtag!]]);
    const putReq = new Request("http://localhost/api/file?path=docs/conflict-test.md", {
      method: "PUT",
      headers: putHeaders,
      body: "# Edit from UI",
    });
    const res = await fetchHandler(putReq);
    const body = await res.json();
    const isConflict = res.status === 409 || body?.status === 409;
    expect(isConflict).toBe(true);
    expect(res.headers.get("etag")).toBeTruthy();
    expect(res.headers.get("last-modified")).toBeTruthy();
    if (body?.error) expect(body.error).toBe("conflict");
  });
});
