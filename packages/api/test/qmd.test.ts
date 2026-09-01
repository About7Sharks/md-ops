import { afterEach, describe, expect, test } from "bun:test";
import {
  MAX_RETRIEVE_LIMIT,
  normalizeQmdResults,
  parseRetrieveLimit,
  qmdCollectionForRoot,
  qmdPathKey,
  retrieveWithQmd,
  setQmdRunnerForTests,
} from "../src/qmd";

afterEach(() => setQmdRunnerForTests());

describe("QMD retrieval", () => {
  test("maps a normalized QMD URI to a canonical logical path", () => {
    const results = normalizeQmdResults(
      [{
        file: "qmd://obsidian/systems/code/md-ops-stack.md",
        title: "md-ops Stack",
        score: 0.93,
        snippet: "@@ -99,4 @@\nA concise result.",
      }],
      "obsidian",
      ["Systems/Code/md-ops Stack.md"],
      5,
    );

    expect(results).toEqual([{
      path: "Systems/Code/md-ops Stack.md",
      title: "md-ops Stack",
      score: 0.93,
      excerpt: "@@ -99,4 @@ A concise result.",
    }]);
  });

  test("drops foreign, unknown, duplicate, and ambiguous QMD results", () => {
    const results = normalizeQmdResults(
      [
        { file: "qmd://other/plan.md", title: "Foreign", score: 1, snippet: "x" },
        { file: "qmd://obsidian/missing.md", title: "Missing", score: 1, snippet: "x" },
        { file: "qmd://obsidian/../plan.md", title: "Traversal", score: 1, snippet: "x" },
        { file: "qmd://obsidian/plan.md", title: "Plan", score: 1, snippet: "x" },
        { file: "qmd://obsidian/plan.md", title: "Plan", score: 1, snippet: "x" },
        { file: "qmd://obsidian/a-b.md", title: "Collision", score: 1, snippet: "x" },
      ],
      "obsidian",
      ["Plan.md", "A B.md", "A-B.md"],
      5,
    );

    expect(results).toEqual([{ path: "Plan.md", title: "Plan", score: 1, excerpt: "x" }]);
  });

  test("uses a strict bounded keyword-only QMD command", async () => {
    let receivedArgs: string[] | undefined;
    setQmdRunnerForTests(async (args) => {
      receivedArgs = args;
      return {
        exitCode: 0,
        stdout: JSON.stringify([{ file: "qmd://fixture/roadmap.md", title: "Roadmap", score: 0.8, snippet: "matched" }]),
        stderr: "",
      };
    });

    const results = await retrieveWithQmd("  retrieval plan  ", "fixture", ["Roadmap.md"], 1);
    expect(receivedArgs).toEqual(["search", "retrieval plan", "-c", "fixture", "-n", "1", "--json"]);
    expect(results).toEqual([{ path: "Roadmap.md", title: "Roadmap", score: 0.8, excerpt: "matched" }]);
  });

  test("clamps the public result limit and reads only valid root mappings", () => {
    expect(parseRetrieveLimit(null)).toBe(3);
    expect(parseRetrieveLimit("0")).toBe(1);
    expect(parseRetrieveLimit("999")).toBe(MAX_RETRIEVE_LIMIT);
    expect(qmdCollectionForRoot("obsidian-vault", { MD_OPS_QMD_ROOTS: '{"obsidian-vault":"obsidian"}' })).toBe("obsidian");
    expect(qmdCollectionForRoot("repos", { MD_OPS_QMD_ROOTS: '{"obsidian-vault":"obsidian"}' })).toBeNull();
    expect(qmdCollectionForRoot("obsidian-vault", { MD_OPS_QMD_ROOTS: "not-json" })).toBeNull();
    expect(qmdPathKey("Systems/Code/md-ops Stack.md")).toBe("systems/code/md-ops-stack.md");
  });
});

describe("qmdPathKey edge cases", () => {
  test("folds case, NFKC variants, and separator runs into one stable key", () => {
    expect(qmdPathKey("UPPER.MD")).toBe("upper.md");
    expect(qmdPathKey("\uFB01le.md")).toBe("file.md");
    expect(qmdPathKey("Café Notes.md")).toBe("café-notes.md");
    expect(qmdPathKey("spaced   --  name.md")).toBe("spaced-name.md");
    expect(qmdPathKey("Folder/Sub/Note.md")).toBe("folder/sub/note.md");
  });

  test("collides dotfiles with their visible twin so ambiguous lookups drop", () => {
    const results = normalizeQmdResults(
      [{ file: "qmd://c/notes/hidden.md", title: "Hidden", score: 1, snippet: "x" }],
      "c",
      ["Notes/.hidden.md", "Notes/hidden.md"],
      5,
    );
    // Both files slug to notes/hidden.md, the lookup is marked ambiguous,
    // and no result may be returned rather than a wrong note.
    expect(results).toEqual([]);
  });
});

