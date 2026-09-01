import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mutationsEnabled, serverBinding, validateRuntimeConfig } from "../src/config";
import { fetchHandler } from "../src/handler";

const originalRoots = process.env.MD_OPS_ROOTS;
const bundledUiDir = join(import.meta.dir, "../ui");
let createdBundledUiFixture = false;

beforeAll(() => {
  if (existsSync(bundledUiDir)) return;
  mkdirSync(join(bundledUiDir, "assets"), { recursive: true });
  writeFileSync(join(bundledUiDir, "index.html"), "<!doctype html><script src=\"./assets/app.js\"></script>");
  writeFileSync(join(bundledUiDir, "assets", "app.js"), "");
  createdBundledUiFixture = true;
});

afterAll(() => {
  if (createdBundledUiFixture) rmSync(bundledUiDir, { recursive: true, force: true });
});

function validRoot(): string {
  return mkdtempSync(join(tmpdir(), "md-ops-ready-"));
}

afterEach(() => {
  if (originalRoots === undefined) delete process.env.MD_OPS_ROOTS;
  else process.env.MD_OPS_ROOTS = originalRoots;
});

describe("runtime configuration", () => {
  test("validates the server bind host and port", () => {
    expect(serverBinding({})).toEqual({ host: "127.0.0.1", port: 3098 });
    expect(serverBinding({ HOST: "127.0.0.1", PORT: "4100" })).toEqual({ host: "127.0.0.1", port: 4100 });
    expect(() => serverBinding({ HOST: "bad host", PORT: "3098" })).toThrow("Invalid HOST");
    expect(() => serverBinding({ PORT: "0" })).toThrow("Invalid PORT");
    expect(() => serverBinding({ PORT: "3098junk" })).toThrow("Invalid PORT");
  });

  test("enables mutations only for an exact true flag", () => {
    expect(mutationsEnabled({})).toBe(false);
    expect(mutationsEnabled({ MD_OPS_ALLOW_MUTATIONS: "true" })).toBe(true);
    for (const value of ["TRUE", " true", "true ", "1", "yes", "on", "false", ""]) {
      expect(mutationsEnabled({ MD_OPS_ALLOW_MUTATIONS: value })).toBe(false);
    }
  });

  test("accepts existing readable writable absolute directories and sanitizes labels", () => {
    const root = validRoot();
    writeFileSync(join(root, "Dashboard.md"), "# Dashboard\n");
    const result = validateRuntimeConfig({
      MD_OPS_ROOTS: JSON.stringify([{ id: "docs", path: root, label: "  Team\nNotes  ", home: "/Dashboard.md" }]),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.roots).toEqual([{ id: "docs", path: root, label: "Team Notes", home: "Dashboard.md" }]);
      expect(result.config.mutationsEnabled).toBe(false);
    }
  });

  test("rejects unsafe or missing root home notes", () => {
    const root = validRoot();
    for (const home of ["../outside.md", "missing.md", "folder/", "Dashboard.txt"]) {
      const result = validateRuntimeConfig({ MD_OPS_ROOTS: JSON.stringify([{ id: "docs", path: root, home }]) });
      expect(result.ok).toBe(false);
    }
  });

  test("rejects empty, malformed, duplicate, unsafe, and inaccessible root configuration", () => {
    const root = validRoot();
    const scenarios = [
      undefined,
      "not-json",
      "[]",
      JSON.stringify([{ id: "docs", path: root }, { id: "docs", path: root }]),
      JSON.stringify([{ id: "not/safe", path: root }]),
      JSON.stringify([{ id: "docs", path: "relative/root" }]),
      JSON.stringify([{ id: "docs", path: join(root, "missing") }]),
      JSON.stringify([{ id: "filesystem", path: "/" }]),
    ];

    for (const roots of scenarios) {
      const result = validateRuntimeConfig({ MD_OPS_ROOTS: roots });
      expect(result.ok).toBe(false);
    }
  });

  test("rejects duplicate and nested physical roots even when IDs differ", () => {
    const root = validRoot();
    const nested = join(root, "nested");
    mkdirSync(nested);

    const duplicate = validateRuntimeConfig({
      MD_OPS_ROOTS: JSON.stringify([{ id: "one", path: root }, { id: "two", path: root }]),
    });
    expect(duplicate.ok).toBe(false);

    const overlap = validateRuntimeConfig({
      MD_OPS_ROOTS: JSON.stringify([{ id: "one", path: root }, { id: "two", path: nested }]),
    });
    expect(overlap.ok).toBe(false);
  });
});

describe("health endpoints", () => {
  test("preserves /health and exposes live and ready checks without path disclosure", async () => {
    const root = validRoot();
    writeFileSync(join(root, "Dashboard.md"), "# Dashboard\n");
    process.env.MD_OPS_ROOTS = JSON.stringify([{ id: "docs", path: root, label: "Docs", home: "Dashboard.md" }]);
    process.env.MD_OPS_ALLOW_MUTATIONS = "false";

    const health = await fetchHandler(new Request("https://localhost/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 200 });

    const live = await fetchHandler(new Request("https://localhost/healthz"));
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 200 });

    const ready = await fetchHandler(new Request("https://localhost/readyz"));
    expect(ready.status).toBe(200);
    const body = await ready.json();
    expect(body).toEqual({ ready: true, roots: [{ id: "docs", label: "Docs", home: "Dashboard.md" }], writes: "disabled", ui: "bundled" });
    expect(JSON.stringify(body)).not.toContain(root);
  });

  test("returns a redacted 503 when root configuration is no longer ready", async () => {
    process.env.MD_OPS_ROOTS = JSON.stringify([{ id: "docs", path: "/private/not-present" }]);

    const live = await fetchHandler(new Request("https://localhost/healthz"));
    expect(live.status).toBe(200);

    const ready = await fetchHandler(new Request("https://localhost/readyz"));
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ ready: false });
  });
});
