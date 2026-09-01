// Pure model/cache layer for SystemGraph. Kept free of d3 and react so App can
// import cache invalidation helpers without pulling the graph renderer (and d3)
// into the boot bundle.
import type { Root } from './api'

export type GraphMode = 'none' | 'folders' | 'files'
export type FileGraphView = 'local' | 'full'
export type GraphNode = { id: string; type: string; label: string; props?: { root?: string; relPath?: string } }
export type GraphEdge = { from: string; to: string; type: string }
export type GraphResponse = { nodes: GraphNode[]; edges: GraphEdge[]; generatedAt: string }
export type GraphCacheEntry = { graph: GraphResponse; expiresAt: number }
export type GraphPosition = { x: number; y: number }
export type GraphHistory = { entries: string[]; index: number }
export type GraphMeta = {
  nodeCount: number
  edgeCount: number
  generatedAt?: string
  modeLabel: string
  scopeLabel: string
  focusLabel: string | null
  typeCounts: Array<{ type: string; count: number }>
}
export type RenderMeta = {
  nodeCount: number
  edgeCount: number
  truncatedNodes: boolean
  truncatedEdges: boolean
  typeCounts: Array<{ type: string; count: number }>
}

export const GRAPH_NODE_BUDGET = 420
export const GRAPH_MOBILE_NODE_BUDGET = 120
export const GRAPH_CACHE_TTL_MS = 45_000
export const GRAPH_CACHE_MAX_ENTRIES = 8
export const GRAPH_POSITION_CACHE_MAX_ENTRIES = 1600
export const GRAPH_HISTORY_MAX_ENTRIES = 64
const GRAPH_EDGE_RATIO = 3
export const GRAPH_SEARCH_RESULT_LIMIT = 6
export const GRAPH_DENSE_LABEL_LIMIT = 56

export function graphRequestPath(mode: GraphMode, rootId = 'all', focusPath: string | null = null): string {
  const params = new URLSearchParams({ mdMode: mode })
  if (mode !== 'none' && rootId !== 'all') params.set('root', rootId)
  if (mode === 'folders' && focusPath) params.set('focus', focusPath)
  return `/api/system-graph?${params.toString()}`
}

/** Page-session-only cache: no graph data is written to browser storage. */
export const pageSessionGraphCache = new Map<string, GraphCacheEntry>()

export function clearPageSessionGraphCache(): void {
  pageSessionGraphCache.clear()
  pageSessionGraphPositionCache.clear()
}

export function readGraphCache(
  cache: Map<string, GraphCacheEntry>,
  key: string,
  now = Date.now(),
): GraphResponse | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    cache.delete(key)
    return null
  }
  // Re-inserting makes this entry most recently used in insertion-order Map.
  cache.delete(key)
  cache.set(key, entry)
  return entry.graph
}

