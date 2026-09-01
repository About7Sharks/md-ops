const MARKDOWN_EXT_PATTERN = /\.(md|mmd|mermaid)$/i

export function normalizeFolderPath(input: string): string {
  const raw = input.replace(/\\/g, '/').trim()
  if (!raw) return ''
  if (raw.startsWith('/')) throw new Error('Folder must be relative to the selected source')
  const parts = raw.split('/').map((part) => part.trim()).filter(Boolean)
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Folder cannot contain . or .. segments')
  }
  return parts.join('/')
}

export function normalizeMarkdownFileName(input: string): string {
  const raw = input.trim()
  if (!raw) throw new Error('File name is required')
  if (raw.includes('/') || raw.includes('\\')) {
    throw new Error('Use the folder picker or folder field for directories')
  }
  if (raw === '.' || raw === '..') throw new Error('File name cannot be . or ..')
  return MARKDOWN_EXT_PATTERN.test(raw) ? raw : `${raw}.md`
}

export function buildNewMarkdownPath(folder: string, fileName: string): string {
  const cleanFolder = normalizeFolderPath(folder)
  const cleanName = normalizeMarkdownFileName(fileName)
  return cleanFolder ? `${cleanFolder}/${cleanName}` : cleanName
}
