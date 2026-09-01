import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const graph = readFileSync(new URL('./SystemGraph.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../scripts/verify-mobile-render.mjs', import.meta.url), 'utf8')

describe('SystemGraph interaction shell', () => {
  it('exposes a named, described, focus-managed dialog and keyboard node actions', () => {
    expect(graph).toContain('aria-describedby="graph-instructions"')
    expect(graph).toContain('const firstVisible =')
    expect(graph).toContain('firstVisible?.focus()')
    expect(graph).toContain("if (event.key !== 'Tab') return")
    expect(graph).toContain(".attr('role', 'group')")
    expect(graph).not.toContain(".attr('role', 'img')")
    expect(graph).toContain(".attr('role', 'button')")
    expect(graph).toContain("hitAreas?.attr('r', 23 / Math.max(event.transform.k, 0.01))")
    expect(graph).toContain(".attr('tabindex', (_datum, index) => index === 0 ? 0 : -1)")
    expect(graph).toContain("event.key === 'ArrowRight' || event.key === 'ArrowDown'")
    expect(graph).toContain("event.key === 'Enter' || event.key === ' '")
  })

  it('uses one activation path, a bounded page-session cache, and cancels superseded read requests', () => {
    expect(graph).not.toContain(".on('pointerup'")
    expect(graph).toContain('fetch(API_BASE + graphPath, {')
    expect(graph).toContain("fetch(API_BASE + '/api/file?path=' + encodeURIComponent(filePath), { signal: controller.signal })")
    expect(graph).toContain('readGraphCache(pageSessionGraphCache, graphPath)')
    expect(graph).toContain("'Cache-Control': 'no-cache'")
    expect(graph).toContain('const usesFallbackRoots = suppliedRoots === undefined')
    expect(graph).toContain('const roots = usesFallbackRoots ? fallbackRoots : suppliedRoots ?? []')
    expect(graph).toContain('if (!rootsReady || !roots.length) {')
    expect(graph).toContain("if (selectedRoot === 'all' && !rootSelectionTouched) return")
  })

  it('passes the active Markdown logical path into a Files-first local graph', () => {
    expect(app).toContain('activeDocumentPath={selectedIsMarkdown ? selectedPath : null}')
    expect(graph).toContain("useState<GraphMode>(activeDocumentPath ? 'files' : 'folders')")
    expect(graph).toContain("useState<FileGraphView>(activeDocumentPath ? 'local' : 'full')")
    expect(graph).toContain('const initialDocumentNodeId = activeDocumentPath ? `md:${activeDocumentPath}` : null')
    expect(graph).toContain('if (previousGraphScopeRef.current === graphScope) return')
    expect(graph).toContain("graphData.nodes.find((node) => graphNodePath(node) === activeDocumentPath)")
    expect(graph).toContain('setFileFocusedNodeId(activeDocumentNodeId)')
    expect(graph).toContain('.text(compactGraphNodeLabel)')
    expect(graph).toContain('visibleLegendNodeCount')
  })

  it('exposes honest topology, local/full distance, and traversal history controls', () => {
    expect(graph).toContain('>\n              Topology\n')
    expect(graph).not.toContain('>\n              Overview\n')
    expect(graph).toContain('aria-label="File graph scope and distance"')
    expect(graph).toContain('>Local</button>')
    expect(graph).toContain('>Full</button>')
    expect(graph).toContain('>1-hop</button>')
    expect(graph).toContain('>2-hop</button>')
    expect(graph).toContain('aria-label="Back to previous graph node"')
    expect(graph).toContain('aria-label="Forward to next graph node"')
    expect(graph).toContain("if (mdMode === 'files') traverseFileNode(node)")
    expect(graph).toContain('focusedFileNode && previewNode(focusedFileNode)')
  })

  it('preserves local layout state and adds link direction only in the semantic local view', () => {
    expect(graph).toContain('pageSessionGraphPositionCache')
    expect(graph).toContain('graphPositionCacheKey(mdMode, selectedRoot, datum.id)')
    expect(graph).toContain('seedGraphNodePositions(')
    expect(graph).toContain("fileGraphView === 'local' && edge.type.includes('wikilink') ? 'url(#graph-wikilink-arrow)' : null")
    expect(graph).toContain("const localFileLayout = mdMode === 'files' && fileGraphView === 'local'")
    expect(graph).toContain(".attr('text-anchor', (datum) => datum.id === renderFocusNodeId ? 'middle'")
    expect(graph).toContain('visitedNodeIds.has(datum.id)')
  })

  it('provides search, refresh, fit, and zoom controls without adding write actions', () => {
    expect(graph).toContain('id="graph-search-input"')
    expect(graph).toContain('onClick={refreshGraph}')
    expect(graph).toContain('aria-label="Fit graph to view"')
    expect(graph).toContain('aria-label="Zoom in"')
    expect(graph).toContain('aria-label="Zoom out"')
    expect(graph).not.toMatch(/fetch\([^\n]+method:\s*['"](?:POST|PUT|PATCH|DELETE)/)
  })

  it('clears the shared graph cache only from successful graph-affecting mutation paths', () => {
    expect(app.match(/clearPageSessionGraphCache\(\)/g)).toHaveLength(8)
    expect(app).toContain("if (result !== 'ok') throw new Error(result === 'exists' ? 'Target folder already exists' : 'Rename folder failed')\n      clearPageSessionGraphCache()")
    expect(app).toContain("if (result !== 'ok') throw new Error('Delete folder failed')\n      clearPageSessionGraphCache()")
    expect(app).toContain("if (result === 'ok') {\n      clearPageSessionGraphCache()")
  })

  it('starts graph readiness timing inside the browser-side Graph click action', () => {
    expect(verifier).toContain('const clickedAtMs = Date.now();\n    graph.click();')
    expect(verifier).toContain('return { clicked: true, clickedAtMs, label: label(graph)')
    expect(verifier).toContain('await waitForGraph(cdp, sessionId, graphOpen.clickedAtMs)')
  })

  it('adapts the render budget after layout changes and yields dense simulation work', () => {
    expect(graph).toContain('setGraphViewportRevision((revision) => revision + 1)')
    expect(graph).toContain('const nextCompactViewport = bounds.width <= 600')
    expect(graph).toContain('layoutFrame = requestAnimationFrame(advanceLayout)')
    expect(graph).toContain('if (layoutFrame !== null) cancelAnimationFrame(layoutFrame)')
    expect(graph).not.toContain('simulation.tick(nodes.length > 300')
  })
})

describe('SystemGraph mobile geometry', () => {
  it('uses a viewport-bound graph and a bounded internally scrolling inspector', () => {
    expect(css).toContain('height: 100dvh')
    expect(css).toContain('.graph-inspector {\n    position: absolute;\n    inset: 0;')
    expect(css).toContain('.graph-inspector-body {\n    flex: 1 1 auto;\n    min-height: 0;\n    overflow: auto;')
    expect(css).not.toContain('.graph-layout.has-inspector .graph-canvas {\n    display: none;')
  })

  it('reduces persistent graph chrome without horizontal overflow or small touch controls', () => {
    expect(css).toContain('.graph-title-block { display: none; }')
    expect(css).toContain('.graph-context-strip { display: none; }')
    expect(css).toContain('.graph-controls {\n    display: none;\n    position: absolute;')
    expect(css).toContain('.graph-controls.mobile-open { display: grid; }')
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));')
    expect(css).toContain('.app {\n    max-width: 100vw;\n    overflow-x: hidden;')
  })

  it('keeps all primary mobile graph controls at least 44px tall', () => {
    expect(css).toContain('.graph-mode-btn {\n    min-width: 0;\n    min-height: 44px;')
    expect(css).toContain('.graph-search input { min-height: 44px; }')
    expect(css).toContain('.graph-file-view-controls .diff-btn,\n  .graph-history-controls .diff-btn {\n    min-width: 0;\n    min-height: 44px;')
    expect(css).toContain('.graph-tools-toggle {\n    display: inline-flex;\n    width: 100%;\n    min-height: 44px;')
    expect(css).toContain('.graph-view-controls button { min-width: 44px; min-height: 44px; }')
    expect(css).toContain('.graph-legend-toggle { min-height: 44px; }')
    expect(css).toContain('.graph-inspector-actions .diff-btn,\n  .graph-back-btn { min-height: 44px; }')
  })
})