export function writeGraphCache(
  cache: Map<string, GraphCacheEntry>,
  key: string,
  graph: GraphResponse,
  now = Date.now(),
  ttlMs = GRAPH_CACHE_TTL_MS,
  maxEntries = GRAPH_CACHE_MAX_ENTRIES,
): void {
  cache.delete(key)
  cache.set(key, { graph, expiresAt: now + Math.max(0, ttlMs) })
  const boundedMaxEntries = Math.max(1, Math.floor(maxEntries))
  while (cache.size > boundedMaxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

export function invalidateGraphCache(cache: Map<string, GraphCacheEntry>, key: string): void {
  cache.delete(key)
}

/** Positions are page-session-only and bounded independently from graph responses. */
export const pageSessionGraphPositionCache = new Map<string, GraphPosition>()

export function graphPositionCacheKey(mode: GraphMode, rootId: string, nodeId: string): string {
  return `${mode}:${rootId}:${nodeId}`
}

export function readGraphPositionCache(cache: Map<string, GraphPosition>, key: string): GraphPosition | null {
  const position = cache.get(key)
  if (!position) return null
  cache.delete(key)
  cache.set(key, position)
  return position
}

export function writeGraphPositionCache(
  cache: Map<string, GraphPosition>,
  key: string,
  position: GraphPosition,
  maxEntries = GRAPH_POSITION_CACHE_MAX_ENTRIES,
): void {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return
  cache.delete(key)
  cache.set(key, { x: position.x, y: position.y })
  const boundedMaxEntries = Math.max(1, Math.floor(maxEntries))
  while (cache.size > boundedMaxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

function stableNodeHash(value: string): number {
  let hash = 2166136261
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

export function seedGraphNodePositions(
  nodes: GraphNode[],
  cache: Map<string, GraphPosition>,
  mode: GraphMode,
  rootId: string,
  focusNodeId: string | null,
  width: number,
  height: number,
): Array<GraphNode & GraphPosition> {
  const focusPosition = focusNodeId
    ? readGraphPositionCache(cache, graphPositionCacheKey(mode, rootId, focusNodeId))
    : null
  const origin = focusPosition ?? { x: width / 2, y: height / 2 }
  return nodes.map((node) => {
    const cached = readGraphPositionCache(cache, graphPositionCacheKey(mode, rootId, node.id))
    if (cached) return { ...node, ...cached }
    if (node.id === focusNodeId) return { ...node, ...origin }
    const hash = stableNodeHash(node.id)
    const angle = (hash % 360) * (Math.PI / 180)
    const radius = 38 + (hash % 29)
    return {
      ...node,
      x: origin.x + Math.cos(angle) * radius,
      y: origin.y + Math.sin(angle) * radius,
    }
  })
}

export function pushGraphHistory(
  history: GraphHistory,
  nodeId: string,
  maxEntries = GRAPH_HISTORY_MAX_ENTRIES,
): GraphHistory {
  if (history.entries[history.index] === nodeId) return history
  const entries = [...history.entries.slice(0, history.index + 1), nodeId]
  const boundedMaxEntries = Math.max(1, Math.floor(maxEntries))
  const boundedEntries = entries.slice(-boundedMaxEntries)
  return { entries: boundedEntries, index: boundedEntries.length - 1 }
}

function graphNodeSearchText(node: GraphNode): string {
  return [node.label, node.props?.relPath, node.id, node.type].filter(Boolean).join(' ').toLocaleLowerCase()
}

export function searchGraphNodes(nodes: GraphNode[], query: string, limit = GRAPH_SEARCH_RESULT_LIMIT): GraphNode[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return []
  const terms = normalized.split(/\s+/).filter(Boolean)
  return nodes
    .filter((node) => {
      const text = graphNodeSearchText(node)
      return terms.every((term) => text.includes(term))
    })
    .sort((a, b) => {
      const aLabel = a.label.toLocaleLowerCase()
      const bLabel = b.label.toLocaleLowerCase()
      const aStarts = aLabel.startsWith(normalized) ? 0 : 1
      const bStarts = bLabel.startsWith(normalized) ? 0 : 1
      return aStarts - bStarts || aLabel.localeCompare(bLabel) || a.id.localeCompare(b.id)
    })
    .slice(0, Math.max(0, limit))
}

export function safeGraphResponse(value: unknown): GraphResponse {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return []
      const node = candidate as Record<string, unknown>
      if (typeof node.id !== 'string' || typeof node.type !== 'string' || typeof node.label !== 'string') return []
      const rawProps = node.props && typeof node.props === 'object' ? node.props as Record<string, unknown> : null
      const root = typeof rawProps?.root === 'string' ? rawProps.root : undefined
      const relPath = typeof rawProps?.relPath === 'string' ? rawProps.relPath : undefined
      const props = root || relPath ? { ...(root ? { root } : {}), ...(relPath ? { relPath } : {}) } : undefined
      return [{ id: node.id, type: node.type, label: node.label, ...(props ? { props } : {}) }]
    })
    : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(raw.edges)
    ? raw.edges.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return []
      const edge = candidate as Record<string, unknown>
      if (typeof edge.from !== 'string' || typeof edge.to !== 'string' || typeof edge.type !== 'string') return []
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return []
      return [{ from: edge.from, to: edge.to, type: edge.type }]
    })
    : []
  return {
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    nodes,
    edges,
  }
}

export function isSemanticFileEdge(edge: GraphEdge): boolean {
  return edge.type.includes('wikilink')
}

export function buildLocalFileNeighborhood(
  nodes: GraphNode[],
  edges: GraphEdge[],
  focusNodeId: string,
  hops: 1 | 2,
  nodeBudget = GRAPH_NODE_BUDGET,
): { nodes: GraphNode[]; edges: GraphEdge[]; truncatedNodes: boolean; truncatedEdges: boolean } {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (!byId.has(focusNodeId)) return { nodes: [], edges: [], truncatedNodes: false, truncatedEdges: false }

  const validEdges = edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to))
  const adjacency = new Map<string, Set<string>>()
  for (const edge of validEdges.filter(isSemanticFileEdge)) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set())
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set())
    adjacency.get(edge.from)?.add(edge.to)
    adjacency.get(edge.to)?.add(edge.from)
  }

  const orderedIds = [focusNodeId]
  const distance = new Map([[focusNodeId, 0]])
  for (let cursor = 0; cursor < orderedIds.length; cursor += 1) {
    const nodeId = orderedIds[cursor]
    const nodeDistance = distance.get(nodeId) ?? 0
    if (nodeDistance >= hops) continue
    const neighbors = [...(adjacency.get(nodeId) ?? [])].sort((a, b) => a.localeCompare(b))
    for (const neighborId of neighbors) {
      if (distance.has(neighborId)) continue
      distance.set(neighborId, nodeDistance + 1)
      orderedIds.push(neighborId)
    }
  }

  const boundedNodeBudget = Math.max(1, Math.floor(nodeBudget))
  const selectedIdsInOrder = orderedIds.slice(0, boundedNodeBudget)
  const selectedIds = new Set(selectedIdsInOrder)
  const selectedNodes = selectedIdsInOrder.flatMap((id) => {
    const node = byId.get(id)
    return node ? [node] : []
  })
  const selectedEdges = validEdges
    .filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type))

  return {
    nodes: selectedNodes,
    edges: selectedEdges,
    truncatedNodes: orderedIds.length > selectedNodes.length,
    truncatedEdges: false,
  }
}

