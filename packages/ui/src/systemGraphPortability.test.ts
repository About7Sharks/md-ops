import { describe, expect, it } from 'bun:test'
import {
  buildGraphSubset,
  buildLocalFileNeighborhood,
  clearPageSessionGraphCache,
  compactGraphNodeLabel,
  graphNodePath,
  graphPositionCacheKey,
  graphRequestPath,
  invalidateGraphCache,
  readGraphCache,
  pageSessionGraphCache,
  pushGraphHistory,
  readGraphPositionCache,
  safeGraphResponse,
  searchGraphNodes,
  seedGraphNodePositions,
  writeGraphCache,
  writeGraphPositionCache,
} from './SystemGraph'

describe('SystemGraph markdown paths', () => {
  it('uses the graph logical node ID before any host-specific path', () => {
    expect(graphNodePath({ id: 'md:demo-root/Guides/Start.md', type: 'md', label: 'Start' })).toBe('demo-root/Guides/Start.md')
  })

  it('uses logical root and relative-path properties when a node ID is not path-bearing', () => {
    expect(graphNodePath({
      id: 'md:note-42',
      type: 'md',
      label: 'Start',
      props: { root: 'demo-root', relPath: '/Guides/Start.md' },
    })).toBe('demo-root/Guides/Start.md')
  })

  it('keeps graph labels short while preserving useful README context', () => {
    expect(compactGraphNodeLabel({ id: 'md:docs/Systems/Network/Home Network Overview.md', type: 'md', label: 'Systems/Network/Home Network Overview.md' })).toBe('Home Network Overview')
    expect(compactGraphNodeLabel({ id: 'md:docs/Systems/Webapps/README.md', type: 'md', label: 'Systems/Webapps/README.md' })).toBe('README · Webapps')
  })
})

describe('SystemGraph request and response boundaries', () => {
  it('builds only the query parameters supported by each mode', () => {
    expect(graphRequestPath('none', 'docs', 'Private')).toBe('/api/system-graph?mdMode=none')
    expect(graphRequestPath('files', 'docs', 'Private')).toBe('/api/system-graph?mdMode=files&root=docs')
    expect(graphRequestPath('folders', 'docs', 'Guides & Notes')).toBe('/api/system-graph?mdMode=folders&root=docs&focus=Guides+%26+Notes')
  })

  it('drops physical paths and malformed graph records at the browser boundary', () => {
    expect(safeGraphResponse({
      generatedAt: '2026-08-01T00:00:00.000Z',
      nodes: [
        { id: 'root:docs', type: 'root', label: 'Docs', props: { path: '/private/vault', root: 'docs' } },
        { id: 'md:docs/Start.md', type: 'md', label: 'Start', props: { path: '/private/vault/Start.md', root: 'docs', relPath: 'Start.md' } },
        { id: 42, type: 'md', label: 'bad' },
      ],
      edges: [
        { from: 'md:docs/Start.md', to: 'root:docs', type: 'in_root' },
        { from: 'missing', to: 'root:docs', type: 'invalid' },
      ],
    })).toEqual({
      generatedAt: '2026-08-01T00:00:00.000Z',
      nodes: [
        { id: 'root:docs', type: 'root', label: 'Docs', props: { root: 'docs' } },
        { id: 'md:docs/Start.md', type: 'md', label: 'Start', props: { root: 'docs', relPath: 'Start.md' } },
      ],
      edges: [{ from: 'md:docs/Start.md', to: 'root:docs', type: 'in_root' }],
    })
  })
})

describe('SystemGraph page-session cache', () => {
  const graph = { generatedAt: '2026-08-01T00:00:00.000Z', nodes: [], edges: [] }

  it('expires entries deterministically without persisting them', () => {
    const cache = new Map()
    writeGraphCache(cache, 'folders', graph, 1_000, 100, 3)

    expect(readGraphCache(cache, 'folders', 1_099)).toBe(graph)
    expect(readGraphCache(cache, 'folders', 1_100)).toBeNull()
    expect(cache.size).toBe(0)
  })

  it('keeps recently read entries and evicts the least recently used entry', () => {
    const cache = new Map()
    writeGraphCache(cache, 'first', graph, 1_000, 100, 2)
    writeGraphCache(cache, 'second', graph, 1_000, 100, 2)
    expect(readGraphCache(cache, 'first', 1_001)).toBe(graph)
    writeGraphCache(cache, 'third', graph, 1_000, 100, 2)

    expect([...cache.keys()]).toEqual(['first', 'third'])
    invalidateGraphCache(cache, 'first')
    expect(readGraphCache(cache, 'first', 1_001)).toBeNull()
  })

  it('clears all page-session graph entries after a successful workspace mutation', () => {
    clearPageSessionGraphCache()
    writeGraphCache(pageSessionGraphCache, 'folders', graph, 1_000, 100, 3)
    writeGraphCache(pageSessionGraphCache, 'files', graph, 1_000, 100, 3)

    clearPageSessionGraphCache()
    expect(pageSessionGraphCache.size).toBe(0)
  })
})

