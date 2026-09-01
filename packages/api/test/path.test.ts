/**
 * Tests for path traversal, allowlist enforcement, and extension checks.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync, symlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  resolveAndValidate,
  resolveAndValidateFolder,
  resolveAndValidateImage,
  resolveAndValidateTextPreview,
  hasAllowedExt,
  hasAllowedImageExt,
  hasAllowedTextPreviewExt,
  listMdUnderRoot,
  listFilesUnderRoot,
  listFoldersUnderRoot,
  getRoots,
  type RootConfig,
} from "../src/path-utils";

describe("hasAllowedExt", () => {
  test("allows .md, .mmd, and .mermaid", () => {
    expect(hasAllowedExt("a.md")).toBe(true);
    expect(hasAllowedExt("a.mmd")).toBe(true);
    expect(hasAllowedExt("diagram.mermaid")).toBe(true);
    expect(hasAllowedExt("A.MD")).toBe(true);
  });
  test("rejects other extensions", () => {
    expect(hasAllowedExt("a.txt")).toBe(false);
    expect(hasAllowedExt("a")).toBe(false);
    expect(hasAllowedExt("a.md.bak")).toBe(false);
  });
});

describe("hasAllowedImageExt", () => {
  test("allows browser-displayable raster image extensions", () => {
    expect(hasAllowedImageExt("photo.JPG")).toBe(true);
    expect(hasAllowedImageExt("diagram.png")).toBe(true);
    expect(hasAllowedImageExt("animation.gif")).toBe(true);
    expect(hasAllowedImageExt("image.webp")).toBe(true);
    expect(hasAllowedImageExt("scan.avif")).toBe(true);
    expect(hasAllowedImageExt("bitmap.bmp")).toBe(true);
  });
  test("rejects markdown, svg, and arbitrary files", () => {
    expect(hasAllowedImageExt("note.md")).toBe(false);
    expect(hasAllowedImageExt("unsafe.svg")).toBe(false);
    expect(hasAllowedImageExt("secret.txt")).toBe(false);
  });
});

describe("resolveAndValidate", () => {
  let workDir: string;
  let roots: RootConfig[];

  beforeAll(() => {
    workDir = realpathSync(mkdtempSync(join(tmpdir(), "md-ops-test-")));
    const allowed = join(workDir, "allowed");
    const outside = join(workDir, "outside");
    mkdirSync(allowed, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(allowed, "readme.md"), "# Hi");
    writeFileSync(join(allowed, "photo.jpg"), "fake jpg");
    roots = [
      { id: "docs", path: allowed },
      { id: "other", path: outside },
    ];
  });

  test("accepts valid relative path within root", () => {
    const r = resolveAndValidate(roots, "docs", "readme.md");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.absolutePath).toContain("readme.md");
  });

  test("accepts filenames with double dots that are not traversal segments", () => {
    const allowed = join(workDir, "allowed");
    writeFileSync(join(allowed, "notes..draft.md"), "# Draft");
    const r = resolveAndValidate(roots, "docs", "notes..draft.md");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.absolutePath).toContain("notes..draft.md");
  });

  test("rejects .. path traversal with 400", () => {
    const r = resolveAndValidate(roots, "docs", "../outside/foo.md");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message.toLowerCase()).toContain("traversal");
    }
  });

  test("rejects absolute path with 400", () => {
    const r = resolveAndValidate(roots, "docs", "/etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  test("rejects .. in path with 400 (path traversal)", () => {
    const r = resolveAndValidate(roots, "docs", "..");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  test("rejects non-markdown diagram extensions with 400", () => {
    const r = resolveAndValidate(roots, "docs", "file.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toContain(".mermaid");
    }
  });

  test("rejects unknown root with 404", () => {
    const r = resolveAndValidate(roots, "nonexistent", "a.md");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  test("allows new .md path under root for write", () => {
    const r = resolveAndValidate(roots, "docs", "new/file.md");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.absolutePath).toContain("new");
  });

  test("validates folder paths without requiring markdown extensions", () => {
    const r = resolveAndValidateFolder(roots, "docs", "Projects/New Folder");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.logicalPath).toBe("Projects/New Folder");
      expect(r.absolutePath).toContain("Projects");
    }
  });

  test("rejects unsafe folder paths", () => {
    for (const path of ["/absolute", "../escape", "safe/./dot", ""]) {
      const r = resolveAndValidateFolder(roots, "docs", path);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  test("validates image assets separately from markdown files", () => {
    const img = resolveAndValidateImage(roots, "docs", "photo.jpg");
    expect(img.ok).toBe(true);
    if (img.ok) expect(img.absolutePath).toContain("photo.jpg");

    const mdAsImage = resolveAndValidateImage(roots, "docs", "readme.md");
    expect(mdAsImage.ok).toBe(false);
    if (!mdAsImage.ok) expect(mdAsImage.status).toBe(400);

    const imgAsMarkdown = resolveAndValidate(roots, "docs", "photo.jpg");
    expect(imgAsMarkdown.ok).toBe(false);
    if (!imgAsMarkdown.ok) expect(imgAsMarkdown.status).toBe(400);
  });

  test("rejects path outside allowlist via symlink with 403", () => {
    const allowed = join(workDir, "allowed");
    const outside = join(workDir, "outside");
    const escapeLink = join(allowed, "escape");
    if (existsSync(escapeLink)) return;
    try {
      symlinkSync(outside, escapeLink);
    } catch {
      return;
    }
    const r = resolveAndValidate(roots, "docs", "escape/outside.md");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  test("rejects symlink target that only shares the root path prefix", () => {
    const allowed = join(workDir, "allowed");
    const prefixOutside = join(workDir, "allowed-escape");
    mkdirSync(prefixOutside, { recursive: true });
    writeFileSync(join(prefixOutside, "secret.md"), "# nope");
    const escapeLink = join(allowed, "prefix-escape");
    if (!existsSync(escapeLink)) {
      try {
        symlinkSync(prefixOutside, escapeLink, "dir");
      } catch {
        return;
      }
    }
    const r = resolveAndValidate(roots, "docs", "prefix-escape/secret.md");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
});

describe("listMdUnderRoot", () => {
  test("returns only markdown/mermaid files under root", () => {
    const workDir = realpathSync(mkdtempSync(join(tmpdir(), "md-ops-tree-")));
    mkdirSync(join(workDir, "sub"), { recursive: true });
    mkdirSync(join(workDir, ".venv"), { recursive: true });
    writeFileSync(join(workDir, "b.mmd"), "");
    writeFileSync(join(workDir, "a.md"), "");
    writeFileSync(join(workDir, "diagram.mermaid"), "");
    writeFileSync(join(workDir, "c.txt"), "");
    writeFileSync(join(workDir, ".venv", "README.md"), "");
    writeFileSync(join(workDir, "sub", "z.md"), "");
    writeFileSync(join(workDir, "sub", "d.md"), "");
    const files = listMdUnderRoot(workDir, ".");
    expect(files).toEqual(["a.md", "b.mmd", "diagram.mermaid", "sub/d.md", "sub/z.md"]);
    expect(listFoldersUnderRoot(workDir, ".")).toEqual(["sub"]);
  });

  test("returns visible non-markdown files while skipping obvious secret files", () => {
    const workDir = realpathSync(mkdtempSync(join(tmpdir(), "md-ops-all-files-")));
    mkdirSync(join(workDir, "sub"), { recursive: true });
    writeFileSync(join(workDir, "a.md"), "");
    writeFileSync(join(workDir, "sub", "data.json"), "{}");
    writeFileSync(join(workDir, "sub", "image.png"), "png");
    writeFileSync(join(workDir, ".env"), "SECRET=1");
    writeFileSync(join(workDir, "private.key"), "SECRET");
    writeFileSync(join(workDir, "sub", ".env.local"), "SECRET=1");
    writeFileSync(join(workDir, "sub", "id_ed25519"), "SECRET");

    expect(listFilesUnderRoot(workDir, ".")).toEqual(["a.md", "sub/data.json", "sub/image.png"]);
  });

  test("rejects direct preview requests for secret-named files even when the extension looks safe", () => {
    const workDir = realpathSync(mkdtempSync(join(tmpdir(), "md-ops-preview-secrets-")));
    const allowed = join(workDir, "allowed");
    mkdirSync(allowed, { recursive: true });
    writeFileSync(join(allowed, ".env"), "SECRET=1");
    writeFileSync(join(allowed, "id_rsa"), "SECRET");
    writeFileSync(join(allowed, "server.pem"), "SECRET");
    const roots = [{ id: "docs", path: allowed }];

    for (const name of [".env", "id_rsa", "server.pem"]) {
      const r = resolveAndValidateTextPreview(roots, "docs", name);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  test("returns empty for directories that only share the root path prefix", () => {
    const workDir = realpathSync(mkdtempSync(join(tmpdir(), "md-ops-tree-prefix-")));
    const root = join(workDir, "allowed");
    const outside = join(workDir, "allowed-escape");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "leak.md"), "");
    expect(listMdUnderRoot(root, "../allowed-escape")).toEqual([]);
  });
});

describe("hasAllowedTextPreviewExt", () => {
  test("allows markdown, safe text/code/data extensions, and .md.bak", () => {
    expect(hasAllowedTextPreviewExt("a.md")).toBe(true);
    expect(hasAllowedTextPreviewExt("data.json")).toBe(true);
    expect(hasAllowedTextPreviewExt("script.py")).toBe(true);
    expect(hasAllowedTextPreviewExt("board.excalidraw")).toBe(true);
    expect(hasAllowedTextPreviewExt("notes.md.bak")).toBe(true);
    expect(hasAllowedTextPreviewExt("NOTES.MD.BAK")).toBe(true);
  });
  test("rejects executables, secrets, and unknown binaries", () => {
    expect(hasAllowedTextPreviewExt("a.exe")).toBe(false);
    expect(hasAllowedTextPreviewExt("id_rsa")).toBe(false);
    expect(hasAllowedTextPreviewExt("server.key")).toBe(false);
    expect(hasAllowedTextPreviewExt("archive.zip")).toBe(false);
    expect(hasAllowedTextPreviewExt("a.md.exe")).toBe(false);
    expect(hasAllowedTextPreviewExt("a.md.backup")).toBe(false);
    expect(hasAllowedTextPreviewExt("notes.md.bak2")).toBe(false);
  });
});

describe("resolveAndValidate input edge cases", () => {
  let workDir: string;
  let roots: RootConfig[];

  beforeAll(() => {
    workDir = realpathSync(mkdtempSync(join(tmpdir(), "md-ops-edge-")));
    const allowed = join(workDir, "allowed");
    mkdirSync(allowed, { recursive: true });
    writeFileSync(join(allowed, "data.json"), "{}");
    writeFileSync(join(allowed, "readme.md"), "# Hi");
    roots = [{ id: "docs", path: allowed }];
  });

  test("rejects an empty logical path with 400", () => {
    const r = resolveAndValidate(roots, "docs", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  test("rejects backslash-based traversal with 400", () => {
    for (const path of ["..\\..\\etc\\passwd.md", "sub\\..\\..\\escape.md"]) {
      const r = resolveAndValidate(roots, "docs", path);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  test("accepts an explicit ./ prefix that stays inside the root", () => {
    const r = resolveAndValidate(roots, "docs", "./readme.md");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.absolutePath).toContain("readme.md");
  });

  test("accepts a new file whose parent directories do not exist yet", () => {
    const r = resolveAndValidate(roots, "docs", "new/nested/write.md");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.absolutePath).toContain(join("new", "nested", "write.md"));
  });

  test("rejects a new file under a symlinked parent that escapes the root with 403", () => {
    const allowed = join(workDir, "allowed-edge-escape");
    const outside = join(workDir, "outside-edge");
    mkdirSync(allowed, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const escapeLink = join(allowed, "escape-link");
    try {
      symlinkSync(outside, escapeLink);
    } catch {
      return;
    }
    const rootsWithEscape: RootConfig[] = [{ id: "docs", path: allowed }];
    const r = resolveAndValidate(rootsWithEscape, "docs", "escape-link/not-created-yet.md");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  test("resolves text previews through their own extension allowlist", () => {
    const ok = resolveAndValidateTextPreview(roots, "docs", "data.json");
    expect(ok.ok).toBe(true);

    const asMarkdown = resolveAndValidate(roots, "docs", "data.json");
    expect(asMarkdown.ok).toBe(false);
    if (!asMarkdown.ok) {
      expect(asMarkdown.status).toBe(400);
      expect(asMarkdown.message).toContain(".mermaid");
    }
  });
});

describe("getRoots", () => {
  test("returns strictly validated MD_OPS_ROOTS JSON", () => {
    const prev = process.env.MD_OPS_ROOTS;
    const workDir = mkdtempSync(join(tmpdir(), "md-ops-roots-"));
    const first = join(workDir, "first");
    const second = join(workDir, "second");
    mkdirSync(first);
    mkdirSync(second);
    process.env.MD_OPS_ROOTS = JSON.stringify([{ id: "r1", path: first }, { id: "r2", path: second }]);
    const roots = getRoots();
    expect(roots).toHaveLength(2);
    expect(roots[0]).toEqual({ id: "r1", path: first });
    if (prev !== undefined) process.env.MD_OPS_ROOTS = prev;
    else delete process.env.MD_OPS_ROOTS;
  });
  test("returns empty when unset or invalid", () => {
    const prev = process.env.MD_OPS_ROOTS;
    delete process.env.MD_OPS_ROOTS;
    expect(getRoots()).toHaveLength(0);
    process.env.MD_OPS_ROOTS = "not json";
    expect(getRoots()).toHaveLength(0);
    if (prev !== undefined) process.env.MD_OPS_ROOTS = prev;
  });
});