export function buildGraphSubset(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeBudget = GRAPH_NODE_BUDGET,
  focusNodeId: string | null = null,
): { nodes: GraphNode[]; edges: GraphEdge[]; truncatedNodes: boolean; truncatedEdges: boolean } {
  const boundedNodeBudget = Math.max(1, Math.floor(nodeBudget))
  const validIds = new Set(nodes.map((node) => node.id))
  const validEdges = edges.filter((edge) => validIds.has(edge.from) && validIds.has(edge.to))
  const degree = new Map(nodes.map((node) => [node.id, 0]))
  const neighbors = new Set<string>()
  for (const edge of validEdges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
    if (focusNodeId === edge.from) neighbors.add(edge.to)
    if (focusNodeId === edge.to) neighbors.add(edge.from)
  }
  const typePriority = (type: string) => ({ root: 6, service: 5, host: 4, agent: 3, repo: 2, skill: 1 }[type] ?? 0)
  const rankedNodes = [...nodes].sort((a, b) => {
    const aFocus = a.id === focusNodeId ? 3 : neighbors.has(a.id) ? 2 : 0
    const bFocus = b.id === focusNodeId ? 3 : neighbors.has(b.id) ? 2 : 0
    return bFocus - aFocus
      || typePriority(b.type) - typePriority(a.type)
      || (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
      || a.label.localeCompare(b.label)
      || a.id.localeCompare(b.id)
  })
  const selectedNodes = rankedNodes.slice(0, boundedNodeBudget)
  const selectedIds = new Set(selectedNodes.map((node) => node.id))
  const structuralTypes = new Set(['in_folder', 'in_root', 'mounted_by'])
  const eligibleEdges = validEdges
    .filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to))
  const edgeBudget = Math.max(selectedNodes.length, selectedNodes.length * GRAPH_EDGE_RATIO)
  // The sort exists to pick which edges survive the budget. If every eligible
  // edge fits, skip it — the relative order doesn't matter and the comparator
  // is O(n log n) with localeCompare.
  const eligibleEdgeCount = eligibleEdges.length
  const selectedEdges = eligibleEdgeCount <= edgeBudget
    ? eligibleEdges
    : eligibleEdges.sort((a, b) => {
      const aFocus = a.from === focusNodeId || a.to === focusNodeId ? 0 : 1
      const bFocus = b.from === focusNodeId || b.to === focusNodeId ? 0 : 1
      const aStructural = structuralTypes.has(a.type) ? 0 : 1
      const bStructural = structuralTypes.has(b.type) ? 0 : 1
      return aFocus - bFocus || aStructural - bStructural || a.type.localeCompare(b.type) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
    }).slice(0, edgeBudget)
  return {
    nodes: selectedNodes,
    edges: selectedEdges,
    truncatedNodes: selectedNodes.length < nodes.length,
    truncatedEdges: selectedEdges.length < eligibleEdges.length || eligibleEdges.length < validEdges.length,
  }
}