describe('SystemGraph local file navigation', () => {
  const nodes = [
    { id: 'root:docs', type: 'root', label: 'Docs' },
    { id: 'md:docs/A.md', type: 'md', label: 'A' },
    { id: 'md:docs/B.md', type: 'md', label: 'B' },
    { id: 'md:docs/C.md', type: 'md', label: 'C' },
    { id: 'md:docs/D.md', type: 'md', label: 'D' },
  ]
  const edges = [
    ...nodes.slice(1).map((node) => ({ from: node.id, to: 'root:docs', type: 'in_root' })),
    { from: 'md:docs/A.md', to: 'md:docs/B.md', type: 'wikilink' },
    { from: 'md:docs/C.md', to: 'md:docs/B.md', type: 'wikilink' },
    { from: 'md:docs/C.md', to: 'md:docs/D.md', type: 'wikilink' },
  ]

  it('uses deterministic semantic BFS and preserves directed edge records', () => {
    const oneHop = buildLocalFileNeighborhood(nodes, edges, 'md:docs/B.md', 1)
    const twoHop = buildLocalFileNeighborhood([...nodes].reverse(), [...edges].reverse(), 'md:docs/B.md', 2)

    expect(oneHop.nodes.map((node) => node.id)).toEqual(['md:docs/B.md', 'md:docs/A.md', 'md:docs/C.md'])
    expect(oneHop.edges).toEqual([
      { from: 'md:docs/A.md', to: 'md:docs/B.md', type: 'wikilink' },
      { from: 'md:docs/C.md', to: 'md:docs/B.md', type: 'wikilink' },
    ])
    expect(twoHop.nodes.map((node) => node.id)).toEqual(['md:docs/B.md', 'md:docs/A.md', 'md:docs/C.md', 'md:docs/D.md'])
    expect(twoHop.edges).toContainEqual({ from: 'md:docs/C.md', to: 'md:docs/D.md', type: 'wikilink' })
  })

  it('never expands a two-hop neighborhood through the shared structural root', () => {
    const manyNotes = Array.from({ length: 1_999 }, (_, index) => ({ id: `md:docs/${index}.md`, type: 'md', label: String(index) }))
    const structuralGraphNodes = [{ id: 'root:docs', type: 'root', label: 'Docs' }, ...manyNotes]
    const structuralEdges = manyNotes.map((node) => ({ from: node.id, to: 'root:docs', type: 'in_root' }))
    structuralEdges.push({ from: manyNotes[0].id, to: manyNotes[1].id, type: 'wikilink' })

    const subset = buildLocalFileNeighborhood(structuralGraphNodes, structuralEdges, manyNotes[0].id, 2)

    expect(subset.nodes.map((node) => node.id)).toEqual([manyNotes[0].id, manyNotes[1].id])
    expect(subset.edges).toEqual([{ from: manyNotes[0].id, to: manyNotes[1].id, type: 'wikilink' }])
  })

  it('drops forward history after traversal and bounds retained entries', () => {
    const backtracked = { entries: ['a', 'b', 'c'], index: 1 }
    expect(pushGraphHistory(backtracked, 'd')).toEqual({ entries: ['a', 'b', 'd'], index: 2 })
    expect(pushGraphHistory({ entries: ['a', 'b'], index: 1 }, 'c', 2)).toEqual({ entries: ['b', 'c'], index: 1 })
  })

  it('uses a bounded mode/root/node position cache and seeds new nodes around focus', () => {
    const cache = new Map()
    const focusKey = graphPositionCacheKey('files', 'docs', 'md:docs/A.md')
    writeGraphPositionCache(cache, focusKey, { x: 120, y: 90 }, 2)
    writeGraphPositionCache(cache, graphPositionCacheKey('files', 'docs', 'old'), { x: 1, y: 1 }, 2)
    expect(readGraphPositionCache(cache, focusKey)).toEqual({ x: 120, y: 90 })
    writeGraphPositionCache(cache, graphPositionCacheKey('files', 'docs', 'new'), { x: 2, y: 2 }, 2)
    expect(cache.has(graphPositionCacheKey('files', 'docs', 'old'))).toBe(false)

    const seeded = seedGraphNodePositions(nodes.slice(1, 3), cache, 'files', 'docs', 'md:docs/A.md', 800, 600)
    expect(seeded[0]).toMatchObject({ id: 'md:docs/A.md', x: 120, y: 90 })
    expect(Math.hypot(seeded[1].x - 120, seeded[1].y - 90)).toBeGreaterThanOrEqual(38)
    expect(Math.hypot(seeded[1].x - 120, seeded[1].y - 90)).toBeLessThanOrEqual(66)
  })
})

describe('SystemGraph dense-map navigation', () => {
  const nodes = [
    { id: 'root:docs', type: 'root', label: 'Docs' },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `md:docs/Note-${index}.md`, type: 'md', label: `Note ${index}`, props: { root: 'docs', relPath: `Note-${index}.md` } })),
  ]
  const edges = nodes.slice(1).flatMap((node, index) => [
    { from: node.id, to: 'root:docs', type: 'in_root' },
    ...(index > 0 ? [{ from: node.id, to: nodes[index].id, type: 'wikilink' }] : []),
  ])

  it('searches labels and logical relative paths deterministically', () => {
    expect(searchGraphNodes(nodes, 'note-10', 3).map((node) => node.id)).toEqual(['md:docs/Note-10.md'])
    expect(searchGraphNodes(nodes, 'docs note', 2).map((node) => node.id)).toEqual(['md:docs/Note-0.md', 'md:docs/Note-1.md'])
  })

  it('keeps totals honest while bounding nodes and edges around a requested focus', () => {
    const subset = buildGraphSubset(nodes, edges, 5, 'md:docs/Note-10.md')

    expect(subset.nodes).toHaveLength(5)
    expect(subset.nodes.some((node) => node.id === 'md:docs/Note-10.md')).toBe(true)
    expect(subset.nodes.some((node) => node.id === 'root:docs')).toBe(true)
    expect(subset.edges.length).toBeLessThanOrEqual(15)
    expect(subset.truncatedNodes).toBe(true)
    expect(subset.truncatedEdges).toBe(true)
  })
})