describe("parseRetrieveLimit edge cases", () => {
  test("falls back to the default for null and non-numeric input", () => {
    expect(parseRetrieveLimit(null)).toBe(3);
    expect(parseRetrieveLimit("abc")).toBe(3);
    expect(parseRetrieveLimit("")).toBe(3);
  });

  test("clamps negative and fractional input into the allowed range", () => {
    expect(parseRetrieveLimit("-5")).toBe(1);
    expect(parseRetrieveLimit("3.7")).toBe(3);
    expect(parseRetrieveLimit("+4")).toBe(4);
    expect(parseRetrieveLimit("8")).toBe(MAX_RETRIEVE_LIMIT);
    expect(parseRetrieveLimit("9")).toBe(MAX_RETRIEVE_LIMIT);
  });
});

describe("qmdCollectionForRoot validation", () => {
  test("rejects malformed collections and mappings", () => {
    const invalidPayloads = [
      undefined,
      "   ",
      '["obsidian"]',
      '{"obsidian": 42}',
      '{"obsidian":"-bad-start"}',
      '{"obsidian":"has space"}',
      `{"obsidian":"${"a".repeat(65)}"}`,
    ];
    for (const raw of invalidPayloads) {
      expect(qmdCollectionForRoot("obsidian", raw === undefined ? {} : { MD_OPS_QMD_ROOTS: raw })).toBeNull();
    }
  });

  test("accepts the full allowed collection shape", () => {
    expect(qmdCollectionForRoot("obsidian", { MD_OPS_QMD_ROOTS: '{"obsidian":"Vault_01-a"}' })).toBe("Vault_01-a");
  });
});

describe("retrieveWithQmd error handling", () => {
  test("rejects blank and over-length queries without spawning QMD", async () => {
    let spawned = false;
    setQmdRunnerForTests(async () => {
      spawned = true;
      return { exitCode: 0, stdout: "[]", stderr: "" };
    });

    await expect(retrieveWithQmd("   ", "c", [], 3)).rejects.toThrow("QMD query is invalid");
    await expect(retrieveWithQmd("x".repeat(501), "c", [], 3)).rejects.toThrow("QMD query is invalid");
    expect(spawned).toBe(false);
  });

  test("maps a crashing runner to an availability error", async () => {
    setQmdRunnerForTests(async () => {
      throw new Error("spawn failed");
    });
    await expect(retrieveWithQmd("query", "c", [], 3)).rejects.toThrow("QMD retrieval is unavailable");
  });

  test("rejects a non-zero QMD exit code", async () => {
    setQmdRunnerForTests(async () => ({ exitCode: 2, stdout: "", stderr: "boom" }));
    await expect(retrieveWithQmd("query", "c", [], 3)).rejects.toThrow("QMD retrieval is unavailable");
  });

  test("rejects oversized QMD output", async () => {
    setQmdRunnerForTests(async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{ file: "qmd://c/a.md" }]) + " ".repeat(64 * 1024),
      stderr: "",
    }));
    await expect(retrieveWithQmd("query", "c", ["a.md"], 3)).rejects.toThrow("QMD retrieval is unavailable");
  });

  test("rejects invalid JSON from QMD", async () => {
    setQmdRunnerForTests(async () => ({ exitCode: 0, stdout: "{not json", stderr: "" }));
    await expect(retrieveWithQmd("query", "c", [], 3)).rejects.toThrow("QMD returned invalid JSON");
  });

  test("rejects a non-array JSON payload", async () => {
    setQmdRunnerForTests(async () => ({ exitCode: 0, stdout: '{"results":[]}', stderr: "" }));
    await expect(retrieveWithQmd("query", "c", [], 3)).rejects.toThrow("QMD returned an invalid result payload");
  });
});

describe("normalizeQmdResults sanitization", () => {
  test("normalizes titles, scores, and excerpts from hostile payloads", () => {
    const results = normalizeQmdResults(
      [
        { file: "qmd://c/note.md", title: "  Multi\n\nspace \t title  ", score: Number.NaN, snippet: "a\n\n b   c" },
        { file: "qmd://c/other.md", score: "not-a-number", snippet: 42 },
      ],
      "c",
      ["Note.md", "Other.md"],
      5,
    );

    expect(results).toEqual([
      { path: "Note.md", title: "Multi space title", score: 0, excerpt: "a b c" },
      { path: "Other.md", title: "Other.md", score: 0, excerpt: "" },
    ]);
  });

  test("caps results at the requested limit and rejects traversal segments", () => {
    const raw = [
      { file: "qmd://c/../escape.md", title: "Escape" },
      { file: "qmd://c//double-slash.md", title: "Empty segment" },
      { file: "qmd://c/./dot.md", title: "Dot segment" },
      ...Array.from({ length: 5 }, (_, i) => ({ file: `qmd://c/f${i}.md`, title: `F${i}` })),
    ];
    const results = normalizeQmdResults(raw, "c", ["F0.md", "F1.md"], 2);
    expect(results.map((r) => r.path)).toEqual(["F0.md", "F1.md"]);
  });

  test("throws on a non-array payload", () => {
    expect(() => normalizeQmdResults({ results: [] }, "c", [], 3)).toThrow("invalid result payload");
  });
});
