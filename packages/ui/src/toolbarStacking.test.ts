import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
const changesDialog = readFileSync(new URL("./UnsavedChangesDialog.tsx", import.meta.url), "utf8");

function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  return matches.map((match) => match[1]).join("\n");
}

function firstMediaDeclarationsFor(maxWidth: number, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`@media \\(max-width: ${maxWidth}px\\) \\{[\\s\\S]*?${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("toolbar stacking", () => {
  it("keeps the More menu above document metadata and the editor surface", () => {
    expect(declarationsFor(".workspace-header")).toContain("position: relative");
    expect(declarationsFor(".workspace-header")).toContain("z-index: 30");
    expect(declarationsFor(".document-heading")).toContain("z-index: 1");
    expect(declarationsFor(".toolbar")).toContain("z-index: 2");
    expect(declarationsFor(".toolbar-menu[open]")).toContain("z-index: 80");
    expect(declarationsFor(".toolbar-menu-panel")).toContain("z-index: 90");
  });
});

describe("mobile header layout", () => {
  it("keeps the File actions menu and its touch targets inside narrow viewports", () => {
    const mobilePanel = firstMediaDeclarationsFor(900, ".toolbar-menu-panel-right");
    expect(mobilePanel).toContain("left: 0");
    expect(mobilePanel).toContain("right: auto");
    expect(mobilePanel).not.toContain("left: auto");
    expect(declarationsFor(".toolbar-menu-item")).toContain("min-height: 44px");
  });

  it("keeps primary document actions in compact rows on narrow screens", () => {
    const toolbarDeclarations = declarationsFor(".toolbar");
    expect(toolbarDeclarations).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(toolbarDeclarations).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(toolbarDeclarations).toContain("display: none");
    expect(toolbarDeclarations).toContain("width: calc(100vw - 20px)");
    expect(toolbarDeclarations).not.toContain("grid-template-columns: 1fr");
    expect(declarationsFor(".toolbar-btn.mobile-only")).toContain("display: none");
    expect(declarationsFor(".toolbar-btn.mobile-only")).toContain("display: inline-flex");
    expect(declarationsFor(".toolbar.mobile-controls-open")).toContain("display: grid");
    expect(declarationsFor(".mobile-controls-toggle.active")).toContain("background: color-mix(in srgb, var(--accent) 14%, transparent)");
    expect(declarationsFor(".view-tabs")).toContain("order: -1");
    expect(declarationsFor(".view-tabs")).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(declarationsFor(".document-meta-row .meta-pill:nth-child(n + 3)")).toContain("display: none");
    expect(declarationsFor(".document-heading")).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
    expect(declarationsFor(".document-title-block")).toContain("grid-column: 2");
    expect(declarationsFor(".document-heading .mobile-header-actions")).toContain("grid-column: 3");
    expect(declarationsFor(".document-heading .mobile-header-actions")).toContain("display: flex");
    expect(declarationsFor(".mobile-header-actions .toolbar-btn")).toContain("min-height: 44px");
    expect(declarationsFor(".document-heading .mobile-files-toggle")).toContain("min-height: 44px");
    expect(declarationsFor(".toolbar > .new-file-btn")).toContain("display: none");
    expect(declarationsFor(".toolbar > .write-toggle")).toContain("display: none");
  });

  it("wires the mobile controls toggle to the document toolbar", () => {
    expect(app).toContain("const [mobileControlsOpen, setMobileControlsOpen] = useState(false)");
    expect(app).toContain("aria-expanded={mobileControlsOpen}");
    expect(app).toContain("aria-controls=\"document-toolbar\"");
    expect(app).toContain("id=\"document-toolbar\"");
    expect(app).toContain("mobile-controls-open");
  });

  it("exposes one guarded mobile edit action, direct note creation, and an unambiguous view control", () => {
    const actionsStart = app.indexOf('<div className="mobile-only mobile-header-actions"')
    const toolbarStart = app.indexOf('<div id="document-toolbar"', actionsStart)
    expect(actionsStart).toBeGreaterThan(-1)
    expect(toolbarStart).toBeGreaterThan(actionsStart)

    const mobileActions = app.slice(actionsStart, toolbarStart)
    expect(mobileActions).toContain('className="toolbar-btn primary mobile-new-note"')
    expect(mobileActions).toContain("onClick={openCreateDialog}")
    expect(mobileActions).toContain("disabled={!activeRoot}")
    expect(mobileActions).toContain('aria-label="Create new note"')
    expect(mobileActions).toContain('className="mobile-new-note-symbol"')
    expect(mobileActions).toContain('className="mobile-new-note-label"')
    expect(mobileActions).toContain("{saveStatus === 'reload-required' ? 'Reload' : writeMode ? 'Done' : 'Edit'}")
    expect(mobileActions.match(/onClick=\{handleToggleWriteMode\}/g)).toHaveLength(1)
    expect(mobileActions).toContain("aria-pressed={writeMode}")
    expect(mobileActions).toContain("disabled={!selectedIsMarkdown || saveStatus === 'reload-required'}")
    expect(mobileActions).toContain("aria-label={`Choose document view; current view ${mobileViewLabel}`}")
    expect(mobileActions).toContain("<span className=\"mobile-controls-summary\">{mobileViewLabel}</span>")
    expect(mobileActions).toContain("View")
    expect(mobileActions).not.toContain("\n                Controls\n")
    expect(app).toContain("const mobileViewLabel = documentView === 'edit' ? 'Source' : viewLabel(documentView)")
    expect(app).toContain("requestDocumentTransition('start a new note', () => {")
  });

  it("retains the existing desktop toolbar actions and document view tabs", () => {
    const toolbarStart = app.indexOf('<div id="document-toolbar"')
    const toolbarEnd = app.indexOf("</header>", toolbarStart)
    const toolbar = app.slice(toolbarStart, toolbarEnd)

    expect(toolbar).toContain('className="toolbar-btn primary new-file-btn" onClick={openCreateDialog}')
    expect(toolbar).toContain("{documentViews.map((view) => (")
    expect(toolbar).toContain("{viewLabel(view)}")
    expect(toolbar).toContain("className={`toolbar-btn write-toggle ${writeMode ? 'active' : ''}`}")
    expect(toolbar).toContain("onClick={handleToggleWriteMode}")
  });

  it("wires the desktop sidebar toggle as an icon inside the sidebar", () => {
    expect(app).toContain("const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false)");
    expect(app).toContain("desktopSidebarCollapsed ? 'sidebar-collapsed' : ''");
    expect(app).toContain("id=\"file-sidebar\"");
    expect(app).toContain("className={`desktop-only sidebar-collapse-btn ${desktopSidebarCollapsed ? 'active' : ''}`}");
    expect(app).toContain("aria-label={desktopSidebarCollapsed ? 'Expand file sidebar' : 'Collapse file sidebar'}");
    expect(app).toContain("aria-expanded={!desktopSidebarCollapsed}");
    expect(app).toContain("aria-controls=\"file-sidebar\"");
    expect(app).toContain("setDesktopSidebarCollapsed((collapsed) => !collapsed)");
    expect(app).toContain("{desktopSidebarCollapsed ? '›' : '‹'}");
    expect(app).not.toContain("Hide Files");
    expect(app).not.toContain("Show Files");
    expect(declarationsFor(".desktop-only")).toContain("display: none");
    expect(declarationsFor(".desktop-only")).toContain("display: inline-flex");
    expect(declarationsFor(".app.sidebar-collapsed .sidebar")).toContain("width: 48px");
    expect(declarationsFor(".app.sidebar-collapsed .sidebar")).not.toContain("display: none");
    expect(css).toContain(".app.sidebar-collapsed .brand-lockup,");
    expect(css).toContain(".app.sidebar-collapsed .tree {");
    expect(declarationsFor(".sidebar-collapse-btn.active")).toContain("background: color-mix(in srgb, var(--accent) 14%, transparent)");
  });

  it("wires the mobile sidebar to close from tree selections and backdrop taps", () => {
    expect(app).toContain("className=\"sidebar-backdrop\"");
    expect(app).toContain("aria-label=\"Close file sidebar\"");
    expect(app).toContain("onClick={() => setSidebarOpen(false)}");
    expect(app).toContain("const workspaceHeaderRef = useRef<HTMLElement | null>(null)");
    expect(app).toContain("style={appStyle}");
    expect(app).toContain("ref={workspaceHeaderRef}");
    expect(app).toContain("setActivityView('files')");
    expect(app).toContain("setSidebarOpen((open) => !open)");
    expect(app).toContain("aria-expanded={sidebarOpen}");
    expect(app).toContain("const handleOpenFromTree = useCallback((relPath: string) => {");
    expect(app).toContain("selectBinaryFile(activeRoot, relPath)");
    expect(app).toContain("openFile(activeRoot, relPath)");
    expect(app).toContain("setSidebarOpen(false)");
    expect(declarationsFor(".sidebar-backdrop")).toContain("display: none");
    expect(declarationsFor(".sidebar")).toContain("inset: var(--mobile-sidebar-top, 0px) auto 0 0");
    expect(declarationsFor(".sidebar")).toContain("z-index: 50");
    expect(declarationsFor(".app.sidebar-open .sidebar-backdrop")).toContain("display: block");
    expect(declarationsFor(".app.sidebar-open .sidebar-backdrop")).toContain("inset: var(--mobile-sidebar-top, 0px) 0 0");
    expect(declarationsFor(".app.sidebar-open .sidebar-backdrop")).toContain("z-index: 20");
  });
});

describe("save reconciliation", () => {
  it("keeps post-submit typing local and models accepted-but-unverified writes separately", () => {
    expect(api).toContain("status: 'reload-required'")
    expect(api).toContain("writeAccepted: true")
    expect(api).toContain("setLastSavedContent(result.savedContent)")
    expect(api).not.toContain("setContentState(result.savedContent)")
    expect(app).toContain("const submittedContent = content")
    expect(app).toContain("const hasNewerDraft = latestContentRef.current !== submittedContent")
    expect(app).toContain("setSaveStatus(hasNewerDraft ? 'idle' : 'ok')")
    expect(app).toContain("else if (result === 'reload-required')")
    expect(app).toContain("setWriteMode(false)")
    expect(app).toContain("Copy current draft")
    expect(app).toContain("Reload latest")
    expect(app).toContain("saveDisabled={saveStatus === 'reload-required'}")
    expect(app).toContain("if (saveStatus !== 'reload-required') setSaveStatus('idle')")
    expect(changesDialog).toContain("disabled={isSaving || saveDisabled}")
    expect(declarationsFor(".save-reconcile-actions button")).toContain("min-height: 44px")
  });
});
