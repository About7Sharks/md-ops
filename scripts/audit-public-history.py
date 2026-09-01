#!/usr/bin/env python3
"""Fail closed on private-environment markers in reachable Git blobs.

The script reports categories and paths, never the matched text. Gitleaks remains
an independent full-history secret scan.
"""

from __future__ import annotations

import re
import subprocess
import sys
from collections import defaultdict

PATTERNS: dict[str, re.Pattern[bytes]] = {
    "linux-user-directory": re.compile(rb"/home/[^/\s]+"),
    "mac-user-directory": re.compile(rb"/Users/[^/\s]+"),
    "windows-user-directory": re.compile(rb"[A-Za-z]:\\\\Users\\\\[^\\\\\s]+"),
    "private-ipv4": re.compile(
        rb"\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b"
    ),
    "tailnet-hostname": re.compile(rb"\b[a-zA-Z0-9-]+\.ts\.net\b"),
    "private-ops-directory": re.compile(rb"(?:\.hermes|\.openclaw|Obsidian Vault)"),
}

SELF_AUDIT_FILES = {
    "scripts/audit-public-history.py",
    "scripts/audit-public-tree.sh",
}
SKIP_SUFFIXES = {
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".pdf",
    ".png",
    ".webp",
}
MAX_BLOB_BYTES = 10 * 1024 * 1024


def git(*args: str, input_bytes: bytes | None = None) -> bytes:
    result = subprocess.run(
        ["git", *args],
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(message or f"git {' '.join(args)} failed")
    return result.stdout


def main() -> int:
    try:
        git("rev-parse", "--is-inside-work-tree")
        objects = git("rev-list", "--objects", "--all").splitlines()
    except RuntimeError as error:
        print(f"History audit could not read Git history: {error}", file=sys.stderr)
        return 2

    if not objects:
        print("History audit requires at least one reachable commit.", file=sys.stderr)
        return 2

    paths_by_oid: dict[str, set[str]] = defaultdict(set)
    for line in objects:
        decoded = line.decode("utf-8", "surrogateescape")
        oid, _, path = decoded.partition(" ")
        if path:
            paths_by_oid[oid].add(path)

    findings: dict[str, set[str]] = defaultdict(set)
    scanned_blobs = 0
    skipped_large = 0

    for oid, paths in paths_by_oid.items():
        if paths and paths.issubset(SELF_AUDIT_FILES):
            continue
        try:
            if git("cat-file", "-t", oid).strip() != b"blob":
                continue
            size = int(git("cat-file", "-s", oid).strip())
            if size > MAX_BLOB_BYTES:
                skipped_large += 1
                continue
            if paths and all(any(path.lower().endswith(suffix) for suffix in SKIP_SUFFIXES) for path in paths):
                continue
            data = git("cat-file", "blob", oid)
        except (RuntimeError, ValueError) as error:
            print(f"History audit could not inspect object {oid}: {error}", file=sys.stderr)
            return 2

        if b"\x00" in data:
            continue
        scanned_blobs += 1
        label_paths = paths or {f"object:{oid[:12]}"}
        for category, pattern in PATTERNS.items():
            if pattern.search(data):
                findings[category].update(label_paths)

    if skipped_large:
        print(
            f"History audit skipped {skipped_large} blob(s) over {MAX_BLOB_BYTES} bytes; review them separately.",
            file=sys.stderr,
        )
        return 2

    if findings:
        print("Public-history audit failed. Private-environment markers were found:", file=sys.stderr)
        for category in sorted(findings):
            paths = sorted(findings[category])
            preview = ", ".join(paths[:8])
            if len(paths) > 8:
                preview += f", ... {len(paths) - 8} more"
            print(f"- {category}: {len(paths)} path(s): {preview}", file=sys.stderr)
        return 1

    print(f"Public-history audit passed: {scanned_blobs} reachable text blob(s) checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
