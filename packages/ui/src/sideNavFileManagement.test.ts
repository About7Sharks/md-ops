import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const api = readFileSync(new URL("./api.ts", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = app.indexOf(start);
  const endIndex = app.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return app.slice(startIndex, endIndex);
}

function sourceLine(fragment: string): string {
  const line = app.split("\n").find((candidate) => candidate.includes(fragment));
  expect(line).toBeDefined();
  return line ?? "";
}

describe("side-navigation file management", () => {
  it("keeps side-navigation creation independent from the document editor mode", () => {
    const submitAction = sourceBetween(
      "const submitSideNavAction = useCallback",
      "const confirmSideNavAction = useCallback"
    );
    const rootCreateButton = sourceLine('title="New folder" aria-label="New folder"');
    const nestedCreateButton = sourceLine("aria-label={`New folder in ${node.path}`}");

    expect(submitAction).toContain("setSideNavConfirmation({ action: 'create-file', path: relPath })");
    expect(submitAction).toContain("setSideNavConfirmation({ action: 'create-folder', path: relPath })");
    expect(submitAction).not.toContain("writeMode");
    expect(rootCreateButton).not.toContain("writeMode");
    expect(nestedCreateButton).not.toContain("writeMode");
  });

  it("defers every side-navigation create or delete mutation until Confirm", () => {
    const submitAction = sourceBetween(
      "const submitSideNavAction = useCallback",
      "const confirmSideNavAction = useCallback"
    );
    const confirmAction = sourceBetween(
      "const confirmSideNavAction = useCallback",
      "const cancelSideNavConfirmation = useCallback"
    );
    const cancelAction = sourceBetween(
      "const cancelSideNavConfirmation = useCallback",
      "const requestSideNavFileDelete = useCallback"
    );

    expect(submitAction).not.toContain("createFile(activeRoot");
    expect(submitAction).not.toContain("createFolderApi(activeRoot");
    expect(confirmAction).toContain("createFile(activeRoot, sideNavConfirmation.path");
    expect(confirmAction).toContain("createFolderApi(activeRoot, sideNavConfirmation.path)");
    expect(confirmAction).toContain("deleteFile(activeRoot, sideNavConfirmation.path)");
    expect(confirmAction).toContain("deleteFolderApi(activeRoot, sideNavConfirmation.path)");
    expect(cancelAction).toContain("setSideNavConfirmation(null)");
    expect(cancelAction).not.toMatch(/createFile|createFolderApi|deleteFile|deleteFolderApi/);
  });

  it("allows side-navigation deletes without enabling Write On", () => {
    const requestFileDelete = sourceBetween(
      "const requestSideNavFileDelete = useCallback",
      "const requestSideNavFolderDelete = useCallback"
    );
    const requestFolderDelete = sourceBetween(
      "const requestSideNavFolderDelete = useCallback",
      "const handleDeleteFile = useCallback"
    );
    const fileDeleteButton = sourceLine("title={isMarkdownFile(node.path) ? 'Delete file'");
    const folderDeleteButton = sourceLine('title="Delete folder"');

    expect(requestFileDelete).not.toContain("writeMode");
    expect(requestFolderDelete).not.toContain("writeMode");
    expect(fileDeleteButton).toContain("disabled={!isMarkdownFile(node.path)}");
    expect(fileDeleteButton).toContain("requestSideNavFileDelete(node.path)");
    expect(folderDeleteButton).not.toContain("disabled=");
    expect(folderDeleteButton).toContain("requestSideNavFolderDelete(node.path)");
  });

  it("renders an accessible confirm/cancel popup while preserving API and toolbar protections", () => {
    const toolbarDeleteHandler = sourceBetween(
      "const handleDeleteFile = useCallback",
      "const handleSave = useCallback"
    );
    const toolbarDeleteButton = sourceLine(">Delete File</button>");

    expect(app).toContain('role="alertdialog"');
    expect(app).toContain('>Cancel</button>');
    expect(app).toContain("'Confirm'}");
    expect(app).toContain("event.key === 'Tab' && sideNavStatus !== 'working'");
    expect(app).toContain("event.target === sideNavCancelRef.current ? sideNavConfirmRef : sideNavCancelRef");
    expect(api.match(/method: 'DELETE',\s+headers: \{ 'X-Confirm-Write': '1' \}/g)).toHaveLength(2);
    expect(toolbarDeleteHandler).toContain("if (!writeMode) return");
    expect(toolbarDeleteButton).toContain("disabled={!writeMode");
    expect(app).toContain("Controls document editing only");
    expect(app).toContain("Explorer file management remains available");
  });

  it("uses clear folder creation and stable folder-tone affordances without changing file badges", () => {
    expect(app).toContain("function FolderPlusIcon()");
    expect(app).toContain("function folderTone(path: string)");
    expect(app).toContain("tree-folder-create-btn");
    expect(app).toContain("folder-tone-${folderTone(node.path)}");
    expect(css).toContain(".tree-folder-create-btn svg");
    expect(css).toContain(".folder-tone-0");
    expect(css).toContain(".folder-tone-4");
    expect(app).toContain("file-kind-${kind}");
  });

  it("opens file rows with Enter or Space without activating from a nested delete button", () => {
    const fileTreeRow = sourceBetween(
      "className={`tree-item tree-file",
      "return rows"
    );

    expect(fileTreeRow).toContain("event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')");
    expect(fileTreeRow).toContain("event.preventDefault()");
    expect(fileTreeRow).toContain("onKeyDown={(event) => event.stopPropagation()}");
  });

  it("only intercepts Cmd/Ctrl+S for a saveable editor document", () => {
    const shortcutEffect = sourceBetween(
      "useEffect(() => {\n    const onKeyDown = (event: KeyboardEvent)",
      "const handleCopyLink = useCallback"
    );

    expect(shortcutEffect).toContain("(!event.metaKey && !event.ctrlKey)");
    expect(shortcutEffect).toContain("event.altKey || event.shiftKey");
    expect(shortcutEffect).toContain("!writeMode || !selectedPath || !selectedIsMarkdown || content === null || !isDirty || saveStatus === 'saving'");
    expect(shortcutEffect).toContain("event.preventDefault()");
    expect(shortcutEffect).toContain("void handleSave()");
  });
});
