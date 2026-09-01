export type Wikilink = {
  raw: string
  target: string
  anchor?: string
  alias?: string
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

export function parseWikilinks(markdown: string): Wikilink[] {
  const out: Wikilink[] = []
  for (const match of markdown.matchAll(WIKILINK_RE)) {
    if (match.index && markdown[match.index - 1] === '!') continue
    const rawInner = match[1]?.trim()
    if (!rawInner) continue

    const [targetAndAnchor, alias] = rawInner.split('|')
    const [target, anchor] = (targetAndAnchor || '').split('#')
    const cleanTarget = target?.trim()
    if (!cleanTarget) continue

    out.push({
      raw: match[0],
      target: cleanTarget,
      anchor: anchor?.trim() || undefined,
      alias: alias?.trim() || undefined,
    })
  }
  return out
}

export function extractFrontmatter(markdown: string): { frontmatter: string | null; body: string } {
  if (!markdown.startsWith('---\n')) return { frontmatter: null, body: markdown }
  const end = markdown.indexOf('\n---\n', 4)
  if (end === -1) return { frontmatter: null, body: markdown }
  return {
    frontmatter: markdown.slice(4, end).trim(),
    body: markdown.slice(end + 5),
  }
}

export function parseFrontmatterTags(frontmatter: string | null): string[] {
  if (!frontmatter) return []
  const lines = frontmatter.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    const inlineMatch = trimmed.match(/^tags:\s*\[(.*)\]\s*$/i)
    if (inlineMatch) {
      const inlineTags = inlineMatch[1]
        .split(',')
        .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
      out.push(...inlineTags)
      continue
    }

    const scalarMatch = trimmed.match(/^tags:\s*(.+)$/i)
    if (scalarMatch && scalarMatch[1].trim() && scalarMatch[1].trim() !== '|') {
      out.push(scalarMatch[1].trim().replace(/^['"]|['"]$/g, ''))
      continue
    }

    if (/^tags:\s*$/i.test(trimmed)) {
      for (let j = i + 1; j < lines.length; j++) {
        const child = lines[j]
        if (!/^\s+/.test(child)) break
        const childTrimmed = child.trim()
        const bulletMatch = childTrimmed.match(/^[-*]\s+(.+)$/)
        if (!bulletMatch) continue
        out.push(bulletMatch[1].trim().replace(/^['"]|['"]$/g, ''))
        i = j
      }
    }
  }

  return [...new Set(out.map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean))]
}

const MARKDOWN_EXTENSIONS = ['.md', '.mmd', '.mermaid']
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp']
const TEXT_PREVIEW_EXTENSIONS = [
  ...MARKDOWN_EXTENSIONS,
  '.txt', '.json', '.jsonl', '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.sh', '.yml', '.yaml',
  '.xml', '.csv', '.srt', '.log', '.plist', '.toml', '.ini', '.conf', '.excalidraw', '.canvas', '.base',
]
const MEDIA_EXTENSIONS = ['.mov', '.mp4', '.webm', '.mp3', '.wav', '.ogg']

function lowerExt(relPath: string): string {
  const name = relPath.toLowerCase().split('/').pop() || relPath.toLowerCase()
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index) : ''
}

export function isMarkdownFile(relPath: string): boolean {
  const path = relPath.toLowerCase()
  return MARKDOWN_EXTENSIONS.some((ext) => path.endsWith(ext))
}

export function isImageFile(relPath: string): boolean {
  const path = relPath.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => path.endsWith(ext))
}

export function isTextPreviewFile(relPath: string): boolean {
  const path = relPath.toLowerCase()
  return TEXT_PREVIEW_EXTENSIONS.some((ext) => path.endsWith(ext)) || /\.md\.bak/i.test(path)
}

export function fileKind(relPath: string): string {
  const path = relPath.toLowerCase()
  const ext = lowerExt(path)
  if (path.endsWith('skill.md')) return 'skill'
  if (path.endsWith('.canvas')) return 'canvas'
  if (path === 'memory.md') return 'memory'
  if (path === 'agents.md' || path === 'soul.md' || path === 'user.md') return 'anchor'
  if (/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(path)) return 'daily'
  if (isMarkdownFile(path)) return 'markdown'
  if (isImageFile(path)) return 'image'
  if (ext === '.json' || ext === '.jsonl') return 'data'
  if (ext === '.html' || ext === '.css') return 'web'
  if (['.js', '.jsx', '.ts', '.tsx', '.py', '.sh'].includes(ext)) return 'script'
  if (['.txt', '.srt', '.log'].includes(ext)) return 'text'
  if (ext === '.pdf') return 'pdf'
  if (MEDIA_EXTENSIONS.includes(ext)) return 'media'
  return 'file'
}

export function fileKindLabel(relPath: string): string {
  const kind = fileKind(relPath)
  switch (kind) {
    case 'skill': return 'SKILL'
    case 'canvas': return 'CANVAS'
    case 'memory': return 'MEMORY'
    case 'anchor': return 'CORE'
    case 'daily': return 'DAILY'
    case 'markdown': return 'MD'
    case 'image': return 'IMG'
    case 'data': return 'DATA'
    case 'web': return 'WEB'
    case 'script': return 'CODE'
    case 'text': return 'TXT'
    case 'pdf': return 'PDF'
    case 'media': return 'MEDIA'
    default: return 'FILE'
  }
}

export function resolveWikilinkToPath(target: string, files: string[]): string | null {
  const normalized = target.trim().toLowerCase()
  if (!normalized) return null

  const exactCandidates = [
    normalized,
    normalized.endsWith('.md') ? normalized : `${normalized}.md`,
  ]

  for (const file of files) {
    const fileLower = file.toLowerCase()
    if (exactCandidates.includes(fileLower)) return file
  }

  for (const file of files) {
    const fileLower = file.toLowerCase()
    if (fileLower.endsWith(`/${normalized}`) || fileLower.endsWith(`/${normalized}.md`)) return file
  }

  for (const file of files) {
    const basename = file.split('/').pop()?.toLowerCase()
    if (basename === normalized || basename === `${normalized}.md`) return file
  }

  return null
}
