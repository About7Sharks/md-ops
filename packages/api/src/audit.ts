/**
 * Audit log for write operations: who, when, path, diff hash.
 */

import { createHash } from "crypto";

export interface AuditEntry {
  at: string;
  who: string;
  path: string;
  action: "put" | "rename" | "delete";
  contentHash?: string;
  prevHash?: string;
}

const auditEntries: AuditEntry[] = [];
const MAX_AUDIT = 1000;

function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export function logWrite(
  who: string,
  path: string,
  action: "put" | "rename" | "delete",
  content?: string,
  prevContent?: string
): void {
  const entry: AuditEntry = {
    at: new Date().toISOString(),
    who,
    path,
    action,
  };
  if (content !== undefined) entry.contentHash = contentHash(content);
  if (prevContent !== undefined) entry.prevHash = contentHash(prevContent);
  auditEntries.push(entry);
  if (auditEntries.length > MAX_AUDIT) auditEntries.shift();
}

export function getAuditLog(): AuditEntry[] {
  return [...auditEntries];
}
