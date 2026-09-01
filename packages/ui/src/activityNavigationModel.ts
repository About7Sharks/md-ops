import { unified } from 'unified'
import remarkParse from 'remark-parse'

export type ActivityId = 'files' | 'search' | 'graph' | 'outline' | 'links' | 'diagrams'
export type PanelActivityId = Exclude<ActivityId, 'graph'>

export type ActivityDestination = {
  id: ActivityId
  label: string
  kind: 'panel' | 'graph'
}

export const activityDestinations: readonly ActivityDestination[] = [
  { id: 'files', label: 'Files', kind: 'panel' },
  { id: 'search', label: 'Search', kind: 'panel' },
  { id: 'graph', label: 'Graph', kind: 'graph' },
  { id: 'outline', label: 'Outline', kind: 'panel' },
  { id: 'links', label: 'Links', kind: 'panel' },
  { id: 'diagrams', label: 'Diagrams', kind: 'panel' },
]

export type RootSearchResult = {
  kind: 'file' | 'folder'
  path: string
  name: string
}

function pathName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

export function searchRootEntries(query: string, files: string[], folders: string[]): RootSearchResult[] {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return []

  const results: RootSearchResult[] = [
    ...folders.map((path): RootSearchResult => ({ kind: 'folder', path, name: pathName(path) })),
    ...files.map((path): RootSearchResult => ({ kind: 'file', path, name: pathName(path) })),
  ].filter(({ path, name }) => path.toLocaleLowerCase().includes(term) || name.toLocaleLowerCase().includes(term))

  return results.sort((left, right) => {
    const leftNameMatch = left.name.toLocaleLowerCase().startsWith(term) ? 0 : 1
    const rightNameMatch = right.name.toLocaleLowerCase().startsWith(term) ? 0 : 1
    if (leftNameMatch !== rightNameMatch) return leftNameMatch - rightNameMatch
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
    return left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export type MarkdownHeading = {
  depth: number
  text: string
  line: number
  id: string
}

export function markdownHeadingId(line: number | undefined): string | undefined {
  return line && line > 0 ? `md-heading-${line}` : undefined
}

type MarkdownAstNode = {
  type: string
  value?: string
  alt?: string
  depth?: number
  position?: { start?: { line?: number } }
  children?: MarkdownAstNode[]
}

const markdownParser = unified().use(remarkParse)

function astText(node: MarkdownAstNode): string {
  if (node.type === 'image') return node.alt ?? ''
  if (typeof node.value === 'string') return node.value
  return node.children?.map(astText).join('') ?? ''
}

export function parseMarkdownHeadings(markdown: string): MarkdownHeading[] {
  const tree = markdownParser.parse(markdown) as MarkdownAstNode
  const headings: MarkdownHeading[] = []

  const visit = (node: MarkdownAstNode) => {
    if (node.type === 'heading' && node.depth) {
      const line = node.position?.start?.line
      const id = markdownHeadingId(line)
      const text = astText(node).trim()
      if (line && id && text) headings.push({ depth: node.depth, text, line, id })
    }
    node.children?.forEach(visit)
  }

  visit(tree)
  return headings
}
