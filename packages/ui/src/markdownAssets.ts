const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/([\\[\]])/g, '\\$1')
}

function isExternalUrl(src: string): boolean {
  return /^(https?:|data:|blob:|mailto:|#)/i.test(src)
}

function stripUrlSuffix(path: string): string {
  return path.split('#')[0].split('?')[0].trim()
}

function decodeAssetSource(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function normalizeVaultPath(path: string): string {
  const out: string[] = []
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

function selectedFolder(selectedRelPath: string | null): string {
  if (!selectedRelPath) return ''
  const normalized = normalizeVaultPath(selectedRelPath)
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(0, slash) : ''
}

export function isImageAssetPath(path: string): boolean {
  return IMAGE_EXT_RE.test(stripUrlSuffix(path))
}

export function resolveVaultAssetPath(src: string | undefined, selectedRelPath: string | null): string | null {
  if (!src) return null
  const trimmed = src.trim()
  if (!trimmed || isExternalUrl(trimmed) || trimmed.startsWith('/api/asset') || trimmed.startsWith('/app/md-ops/api/asset')) return null

  const clean = decodeAssetSource(stripUrlSuffix(trimmed))
  if (!isImageAssetPath(clean)) return null

  if (clean.startsWith('./') || clean.startsWith('../')) {
    return normalizeVaultPath(`${selectedFolder(selectedRelPath)}/${clean}`)
  }

  const withoutLeadingSlash = clean.replace(/^\/+/, '')
  if (withoutLeadingSlash.includes('/')) {
    return normalizeVaultPath(withoutLeadingSlash)
  }

  return normalizeVaultPath(`${selectedFolder(selectedRelPath)}/${withoutLeadingSlash}`)
}

export function assetUrl(apiBase: string, rootId: string, relPath: string): string {
  return `${apiBase}/api/asset?path=${encodeURIComponent(`${rootId}/${relPath}`)}`
}

export function markdownWithWikilinksAndImages(
  body: string,
  apiBase: string,
  rootId: string | null,
  selectedRelPath: string | null
): string {
  const withImageEmbeds = body.replace(/!\[\[([^\]]+)\]\]/g, (match, inner) => {
    if (!rootId) return match
    const raw = String(inner)
    const [targetRaw, aliasRaw] = raw.split('|')
    const target = stripUrlSuffix(targetRaw || '')
    const relPath = resolveVaultAssetPath(target, selectedRelPath)
    if (!relPath) return match
    const alt = (aliasRaw || relPath.split('/').pop() || relPath).trim()
    return `![${escapeMarkdownLinkLabel(alt)}](${assetUrl(apiBase, rootId, relPath)})`
  })

  return withImageEmbeds.replace(/(^|[^!])\[\[([^\]]+)\]\]/g, (_match, prefix, inner) => {
    const raw = String(inner)
    const alias = raw.split('|')[1]?.trim()
    const label = alias || raw.split('#')[0].trim()
    const target = raw.split('|')[0].split('#')[0].trim()
    return `${prefix}[${escapeMarkdownLinkLabel(label)}](#wikilink:${encodeURIComponent(target)})`
  })
}
