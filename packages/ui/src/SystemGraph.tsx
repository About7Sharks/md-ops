// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import * as d3 from 'd3'
import { API_BASE } from './api'
import type { Root } from './api'
import {
  buildGraphSubset,
  buildLocalFileNeighborhood,
  clearPageSessionGraphCache,
  compactGraphNodeLabel,
  graphNodePath,
  graphPositionCacheKey,
  colorForType,
  displayRootLabel,
  displayRootMeta,
  formatGeneratedAt,
  GRAPH_DENSE_LABEL_LIMIT,
  GRAPH_HISTORY_MAX_ENTRIES,
  GRAPH_MOBILE_NODE_BUDGET,
  GRAPH_NODE_BUDGET,
  GRAPH_SEARCH_RESULT_LIMIT,
  graphRequestPath,
  invalidateGraphCache,
  isSemanticFileEdge,
  markdownFacts,
  modeLabel,
  preferredRootId,
  splitGraphPath,
  pageSessionGraphCache,
  pageSessionGraphPositionCache,
  pushGraphHistory,
  readGraphCache,
  readGraphPositionCache,
  safeGraphResponse,
  searchGraphNodes,
  seedGraphNodePositions,
  writeGraphCache,
  writeGraphPositionCache,
} from './systemGraphModel'

// Re-exported so existing consumers (App, tests) can keep importing these
// symbols from this module without pulling d3 into their bundle.
export {
  buildGraphSubset,
  buildLocalFileNeighborhood,
  clearPageSessionGraphCache,
  compactGraphNodeLabel,
  GRAPH_HISTORY_MAX_ENTRIES,
  GRAPH_MOBILE_NODE_BUDGET,
  GRAPH_NODE_BUDGET,
  graphNodePath,
  graphPositionCacheKey,
  graphRequestPath,
  invalidateGraphCache,
  isSemanticFileEdge,
  pageSessionGraphCache,
  pageSessionGraphPositionCache,
  pushGraphHistory,
  readGraphCache,
  readGraphPositionCache,
  safeGraphResponse,
  searchGraphNodes,
  seedGraphNodePositions,
  writeGraphCache,
  writeGraphPositionCache,
} from './systemGraphModel'
export type {
  GraphCacheEntry,
  GraphEdge,
  GraphHistory,
  GraphMode,
  GraphNode,
  GraphPosition,
  GraphResponse,
  FileGraphView,
} from './systemGraphModel'