const NODE_COLORS: Record<string, string> = {
  agent: '#ffa657',
  folder: '#3fb950',
  host: '#d29922',
  md: '#58a6ff',
  repo: '#79c0ff',
  root: '#a371f7',
  service: '#f85149',
  skill: '#f778ba',
}
const FALLBACK_COLORS = ['#8b949e', '#7ee787', '#c297ff', '#ff7b72', '#ffdf5d', '#76e3ea']

export function colorForType(type: string): string {
  if (NODE_COLORS[type]) return NODE_COLORS[type]
  const hash = [...type].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}

export function displayRootLabel(root: Pick<Root, 'id' | 'label'>): string {
  return root.label || root.id.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function displayRootMeta(root: Pick<Root, 'id'>): string {
  return root.id
}

export function preferredRootId(roots: Root[]): string | null {
  if (!roots.length) return null
  return roots[0].id
}

export function modeLabel(mode: GraphMode): string {
  if (mode === 'none') return 'topology'
  if (mode === 'folders') return 'folder map'
  return 'file map'
}

export function graphNodePath(node: GraphNode): string | null {
  if (node.type !== 'md') return null
  const fromId = node.id.startsWith('md:') ? node.id.slice(3) : null
  if (fromId && fromId.includes('/')) return fromId
  const root = node.props?.root
  const relPath = node.props?.relPath?.replace(/^\/+/, '')
  return root && relPath ? `${root}/${relPath}` : null
}

export function splitGraphPath(path: string | null): { rootId: string; relPath: string } | null {
  if (!path) return null
  const [rootId, ...rest] = path.split('/')
  const relPath = rest.join('/')
  if (!rootId || !relPath) return null
  return { rootId, relPath }
}

export function markdownFacts(markdown: string): Array<{ label: string; value: string }> {
  const text = markdown || ''
  const headings = text.match(/^#{1,6}\s+\S.*$/gm)?.length ?? 0
  const wikilinks = text.match(/\[\[[^\]]+\]\]/g)?.length ?? 0
  const tags = new Set((text.match(/(^|\s)#[A-Za-z0-9/_-]+/g) ?? []).map((tag) => tag.trim().replace(/^#/, '')))
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return [
    { label: 'Lines', value: String(text ? text.split(/\r?\n/).length : 0) },
    { label: 'Words', value: String(words) },
    { label: 'Headings', value: String(headings) },
    { label: 'Wikilinks', value: String(wikilinks) },
    { label: 'Tags', value: String(tags.size) },
  ]
}

export function formatGeneratedAt(value?: string): string {
  if (!value) return 'Not reported'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function compactGraphNodeLabel(node: GraphNode): string {
  if (node.type !== 'md') return node.label
  const logicalPath = node.props?.relPath ?? graphNodePath(node)?.split('/').slice(1).join('/') ?? node.label
  const parts = logicalPath.split('/').filter(Boolean)
  const fileName = (parts.pop() ?? node.label).replace(/\.md$/i, '')
  const parent = parts.pop()
  if (/^readme$/i.test(fileName) && parent) return `README · ${parent}`
  return fileName.length > 38 ? `${fileName.slice(0, 35)}…` : fileName
}
