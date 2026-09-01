import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fetchHandler } from "../src/handler";

const originalRoots = process.env.MD_OPS_ROOTS;
const originalMutations = process.env.MD_OPS_ALLOW_MUTATIONS;

afterEach(() => {
  if (originalRoots === undefined) delete process.env.MD_OPS_ROOTS;
  else process.env.MD_OPS_ROOTS = originalRoots;
  if (originalMutations === undefined) delete process.env.MD_OPS_ALLOW_MUTATIONS;
  else process.env.MD_OPS_ALLOW_MUTATIONS = originalMutations;
});

describe("safe mutation mode", () => {
  test("denies a confirmed write until mutations are explicitly enabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "md-ops-read-only-"));
    writeFileSync(join(root, "note.md"), "# Before\n");
    process.env.MD_OPS_ROOTS = JSON.stringify([{ id: "docs", path: root }]);
    delete process.env.MD_OPS_ALLOW_MUTATIONS;

    const response = await fetchHandler(
      new Request("http://localhost/api/file?path=docs/note.md", {
        method: "PUT",
        headers: { "X-Confirm-Write": "1" },
        body: "# After\n",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "mutations are disabled; set MD_OPS_ALLOW_MUTATIONS=true only for a trusted local service",
    });
  });
});