export default function SystemGraph({
  activeRoot,
  activeDocumentPath,
  roots: suppliedRoots,
  onClose,
  onOpenFile,
}: {
  activeRoot?: string | null
  activeDocumentPath?: string | null
  roots?: Root[] | null
  onClose: () => void
  onOpenFile?: (rootId: string, relPath: string) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const inspectorBackRef = useRef<HTMLButtonElement | null>(null)
  const graphViewRef = useRef<any>(null)
  const initializedDocumentPathRef = useRef<string | null>(null)
  const initialDocumentNodeId = activeDocumentPath ? `md:${activeDocumentPath}` : null
  const [rootSelectionTouched, setRootSelectionTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mdMode, setMdMode] = useState<GraphMode>(activeDocumentPath ? 'files' : 'folders')
  const [fallbackRoots, setFallbackRoots] = useState<Root[]>([])
  const [selectedRoot, setSelectedRoot] = useState<string>(activeRoot || 'all')
  const [focusedFolderPath, setFocusedFolderPath] = useState<string | null>(null)
  const previousGraphScopeRef = useRef(`${activeRoot || 'all'}\u0000`)
  const [showFileLabels, setShowFileLabels] = useState(false)
  const [graphData, setGraphData] = useState<GraphResponse | null>(null)
  const [renderMeta, setRenderMeta] = useState<RenderMeta | null>(null)
  const [loadingGraph, setLoadingGraph] = useState(false)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [forceRebuildKey, setForceRebuildKey] = useState<string | null>(null)
  const [graphViewportRevision, setGraphViewportRevision] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeGraphNodeId, setActiveGraphNodeId] = useState<string | null>(null)
  const [subsetFocusNodeId, setSubsetFocusNodeId] = useState<string | null>(null)
  const [fileGraphView, setFileGraphView] = useState<FileGraphView>(activeDocumentPath ? 'local' : 'full')
  const [fileGraphHops, setFileGraphHops] = useState<1 | 2>(1)
  const [fileFocusedNodeId, setFileFocusedNodeId] = useState<string | null>(initialDocumentNodeId)
  const [fileHistory, setFileHistory] = useState<GraphHistory>(() => initialDocumentNodeId
    ? { entries: [initialDocumentNodeId], index: 0 }
    : { entries: [], index: -1 })
  const [visitedNodeIds, setVisitedNodeIds] = useState<Set<string>>(() => new Set(initialDocumentNodeId ? [initialDocumentNodeId] : []))
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 900)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [selectedMarkdown, setSelectedMarkdown] = useState<string>('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loadingMarkdown, setLoadingMarkdown] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'err'>('idle')

  // `undefined` is standalone usage. App passes `null` while loading and an
  // array once authoritative roots have resolved; neither may trigger a
  // duplicate local roots request.
  const usesFallbackRoots = suppliedRoots === undefined
  const [fallbackRootsLoaded, setFallbackRootsLoaded] = useState(false)
  const roots = usesFallbackRoots ? fallbackRoots : suppliedRoots ?? []
  const rootsReady = usesFallbackRoots ? fallbackRootsLoaded : suppliedRoots !== null

  useEffect(() => {
    if (!usesFallbackRoots) return
    const controller = new AbortController()
    setFallbackRootsLoaded(false)
    async function loadRoots() {
      try {
        const r = await fetch(API_BASE + '/api/roots', { signal: controller.signal })
        if (!r.ok) throw new Error('Failed to load roots')
        const data = await r.json()
        if (!controller.signal.aborted) setFallbackRoots(data.roots ?? [])
      } catch (loadError) {
        if (!controller.signal.aborted) setFallbackRoots([])
      } finally {
        if (!controller.signal.aborted) setFallbackRootsLoaded(true)
      }
    }
    loadRoots()
    return () => controller.abort()
  }, [usesFallbackRoots])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => {
      const search = searchRef.current
      if (search && search.getClientRects().length > 0) {
        search.focus()
        return
      }
      const firstVisible = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
        .find((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
      firstVisible?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    if (!roots.length || rootSelectionTouched) return
    const preferred = activeRoot && roots.some((root) => root.id === activeRoot) ? activeRoot : preferredRootId(roots)
    if (preferred && selectedRoot !== preferred) setSelectedRoot(preferred)
  }, [activeRoot, rootSelectionTouched, roots, selectedRoot])

  useEffect(() => {
    if (mdMode !== 'files' && showFileLabels) setShowFileLabels(false)
    if (mdMode !== 'folders' && focusedFolderPath) setFocusedFolderPath(null)
  }, [mdMode, showFileLabels, focusedFolderPath])

  useEffect(() => {
    if (mdMode !== 'files' && selectedNode?.type === 'md') {
      setSelectedNode(null)
      setSelectedMarkdown('')
      setSelectedPath(null)
      setLoadingMarkdown(false)
    }
  }, [mdMode, selectedNode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (selectedNode) {
          setSelectedNode(null)
          requestAnimationFrame(() => searchRef.current?.focus())
          return
        }
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, selectedNode])

  useEffect(() => {
    if (!selectedNode) return
    requestAnimationFrame(() => inspectorBackRef.current?.focus())
  }, [selectedNode])

  useEffect(() => {
    const controller = new AbortController()

    async function loadSelectedMarkdown() {
      setCopyStatus('idle')
      if (!selectedNode || selectedNode.type !== 'md') {
        setSelectedMarkdown('')
        setSelectedPath(null)
        setLoadingMarkdown(false)
        return
      }

      const filePath = graphNodePath(selectedNode)
      setSelectedPath(filePath)
      if (!filePath) {
        setSelectedMarkdown('Unable to resolve markdown path for this node.')
        setLoadingMarkdown(false)
        return
      }

      try {
        setLoadingMarkdown(true)
        const r = await fetch(API_BASE + '/api/file?path=' + encodeURIComponent(filePath), { signal: controller.signal })
        if (!r.ok) throw new Error('Failed to load markdown')
        const text = await r.text()
        if (!controller.signal.aborted) setSelectedMarkdown(text)
      } catch (loadError) {
        if (!controller.signal.aborted) setSelectedMarkdown(loadError instanceof Error ? loadError.message : 'Failed to load markdown')
      } finally {
        if (!controller.signal.aborted) setLoadingMarkdown(false)
      }
    }

    loadSelectedMarkdown()
    return () => controller.abort()
  }, [selectedNode])

  const selectedSummary = useMemo(() => {
    if (!selectedNode) return null
    if (selectedNode.type === 'md') return selectedPath ?? selectedNode.label
    return selectedNode.label
  }, [selectedNode, selectedPath])
  const selectedFileTarget = useMemo(() => splitGraphPath(selectedPath), [selectedPath])
  const selectedRootConfig = roots.find((root) => root.id === selectedRoot)
  const selectedMarkdownRoot = selectedFileTarget ? roots.find((root) => root.id === selectedFileTarget.rootId) : null
  const selectedFacts = useMemo(() => markdownFacts(selectedMarkdown), [selectedMarkdown])
  const graphPath = useMemo(() => graphRequestPath(mdMode, selectedRoot, focusedFolderPath), [mdMode, selectedRoot, focusedFolderPath])
  const activeDocumentNodeId = useMemo(() => {
    if (!activeDocumentPath || !graphData) return null
    return graphData.nodes.find((node) => graphNodePath(node) === activeDocumentPath)?.id ?? null
  }, [activeDocumentPath, graphData])
  const allSearchMatches = useMemo(
    () => graphData ? searchGraphNodes(graphData.nodes, searchQuery, graphData.nodes.length) : [],
    [graphData, searchQuery],
  )
  const searchMatches = allSearchMatches.slice(0, GRAPH_SEARCH_RESULT_LIMIT)

  const graphMeta = useMemo<GraphMeta | null>(() => {
    if (!graphData) return null
    const scopeLabel = mdMode === 'none'
      ? 'all topology'
      : selectedRoot === 'all'
        ? 'all markdown roots'
        : selectedRootConfig
          ? displayRootLabel(selectedRootConfig)
          : selectedRoot
    const typeCounts = [...d3.rollup(graphData.nodes, (values) => values.length, (node) => node.type)]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    return {
      nodeCount: graphData.nodes.length,
      edgeCount: graphData.edges.length,
      generatedAt: graphData.generatedAt,
      modeLabel: modeLabel(mdMode),
      scopeLabel,
      focusLabel: mdMode === 'folders' ? focusedFolderPath : null,
      typeCounts,
    }
  }, [graphData, mdMode, selectedRoot, selectedRootConfig, focusedFolderPath])

  const stats = loadingGraph
    ? 'Loading graph...'
    : graphMeta
      ? mdMode === 'files' && fileGraphView === 'local' && renderMeta
        ? `${renderMeta.nodeCount} local nodes · ${renderMeta.edgeCount} links · ${graphMeta.nodeCount} available`
        : `${graphMeta.nodeCount} nodes · ${graphMeta.edgeCount} edges${renderMeta && (renderMeta.truncatedNodes || renderMeta.truncatedEdges) ? ` · drawing ${renderMeta.nodeCount} nodes / ${renderMeta.edgeCount} edges` : ''} · ${graphMeta.modeLabel}`
      : error ? 'Graph unavailable' : 'No graph data'

  useEffect(() => {
    const graphScope = `${selectedRoot}\u0000${focusedFolderPath ?? ''}`
    if (previousGraphScopeRef.current === graphScope) return
    previousGraphScopeRef.current = graphScope
    setSelectedNode(null)
    setSelectedMarkdown('')
    setSelectedPath(null)
    setLoadingMarkdown(false)
    setCopyStatus('idle')
    setSearchQuery('')
    setActiveGraphNodeId(null)
    setSubsetFocusNodeId(null)
    setFileFocusedNodeId(null)
    setFileHistory({ entries: [], index: -1 })
    setVisitedNodeIds(new Set())
    initializedDocumentPathRef.current = null
  }, [selectedRoot, focusedFolderPath])

  useEffect(() => {
    if (mdMode !== 'files' || !activeDocumentPath || !activeDocumentNodeId) return
    if (initializedDocumentPathRef.current === activeDocumentPath && fileFocusedNodeId) return
    initializedDocumentPathRef.current = activeDocumentPath
    setFileGraphView('local')
    setFileFocusedNodeId(activeDocumentNodeId)
    setActiveGraphNodeId(activeDocumentNodeId)
    setFileHistory({ entries: [activeDocumentNodeId], index: 0 })
    setVisitedNodeIds(new Set([activeDocumentNodeId]))
  }, [activeDocumentNodeId, activeDocumentPath, fileFocusedNodeId, mdMode])

  useEffect(() => {
    // App-owned roots stay authoritative: wait for loading and never graph an
    // empty/error root list. Standalone usage waits for its fallback request.
    if (!rootsReady || !roots.length) {
      setLoadingGraph(false)
      setGraphData(null)
      setRenderMeta(null)
      setError(null)
      return
    }
    // Also wait for the preferred-root effect unless the user explicitly chose all.
    if (selectedRoot === 'all' && !rootSelectionTouched) return
    const controller = new AbortController()
    const forceServerRebuild = forceRebuildKey === graphPath
    const cached = forceServerRebuild ? null : readGraphCache(pageSessionGraphCache, graphPath)
    if (cached) {
      setGraphData(cached)
      setLoadingGraph(false)
      setError(null)
      return () => controller.abort()
    }

    async function loadGraph() {
      setLoadingGraph(true)
      setError(null)
      setGraphData(null)
      setRenderMeta(null)
      try {
        const response = await fetch(API_BASE + graphPath, {
          signal: controller.signal,
          ...(forceServerRebuild ? { headers: { 'Cache-Control': 'no-cache' } } : {}),
        })
        if (!response.ok) throw new Error('Failed to load system graph')
        const graph = safeGraphResponse(await response.json())
        if (controller.signal.aborted) return
        writeGraphCache(pageSessionGraphCache, graphPath, graph)
        setGraphData(graph)
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Failed to load system graph')
      } finally {
        if (!controller.signal.aborted) {
          setLoadingGraph(false)
          if (forceServerRebuild) setForceRebuildKey((key) => key === graphPath ? null : key)
        }
      }
    }

    loadGraph()
    return () => controller.abort()
  }, [forceRebuildKey, graphPath, refreshRevision, rootSelectionTouched, roots, rootsReady, selectedRoot])

  const fitGraphView = useCallback((animate = true) => {
    const view = graphViewRef.current
    const groupNode = view?.group?.node()
    if (!view || !groupNode) return
    const bounds = groupNode.getBBox()
    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return
    const width = Math.max(view.width, 1)
    const height = Math.max(view.height, 1)
    const contentWidth = Math.max(bounds.width, 1)
    const contentHeight = Math.max(bounds.height, 1)
    const scale = Math.max(0.15, Math.min(2.4, 0.86 / Math.max(contentWidth / width, contentHeight / height)))
    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-(bounds.x + bounds.width / 2), -(bounds.y + bounds.height / 2))
    const target = animate ? view.svg.transition().duration(220) : view.svg
    target.call(view.zoom.transform, transform)
  }, [])

  const zoomGraphBy = useCallback((factor: number) => {
    const view = graphViewRef.current
    if (!view) return
    view.svg.transition().duration(160).call(view.zoom.scaleBy, factor)
  }, [])

  const centerGraphNode = useCallback((nodeId: string) => {
    const view = graphViewRef.current
    const node = view?.nodes?.find((candidate: any) => candidate.id === nodeId)
    if (!view || !node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return
    const scale = Math.max(1.25, Math.min(2.2, d3.zoomTransform(view.svg.node()).k))
    const transform = d3.zoomIdentity
      .translate(view.width / 2, view.height / 2)
      .scale(scale)
      .translate(-node.x, -node.y)
    view.svg.transition().duration(220).call(view.zoom.transform, transform)
  }, [])

  const previewNode = useCallback((node: GraphNode) => {
    if (node.type !== 'md') return
    setSelectedNode({ id: node.id, type: node.type, label: node.label, props: node.props })
  }, [])

  const traverseFileNode = useCallback((node: GraphNode) => {
    if (node.type !== 'md') return
    setSelectedNode(null)
    setFileFocusedNodeId(node.id)
    setActiveGraphNodeId(node.id)
    setFileHistory((history) => pushGraphHistory(history, node.id))
    setVisitedNodeIds((visited) => {
      const next = new Set(visited)
      next.add(node.id)
      while (next.size > GRAPH_HISTORY_MAX_ENTRIES * 2) next.delete(next.values().next().value)
      return next
    })
  }, [])

  const activateNode = useCallback((node: GraphNode) => {
    setActiveGraphNodeId(node.id)
    if (node.type === 'md') {
      if (mdMode === 'files') traverseFileNode(node)
      else previewNode(node)
      return
    }
    if (node.type === 'folder' && mdMode === 'folders' && node.props?.relPath) {
      setFocusedFolderPath(node.props.relPath)
    }
  }, [mdMode, previewNode, traverseFileNode])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.innerHTML = ''
    graphViewRef.current = null
    if (!graphData?.nodes.length) return

    const initialWidth = Math.max(host.clientWidth, 320)
    const initialHeight = Math.max(host.clientHeight, 280)
    let compactViewport = initialWidth <= 600
    const nodeBudget = compactViewport ? GRAPH_MOBILE_NODE_BUDGET : GRAPH_NODE_BUDGET
    const renderFocusNodeId = mdMode === 'files' ? fileFocusedNodeId : subsetFocusNodeId
    const subset = mdMode === 'files' && fileGraphView === 'local' && fileFocusedNodeId
      ? buildLocalFileNeighborhood(graphData.nodes, graphData.edges, fileFocusedNodeId, fileGraphHops, nodeBudget)
      : buildGraphSubset(graphData.nodes, graphData.edges, nodeBudget, renderFocusNodeId)
    const typeCounts = [...d3.rollup(subset.nodes, (values) => values.length, (datum) => datum.type)]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    setRenderMeta({ nodeCount: subset.nodes.length, edgeCount: subset.edges.length, truncatedNodes: subset.truncatedNodes, truncatedEdges: subset.truncatedEdges, typeCounts })

    const svg = d3.select(host)
      .append('svg')
      .attr('width', initialWidth)
      .attr('height', initialHeight)
      .attr('viewBox', `0 0 ${initialWidth} ${initialHeight}`)
      .attr('role', 'group')
      .attr('aria-label', `Interactive graph showing ${subset.nodes.length} nodes and ${subset.edges.length} edges`)
    const definitions = svg.append('defs')
    definitions.append('marker')
      .attr('id', 'graph-wikilink-arrow')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 10)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-3L7,0L0,3')
      .attr('fill', '#58a6ff')
      .attr('opacity', 0.8)
    const group = svg.append('g')
    let hitAreas: d3.Selection<SVGCircleElement, GraphNode & d3.SimulationNodeDatum, SVGGElement, unknown> | null = null
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on('zoom', (event) => {
        group.attr('transform', event.transform.toString())
        hitAreas?.attr('r', 23 / Math.max(event.transform.k, 0.01))
      })
    svg.call(zoom)

    const nodes = seedGraphNodePositions(
      subset.nodes,
      pageSessionGraphPositionCache,
      mdMode,
      selectedRoot,
      renderFocusNodeId,
      initialWidth,
      initialHeight,
    ) as Array<GraphNode & d3.SimulationNodeDatum>
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const links = subset.edges
      .map((edge) => ({ source: byId.get(edge.from), target: byId.get(edge.to), type: edge.type }))
      .filter((edge) => edge.source && edge.target)

    const link = group.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('class', (edge) => `graph-edge graph-edge-${edge.type.replace(/[^a-z0-9_-]/gi, '-')}`)
      .attr('stroke', (edge) => edge.type.includes('wikilink') ? '#2f81f7' : '#3b4654')
      .attr('stroke-opacity', (edge) => edge.type.includes('wikilink') ? 0.22 : 0.52)
      .attr('stroke-width', (edge) => edge.type.includes('wikilink') ? 0.8 : 1.15)
      .attr('stroke-dasharray', (edge) => edge.type.includes('wikilink') ? '3 4' : null)
      .attr('marker-end', (edge) => mdMode === 'files' && fileGraphView === 'local' && edge.type.includes('wikilink') ? 'url(#graph-wikilink-arrow)' : null)

    const interactiveNodes = nodes.filter((node) => node.type === 'md' || (node.type === 'folder' && mdMode === 'folders' && node.props?.relPath))
    const nodeLayer = group.append('g')
    const interactiveNodeLabel = (datum: GraphNode) => datum.type === 'md'
      ? mdMode === 'files' ? `Focus markdown note ${datum.label}` : `Preview markdown note ${datum.label}`
      : datum.type === 'folder' && datum.props?.relPath
        ? `Open folder graph ${datum.props.relPath}`
        : ''
    hitAreas = nodeLayer.selectAll<SVGCircleElement, GraphNode & d3.SimulationNodeDatum>('circle.hit-area')
      .data(interactiveNodes)
      .join('circle')
      .attr('class', 'hit-area')
      .attr('r', 23)
      .attr('fill', 'transparent')
      .attr('tabindex', (_datum, index) => index === 0 ? 0 : -1)
      .attr('role', 'button')
      .attr('aria-label', interactiveNodeLabel)
      .style('cursor', 'pointer')
      .style('pointer-events', 'all')
    const node = nodeLayer.selectAll('circle.node-dot')
      .data(nodes)
      .join('circle')
      .attr('class', (datum) => `node-dot graph-node-${datum.type.replace(/[^a-z0-9_-]/gi, '-')}`)
      .attr('r', (datum) => datum.type === 'root' ? 9 : datum.type === 'agent' || datum.type === 'service' || datum.type === 'host' ? 7 : datum.type === 'folder' ? 6 : 5)
      .attr('fill', (datum) => colorForType(datum.type))
      .attr('stroke', '#0d1117')
      .attr('stroke-width', 1.2)
      .style('cursor', (datum) => interactiveNodes.includes(datum) ? 'pointer' : 'grab')

    node.append('title').text((datum) => {
      if (datum.type === 'md') return mdMode === 'files' ? `${datum.label} (markdown) - select to traverse` : `${datum.label} (markdown) - select for preview`
      if (datum.type === 'folder' && datum.props?.relPath) return `${datum.label} (folder) - open folder map`
      return `${datum.label} (${datum.type})`
    })

    const labels = group.append('g')
      .attr('class', 'graph-label-layer')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .attr('class', 'graph-node-label')
      .text(compactGraphNodeLabel)
      .attr('font-size', initialWidth <= 600 ? 9 : 11)
      .attr('fill', '#d5dde7')
      .style('pointer-events', 'none')

    const dense = nodes.length > GRAPH_DENSE_LABEL_LIMIT
    const keyLabelIds = new Set<string>()
    for (const datum of nodes) {
      if (['root', 'service', 'host', 'agent'].includes(datum.type)) keyLabelIds.add(datum.id)
      if (!dense && datum.type !== 'md') keyLabelIds.add(datum.id)
    }
    if (dense && mdMode === 'folders') {
      for (const datum of nodes.filter((candidate) => candidate.type === 'folder').slice(0, initialWidth <= 600 ? 8 : 18)) keyLabelIds.add(datum.id)
    }

    let width = initialWidth
    let height = initialHeight
    const localFileLayout = mdMode === 'files' && fileGraphView === 'local'
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).distance(localFileLayout ? initialWidth <= 600 ? 82 : 104 : mdMode === 'files' ? 34 : mdMode === 'folders' ? 56 : 72).strength(localFileLayout ? 0.34 : mdMode === 'files' ? 0.18 : 0.26))
      .force('charge', d3.forceManyBody().strength(localFileLayout ? initialWidth <= 600 ? -170 : -220 : mdMode === 'files' ? -65 : mdMode === 'folders' ? -105 : -155))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(localFileLayout ? 16 : mdMode === 'files' ? 7 : 10))
      .stop()

    const updatePositions = () => {
      link
        .attr('x1', (edge) => edge.source.x ?? 0)
        .attr('y1', (edge) => edge.source.y ?? 0)
        .attr('x2', (edge) => edge.target.x ?? 0)
        .attr('y2', (edge) => edge.target.y ?? 0)
      hitAreas.attr('cx', (datum) => datum.x ?? 0).attr('cy', (datum) => datum.y ?? 0)
      node.attr('cx', (datum) => datum.x ?? 0).attr('cy', (datum) => datum.y ?? 0)
      const focusNode = renderFocusNodeId ? byId.get(renderFocusNodeId) : null
      labels
        .attr('x', (datum) => datum.x ?? 0)
        .attr('y', (datum) => datum.y ?? 0)
        .attr('text-anchor', (datum) => datum.id === renderFocusNodeId ? 'middle' : (datum.x ?? width / 2) < (focusNode?.x ?? width / 2) ? 'end' : 'start')
        .attr('dx', (datum) => datum.id === renderFocusNodeId ? 0 : (datum.x ?? width / 2) < (focusNode?.x ?? width / 2) ? -10 : 10)
        .attr('dy', (datum) => datum.id === renderFocusNodeId ? -14 : 3)
    }
    updatePositions()
    simulation.on('tick', updatePositions)
    let layoutFrame: number | null = null
    let remainingTicks = nodes.length > 300 ? 110 : nodes.length > 120 ? 150 : 190
    const advanceLayout = () => {
      const batchSize = Math.min(remainingTicks, nodes.length > 300 ? 8 : 12)
      simulation.tick(batchSize)
      updatePositions()
      remainingTicks -= batchSize
      if (remainingTicks > 0) {
        layoutFrame = requestAnimationFrame(advanceLayout)
      } else {
        layoutFrame = requestAnimationFrame(() => {
          layoutFrame = null
          fitGraphView(false)
        })
      }
    }
    layoutFrame = requestAnimationFrame(advanceLayout)

    const activate = (event: Event, datum: GraphNode) => {
      if (event.defaultPrevented) return
      activateNode(datum)
    }
    const focusGraphNodeTarget = (index: number) => {
      const targets = hitAreas?.nodes() ?? []
      if (!targets.length) return
      const boundedIndex = (index + targets.length) % targets.length
      hitAreas?.attr('tabindex', (_datum, targetIndex) => targetIndex === boundedIndex ? 0 : -1)
      targets[boundedIndex]?.focus()
    }
    hitAreas
      .on('click', activate)
      .on('focus', function () {
        hitAreas?.attr('tabindex', -1)
        d3.select(this).attr('tabindex', 0)
      })
      .on('keydown', function (event, datum) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activateNode(datum)
          return
        }
        const currentIndex = hitAreas?.nodes().indexOf(this) ?? -1
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          focusGraphNodeTarget(currentIndex + 1)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          focusGraphNodeTarget(currentIndex - 1)
        } else if (event.key === 'Home') {
          event.preventDefault()
          focusGraphNodeTarget(0)
        } else if (event.key === 'End') {
          event.preventDefault()
          focusGraphNodeTarget(interactiveNodes.length - 1)
        }
      })
    node
      .on('click', activate)
      .call(d3.drag<SVGCircleElement, GraphNode & d3.SimulationNodeDatum>()
        .on('start', (event, datum) => {
          if (!event.active) simulation.alphaTarget(0.18).restart()
          datum.fx = datum.x
          datum.fy = datum.y
        })
        .on('drag', (event, datum) => {
          datum.fx = event.x
          datum.fy = event.y
        })
        .on('end', (event, datum) => {
          if (!event.active) simulation.alphaTarget(0)
          datum.fx = null
          datum.fy = null
          writeGraphPositionCache(pageSessionGraphPositionCache, graphPositionCacheKey(mdMode, selectedRoot, datum.id), { x: datum.x ?? 0, y: datum.y ?? 0 })
        }))

    graphViewRef.current = { svg, group, zoom, nodes, links, link, node, hitAreas, labels, keyLabelIds, width, height, simulation }
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
      const bounds = entries[0]?.contentRect
      if (!bounds || bounds.width < 1 || bounds.height < 1) return
      const nextCompactViewport = bounds.width <= 600
      if (nextCompactViewport !== compactViewport) {
        compactViewport = nextCompactViewport
        setGraphViewportRevision((revision) => revision + 1)
        return
      }
      width = Math.max(bounds.width, 320)
      height = Math.max(bounds.height, 280)
      svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`)
      simulation.force('center', d3.forceCenter(width / 2, height / 2))
      if (graphViewRef.current) Object.assign(graphViewRef.current, { width, height })
      requestAnimationFrame(() => fitGraphView(false))
    })
    resizeObserver?.observe(host)
    requestAnimationFrame(() => fitGraphView(false))

    return () => {
      resizeObserver?.disconnect()
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame)
      for (const datum of nodes) {
        writeGraphPositionCache(pageSessionGraphPositionCache, graphPositionCacheKey(mdMode, selectedRoot, datum.id), { x: datum.x ?? 0, y: datum.y ?? 0 })
      }
      simulation.stop()
      if (graphViewRef.current?.svg === svg) graphViewRef.current = null
    }
  }, [graphData, mdMode, fileFocusedNodeId, fileGraphHops, fileGraphView, subsetFocusNodeId, graphViewportRevision, fitGraphView, activateNode, selectedRoot])

  useEffect(() => {
    const view = graphViewRef.current
    if (!view || !graphData) return
    const queryMatchIds = new Set(allSearchMatches.map((node) => node.id))
    const focusId = mdMode === 'files' ? fileFocusedNodeId : selectedNode?.id ?? activeGraphNodeId
    const neighbors = new Set<string>()
    if (focusId) {
      for (const edge of graphData.edges) {
        if (mdMode === 'files' && !isSemanticFileEdge(edge)) continue
        if (edge.from === focusId) neighbors.add(edge.to)
        if (edge.to === focusId) neighbors.add(edge.from)
      }
    }
    const baseRadius = (datum: GraphNode) => datum.type === 'root' ? 9 : datum.type === 'agent' || datum.type === 'service' || datum.type === 'host' ? 7 : datum.type === 'folder' ? 6 : 5
    const nodeOpacity = (datum: GraphNode) => {
      if (!focusId) return searchQuery ? queryMatchIds.has(datum.id) ? 1 : 0.2 : 1
      if (datum.id === focusId || datum.id === activeDocumentNodeId) return 1
      if (neighbors.has(datum.id)) return 0.88
      if (visitedNodeIds.has(datum.id)) return 0.62
      return fileGraphView === 'local' ? 0.3 : 0.14
    }
    view.node
      .attr('opacity', nodeOpacity)
      .attr('r', (datum) => baseRadius(datum) + (datum.id === focusId ? 3 : datum.id === activeDocumentNodeId ? 2 : visitedNodeIds.has(datum.id) ? 1 : 0))
      .attr('stroke', (datum) => datum.id === focusId ? '#f0f6fc' : datum.id === activeDocumentNodeId ? '#58a6ff' : visitedNodeIds.has(datum.id) ? '#d29922' : searchQuery && queryMatchIds.has(datum.id) ? '#ffd33d' : '#0d1117')
      .attr('stroke-width', (datum) => datum.id === focusId ? 3.4 : datum.id === activeDocumentNodeId ? 2.8 : visitedNodeIds.has(datum.id) ? 2.1 : searchQuery && queryMatchIds.has(datum.id) ? 2.4 : 1.2)
    view.hitAreas.attr('opacity', nodeOpacity)
    view.link.attr('stroke-opacity', (edge) => {
      const sourceId = edge.source.id
      const targetId = edge.target.id
      if (focusId) return sourceId === focusId || targetId === focusId ? 0.9 : visitedNodeIds.has(sourceId) && visitedNodeIds.has(targetId) ? 0.34 : 0.055
      if (searchQuery) return queryMatchIds.has(sourceId) || queryMatchIds.has(targetId) ? 0.66 : 0.05
      return edge.type.includes('wikilink') ? 0.22 : 0.52
    })
    view.labels
      .attr('opacity', (datum) => {
        if (datum.id === focusId || datum.id === activeDocumentNodeId) return 1
        if (focusId && neighbors.has(datum.id)) return 0.86
        if (visitedNodeIds.has(datum.id)) return 0.68
        if (searchQuery && queryMatchIds.has(datum.id)) return 1
        if (datum.type === 'md') return showFileLabels ? 0.5 : 0
        return view.keyLabelIds.has(datum.id) ? focusId || searchQuery ? 0.24 : 0.9 : 0
      })
      .attr('font-weight', (datum) => datum.id === focusId || datum.id === activeDocumentNodeId || searchQuery && queryMatchIds.has(datum.id) ? 750 : visitedNodeIds.has(datum.id) ? 650 : 500)
  }, [graphData, allSearchMatches, searchQuery, activeGraphNodeId, activeDocumentNodeId, fileFocusedNodeId, fileGraphView, mdMode, selectedNode, showFileLabels, renderMeta, visitedNodeIds])

  useEffect(() => {
    if (!activeGraphNodeId) return
    const frame = requestAnimationFrame(() => centerGraphNode(activeGraphNodeId))
    return () => cancelAnimationFrame(frame)
  }, [activeGraphNodeId, subsetFocusNodeId, centerGraphNode, renderMeta])

  const visibleLegendNodeCount = mdMode === 'files' && fileGraphView === 'local' && renderMeta ? renderMeta.nodeCount : graphMeta?.nodeCount ?? 0
  const visibleLegendEdgeCount = mdMode === 'files' && fileGraphView === 'local' && renderMeta ? renderMeta.edgeCount : graphMeta?.edgeCount ?? 0
  const visibleLegendTypeCounts = mdMode === 'files' && fileGraphView === 'local' && renderMeta ? renderMeta.typeCounts : graphMeta?.typeCounts ?? []
  const graphTitle = mdMode === 'none'
    ? 'MD Ops Topology'
    : selectedRoot === 'all'
      ? 'Markdown Knowledge Map'
      : `${selectedRootConfig ? displayRootLabel(selectedRootConfig) : selectedRoot} Knowledge Map`
  const graphSubtitle = mdMode === 'none'
    ? 'Application and configured vault roots. Folder and file modes add Markdown detail.'
    : selectedRoot === 'all'
      ? 'All markdown roots. Use a single source for focused knowledge work.'
      : selectedRootConfig
        ? displayRootMeta(selectedRootConfig)
        : selectedRoot
  const activeModeDescription = mdMode === 'none'
    ? 'MD Ops service and configured vault roots'
    : mdMode === 'folders'
      ? focusedFolderPath
        ? `Folder focus: ${focusedFolderPath}`
        : 'Folder clusters for the selected markdown source'
      : fileGraphView === 'local'
        ? `${fileGraphHops}-hop semantic link neighborhood${fileFocusedNodeId ? '' : ' · choose a note to focus'}`
        : showFileLabels
          ? 'Whole-vault Markdown graph with labels enabled'
          : 'Whole-vault Markdown graph. Enable labels when density allows.'

  const changeRoot = (value: string) => {
    setRootSelectionTouched(true)
    setSelectedRoot(value)
    setFocusedFolderPath(null)
  }
  const changeMode = (mode: GraphMode) => {
    setMdMode(mode)
    setSearchQuery('')
    setActiveGraphNodeId(null)
    setSubsetFocusNodeId(null)
    setSelectedNode(null)
    if (mode !== 'folders') setFocusedFolderPath(null)
    if (mode === 'files' && activeDocumentPath) setFileGraphView('local')
  }
  const refreshGraph = () => {
    invalidateGraphCache(pageSessionGraphCache, graphPath)
    setForceRebuildKey(graphPath)
    setRefreshRevision((revision) => revision + 1)
  }
  const chooseSearchResult = (node: GraphNode) => {
    setActiveGraphNodeId(node.id)
    setSubsetFocusNodeId(node.id)
    activateNode(node)
  }
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !searchMatches.length) return
    event.preventDefault()
    chooseSearchResult(searchMatches[0])
  }
  const copySelectedPath = async () => {
    if (!selectedPath || typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(selectedPath)
      setCopyStatus('ok')
    } catch {
      setCopyStatus('err')
    }
  }
  const openSelectedFile = () => {
    if (!selectedFileTarget || !onOpenFile) return
    onOpenFile(selectedFileTarget.rootId, selectedFileTarget.relPath)
  }
  const focusedFileNode = fileFocusedNodeId ? graphData?.nodes.find((node) => node.id === fileFocusedNodeId) ?? null : null
  const moveFileHistory = (nextIndex: number) => {
    const nodeId = fileHistory.entries[nextIndex]
    if (!nodeId) return
    setSelectedNode(null)
    setFileHistory((history) => ({ ...history, index: nextIndex }))
    setFileFocusedNodeId(nodeId)
    setActiveGraphNodeId(nodeId)
  }

  return (
    <div ref={dialogRef} className="graph-overlay" role="dialog" aria-modal="true" aria-labelledby="graph-title" aria-describedby="graph-instructions">
      <div className="graph-toolbar">
        <div className="graph-toolbar-main">
          <div className="graph-title-block">
            <div className="graph-title-row">
              <strong id="graph-title">{graphTitle}</strong>
              <span className={`graph-scope-pill ${mdMode === 'none' ? 'system' : ''}`}>{mdMode === 'none' ? 'Topology' : selectedRoot === 'all' ? 'All roots' : 'Scoped'}</span>
            </div>
            <span className="graph-subtitle">{graphSubtitle}</span>
            <span className="graph-stats">{stats}</span>
          </div>
          <div className="graph-mode-group" aria-label="Graph detail mode">
            <button type="button" className={`diff-btn graph-mode-btn ${mdMode === 'none' ? 'active' : 'ghost'}`} aria-pressed={mdMode === 'none'} onClick={() => changeMode('none')}>
              Topology
            </button>
            <button type="button" className={`diff-btn graph-mode-btn ${mdMode === 'folders' ? 'active' : 'ghost'}`} aria-pressed={mdMode === 'folders'} onClick={() => changeMode('folders')}>
              Folders
            </button>
            <button type="button" className={`diff-btn graph-mode-btn ${mdMode === 'files' ? 'active' : 'ghost'}`} aria-pressed={mdMode === 'files'} onClick={() => changeMode('files')}>
              Files
            </button>
          </div>
          <button type="button" className="diff-btn ghost graph-close-btn" onClick={onClose} aria-label="Close graph">
            Close
          </button>
        </div>
        {mdMode === 'files' ? (
          <div className="graph-file-navigation" aria-label="File graph navigation">
            <div className="graph-file-view-controls" aria-label="File graph scope and distance">
              <button type="button" className={`diff-btn ${fileGraphView === 'local' ? 'active' : 'ghost'}`} aria-pressed={fileGraphView === 'local'} onClick={() => setFileGraphView('local')}>Local</button>
              <button type="button" className={`diff-btn ${fileGraphView === 'full' ? 'active' : 'ghost'}`} aria-pressed={fileGraphView === 'full'} onClick={() => setFileGraphView('full')}>Full</button>
              <button type="button" className={`diff-btn ${fileGraphHops === 1 ? 'active' : 'ghost'}`} aria-pressed={fileGraphHops === 1} onClick={() => setFileGraphHops(1)}>1-hop</button>
              <button type="button" className={`diff-btn ${fileGraphHops === 2 ? 'active' : 'ghost'}`} aria-pressed={fileGraphHops === 2} onClick={() => setFileGraphHops(2)}>2-hop</button>
            </div>
            <div className="graph-history-controls" aria-label="Traversal history">
              <button type="button" className="diff-btn ghost" onClick={() => moveFileHistory(fileHistory.index - 1)} disabled={fileHistory.index <= 0} aria-label="Back to previous graph node">Back</button>
              <span className="graph-history-status" aria-live="polite">{focusedFileNode?.label ?? 'No focus'} · {visitedNodeIds.size} visited</span>
              <button type="button" className="diff-btn ghost" onClick={() => moveFileHistory(fileHistory.index + 1)} disabled={fileHistory.index < 0 || fileHistory.index >= fileHistory.entries.length - 1} aria-label="Forward to next graph node">Forward</button>
              <button type="button" className="diff-btn ghost graph-preview-btn" onClick={() => focusedFileNode && previewNode(focusedFileNode)} disabled={!focusedFileNode}>Preview</button>
            </div>
          </div>
        ) : null}
        <button type="button" className={`diff-btn ghost graph-tools-toggle ${mobileToolsOpen ? 'active' : ''}`} aria-expanded={mobileToolsOpen} aria-controls="graph-secondary-tools" onClick={() => setMobileToolsOpen((open) => !open)}>
          Tools
        </button>
        <div id="graph-secondary-tools" className={`graph-controls ${mobileToolsOpen ? 'mobile-open' : ''}`}>
          <label className={`graph-root-filter ${mdMode === 'none' ? 'disabled' : ''}`}>
            <span>Root</span>
            <select value={mdMode === 'none' ? 'all' : selectedRoot} onChange={(e) => changeRoot(e.target.value)} disabled={mdMode === 'none'}>
              <option value="all">All roots</option>
              {roots.map((root) => (
                <option key={root.id} value={root.id}>{displayRootLabel(root)}</option>
              ))}
              </select>
          </label>
          <div className="graph-search">
            <label htmlFor="graph-search-input">Find</label>
            <input
              ref={searchRef}
              id="graph-search-input"
              type="search"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
                setActiveGraphNodeId(null)
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={mdMode === 'files' ? 'Find a note…' : mdMode === 'folders' ? 'Find a folder…' : 'Find a node…'}
              autoComplete="off"
            />
            {searchQuery ? (
              <span className="graph-search-count" role="status">{allSearchMatches.length} match{allSearchMatches.length === 1 ? '' : 'es'}</span>
            ) : null}
            {searchQuery ? (
              <div className="graph-search-results" aria-label="Graph search results">
                {searchMatches.length ? searchMatches.map((node) => (
                  <button key={node.id} type="button" onClick={() => chooseSearchResult(node)}>
                    <span>{node.label}</span>
                    <small>{node.type}{node.props?.relPath ? ` · ${node.props.relPath}` : ''}</small>
                  </button>
                )) : <div className="graph-search-empty">No matching nodes</div>}
              </div>
            ) : null}
          </div>
          {mdMode === 'folders' && focusedFolderPath ? (
            <button type="button" className="diff-btn ghost graph-root-reset" onClick={() => setFocusedFolderPath(null)}>
              Root folders
            </button>
          ) : null}
          <button
            type="button"
            className={`diff-btn graph-label-toggle ${showFileLabels ? 'active' : 'ghost'}`}
            disabled={mdMode !== 'files'}
            onClick={() => setShowFileLabels((v) => !v)}
            title={mdMode === 'files' ? 'Toggle markdown file name labels' : 'Enable file mode first'}
          >
            Labels {showFileLabels ? 'On' : 'Off'}
          </button>
          <button type="button" className="diff-btn ghost graph-refresh-btn" onClick={refreshGraph} disabled={loadingGraph}>
            Refresh
          </button>
        </div>
      </div>
      {error ? <div className="banner err graph-banner">{error}</div> : null}
      <div id="graph-instructions" className="graph-context-strip">
        <div>
          <strong>{activeModeDescription}</strong>
          <span className="graph-context-help">Activate a file node to traverse. Use Preview as a secondary inspector action. Drag and zoom to explore.</span>
        </div>
        {renderMeta && (renderMeta.truncatedNodes || renderMeta.truncatedEdges) ? (
          <span className="graph-budget-note">Focused view · {renderMeta.nodeCount} nodes / {renderMeta.edgeCount} edges drawn</span>
        ) : <span className="graph-keyboard-hint">Esc closes {selectedNode ? 'the inspector' : 'the graph'}</span>}
      </div>
      <div className={`graph-layout ${selectedNode ? 'has-inspector' : ''}`}>
        <div className="graph-stage">
          <div className="graph-canvas" ref={hostRef} aria-label="Interactive graph canvas" />
          {graphMeta && graphMeta.nodeCount > 0 && !loadingGraph ? (
            <div className="graph-view-controls" aria-label="Graph view controls">
              <button type="button" onClick={() => zoomGraphBy(0.72)} aria-label="Zoom out">−</button>
              <button type="button" onClick={() => fitGraphView()} aria-label="Fit graph to view">Fit</button>
              <button type="button" onClick={() => zoomGraphBy(1.38)} aria-label="Zoom in">+</button>
            </div>
          ) : null}
          {loadingGraph ? (
            <div className="graph-state" role="status" aria-live="polite">
              <strong>Loading graph</strong>
              <span>Building a focused {modeLabel(mdMode)}. Large sources can take a few seconds.</span>
            </div>
          ) : !error && graphMeta?.nodeCount === 0 ? (
            <div className="graph-state">
              <strong>No graph data</strong>
              <span>{mdMode === 'none' ? 'The topology endpoint returned no nodes.' : 'This source has no markdown graph nodes for the selected mode.'}</span>
            </div>
          ) : null}
          {graphMeta && graphMeta.nodeCount > 0 ? (
            <div className={`graph-legend ${legendOpen ? 'open' : ''}`} aria-label="Graph legend">
              <button type="button" className="graph-legend-toggle" aria-expanded={legendOpen} onClick={() => setLegendOpen((open) => !open)}>
                <strong>Legend</strong>
                <span>{visibleLegendNodeCount} shown · {visibleLegendEdgeCount} links{visibleLegendNodeCount !== graphMeta.nodeCount ? ` · ${graphMeta.nodeCount} available` : ''}</span>
              </button>
              {legendOpen ? (
                <div className="graph-legend-content">
                  <div className="graph-legend-list">
                    {visibleLegendTypeCounts.slice(0, 8).map((entry) => (
                      <span key={entry.type} className="graph-legend-item">
                        <span className="graph-legend-swatch" style={{ background: colorForType(entry.type) }} />
                        {entry.type}
                        <em>{entry.count}</em>
                      </span>
                    ))}
                  </div>
                  <div className="graph-legend-footer">
                    White ring: focus · blue ring: open note · amber ring: visited · dashed blue arrows: link direction in Local view · generated {formatGeneratedAt(graphMeta.generatedAt)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {selectedNode?.type === 'md' ? (
          <aside className="graph-inspector" aria-label="Markdown node details">
            <div className="graph-inspector-header">
              <div>
                <div className="graph-inspector-kicker">Markdown node</div>
                <strong>{selectedNode.label}</strong>
                <div className="graph-inspector-path">{selectedSummary}</div>
              </div>
              <button ref={inspectorBackRef} type="button" className="diff-btn ghost graph-back-btn" onClick={() => setSelectedNode(null)}>
                Close preview
              </button>
            </div>
            <div className="graph-inspector-actions" aria-label="Markdown node actions">
              <button type="button" className="diff-btn" onClick={openSelectedFile} disabled={!selectedFileTarget || !onOpenFile}>
                Open in editor
              </button>
              <button type="button" className="diff-btn ghost" onClick={copySelectedPath} disabled={!selectedPath} aria-live="polite">
                {copyStatus === 'ok' ? 'Copied' : copyStatus === 'err' ? 'Copy failed' : 'Copy path'}
              </button>
            </div>
            <div className="graph-inspector-meta">
              <div>
                <span>Root</span>
                <strong>{selectedMarkdownRoot ? displayRootLabel(selectedMarkdownRoot) : selectedFileTarget?.rootId ?? 'Unknown'}</strong>
              </div>
              <div>
                <span>Relative path</span>
                <strong>{selectedFileTarget?.relPath ?? 'Unresolved'}</strong>
              </div>
              <div>
                <span>Node id</span>
                <strong>{selectedNode.id}</strong>
              </div>
            </div>
            <div className="graph-fact-grid" aria-label="Markdown stats">
              {selectedFacts.map((fact) => (
                <div key={fact.label}>
                  <span>{fact.label}</span>
                  <strong>{fact.value}</strong>
                </div>
              ))}
            </div>
            <div className="graph-inspector-body">
              {loadingMarkdown ? (
                <div className="empty">Loading markdown...</div>
              ) : selectedMarkdown ? (
                <div className="preview graph-markdown-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedMarkdown}</ReactMarkdown>
                </div>
              ) : (
                <div className="empty">No markdown preview available.</div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
