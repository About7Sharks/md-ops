export type MermaidBlock = {
  /** The raw diagram source between the fences. */
  source: string
  /** Fence char used to open the block, e.g. '```'. */
  fence: string
  /** Line number (1-based) where the opening fence begins in the original markdown. */
  startLine: number
}

// Vault Markdown is data, not trusted application markup. Keep Mermaid's
// click handlers and raw HTML disabled when rendering diagram source.
export const MERMAID_SECURITY_LEVEL = 'strict' as const

/**
 * Extract mermaid fenced code blocks from a markdown body.
 *
 * A block is any fenced code block whose info string is exactly `mermaid`
 * (optionally followed by whitespace/attributes). Backtick and tilde fences
 * are both supported. Returns blocks in document order.
 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const out: MermaidBlock[] = []
  const lines = markdown.split(/\r\n|\r|\n/)
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const fenceMatch = line.match(/^\s*(```+|~~~+)\s*(.*)$/)
    if (!fenceMatch) {
      i++
      continue
    }
    const fence = fenceMatch[1]
    const fenceChar = fence[0]
    const info = fenceMatch[2].trim()
    const startLine = i + 1

    // Only mermaid info strings are interesting.
    const isMermaid =
      info === 'mermaid' || info.startsWith('mermaid ') || info.startsWith('mermaid\t')

    if (!isMermaid) {
      i++
      continue
    }

    // Find the closing fence with the same char and at least the same length
    // (CommonMark rule: a shorter run of fence chars does not close the block).
    let j = i + 1
    let source: string | null = null
    while (j < lines.length) {
      const closeMatch = lines[j].match(
        new RegExp(`^\\s*${escapeRegExp(fenceChar)}{${fence.length},}\\s*$`),
      )
      if (closeMatch) {
        source = lines.slice(i + 1, j).join('\n')
        i = j + 1
        break
      }
      j++
    }

    if (source !== null) {
      out.push({ source, fence, startLine })
    } else {
      // Unclosed fence: treat rest of document as the source.
      out.push({ source: lines.slice(i + 1).join('\n'), fence, startLine })
      break
    }
  }

  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Return true when the body contains at least one mermaid block. */
export function hasMermaidBlocks(markdown: string): boolean {
  return extractMermaidBlocks(markdown).length > 0
}
