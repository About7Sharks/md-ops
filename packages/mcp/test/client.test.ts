import { describe, expect, test } from "bun:test";
import { MdOpsClient, type FetchLike } from "../src/client.js";

describe("MD Ops MCP client", () => {
  test("rejects absent or unsafe service URLs", () => {
    expect(() => new MdOpsClient({})).toThrow("MD_OPS_API_URL is required");
    expect(() => new MdOpsClient({ MD_OPS_API_URL: "file:///vault" })).toThrow("HTTP(S)");
    expect(() => new MdOpsClient({ MD_OPS_API_URL: "https://user:secret@example.invalid" })).toThrow("must not contain credentials");
  });

  test("uses a configured base path and never adds credentials to URLs", async () => {
    let received: Request | undefined;
    const fetchImpl: FetchLike = async (input, init) => {
      received = new Request(input, init);
      return new Response(JSON.stringify({ roots: [{ id: "docs", label: "Docs" }] }), { headers: { "Content-Type": "application/json" } });
    };
    const client = new MdOpsClient({ MD_OPS_API_URL: "https://example.invalid/md-ops", MD_OPS_API_BEARER_TOKEN: "token" }, fetchImpl);
    await expect(client.listRoots()).resolves.toEqual([{ id: "docs", label: "Docs" }]);
    expect(received?.url).toBe("https://example.invalid/md-ops/api/roots");
    expect(received?.headers.get("Authorization")).toBe("Bearer token");
  });

  test("keeps root service URLs on the configured host", async () => {
    let receivedUrl = "";
    const fetchImpl: FetchLike = async (input) => {
      receivedUrl = new Request(input).url;
      return new Response(JSON.stringify({ roots: [] }), { headers: { "Content-Type": "application/json" } });
    };

    await new MdOpsClient({ MD_OPS_API_URL: "https://example.invalid" }, fetchImpl).listRoots();
    expect(receivedUrl).toBe("https://example.invalid/api/roots");
  });

  test("creates an MD Ops read URL from a logical file path", () => {
    const client = new MdOpsClient({ MD_OPS_API_URL: "https://example.invalid/app/md-ops" });
    const url = new URL(client.browserFileUrl("docs/Guide/New Note.md"));
    expect(url.origin).toBe("https://example.invalid");
    expect(url.pathname).toBe("/app/md-ops/");
    expect(url.searchParams.get("root")).toBe("docs");
    expect(url.searchParams.get("path")).toBe("Guide/New Note.md");
    expect(url.searchParams.get("view")).toBe("read");
  });

  test("normalizes ranked QMD retrieval results to logical paths and browser links", async () => {
    let receivedUrl = "";
    const fetchImpl: FetchLike = async (input) => {
      receivedUrl = new Request(input).url;
      return new Response(JSON.stringify({
        root: "obsidian-vault",
        query: "retrieval design",
        mode: "keyword",
        results: [{ path: "Systems/Code/md-ops Stack.md", title: "md-ops Stack", score: 0.93, excerpt: "QMD plan" }],
        total: 1,
      }), { headers: { "Content-Type": "application/json" } });
    };

    const client = new MdOpsClient({ MD_OPS_API_URL: "https://example.invalid/app/md-ops" }, fetchImpl);
    await expect(client.retrieve("obsidian-vault", "retrieval design", 5)).resolves.toEqual({
      root: "obsidian-vault",
      query: "retrieval design",
      mode: "keyword",
      results: [{
        path: "obsidian-vault/Systems/Code/md-ops Stack.md",
        title: "md-ops Stack",
        score: 0.93,
        excerpt: "QMD plan",
        url: "https://example.invalid/app/md-ops/?root=obsidian-vault&path=Systems%2FCode%2Fmd-ops+Stack.md&view=read",
      }],
      total: 1,
    });
    expect(receivedUrl).toBe("https://example.invalid/app/md-ops/api/retrieve?root=obsidian-vault&q=retrieval+design&limit=5");
  });

  test("sends an explicit confirmation and conditional headers for writes", async () => {
    let received: Request | undefined;
    const fetchImpl: FetchLike = async (input, init) => {
      received = new Request(input, init);
      return new Response(JSON.stringify({ ok: true }), { headers: { ETag: "W/\\\"test\\\"" } });
    };
    const client = new MdOpsClient({ MD_OPS_API_URL: "https://example.invalid" }, fetchImpl);
    const result = await client.writeFile("docs/readme.md", "# Updated", "W/\\\"old\\\"");
    expect(received?.headers.get("X-Confirm-Write")).toBe("1");
    expect(received?.headers.get("If-Match")).toBe("W/\\\"old\\\"");
    expect(result.url).toBe("https://example.invalid/?root=docs&path=readme.md&view=read");
  });
});
