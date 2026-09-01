/**
 * Tests for the in-memory audit log: hashing, ordering, and the bounded ring.
 */

import { describe, test, expect } from "bun:test";
import { createHash } from "crypto";
import { getAuditLog, logWrite } from "../src/audit";

function hash16(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

describe("audit log", () => {
  test("records who, when, path, action, and content hashes", () => {
    const before = getAuditLog().length;
    logWrite("tester", "notes/plan.md", "put", "new body", "old body");

    const entry = getAuditLog()[getAuditLog().length - 1];
    expect(entry.who).toBe("tester");
    expect(entry.path).toBe("notes/plan.md");
    expect(entry.action).toBe("put");
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.contentHash).toBe(hash16("new body"));
    expect(entry.prevHash).toBe(hash16("old body"));
    expect(getAuditLog().length).toBe(before + 1);
  });

  test("omits hashes when content is not supplied", () => {
    logWrite("tester", "notes/gone.md", "delete");
    const entry = getAuditLog()[getAuditLog().length - 1];
    expect(entry.action).toBe("delete");
    expect(entry.contentHash).toBeUndefined();
    expect(entry.prevHash).toBeUndefined();
  });

  test("getAuditLog returns a defensive copy", () => {
    const snapshot = getAuditLog();
    const before = snapshot.length;
    snapshot.push({
      at: "1970-01-01T00:00:00.000Z",
      who: "forger",
      path: "x.md",
      action: "put",
    });
    expect(getAuditLog().length).toBe(before);
    expect(getAuditLog().some((entry) => entry.who === "forger")).toBe(false);
  });

  test("bounds the log at 1000 entries by dropping the oldest", () => {
    for (let i = 0; i < 1001; i++) {
      logWrite("load", `bulk/${i}.md`, "put", `body-${i}`);
    }

    const log = getAuditLog();
    expect(log.length).toBe(1000);
    expect(log[log.length - 1].path).toBe("bulk/1000.md");
    expect(log[0].path).toBe("bulk/1.md");
  });
});
