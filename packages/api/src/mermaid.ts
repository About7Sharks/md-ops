export type MermaidBlock = {
  /** Diagram source between the fences. */
  source: string
  /** 1-based line number of the opening fence. */
  startLine: number
}

const MERMAID_FENCE_RE = /^[ \t]*(```+|~~~+)[ \t]*mermaid(?:[ \t][^\r\n]*)?\r?$/gm;

/**
 * Extract mermaid fenced code blocks from a Markdown body. Fences may be
 * backtick or tilde runs, with optional trailing attributes on the info string.
 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const out: MermaidBlock[] = []
  MERMAID_FENCE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MERMAID_FENCE_RE.exec(markdown)) !== null) {
    const fence = match[1]
    const fenceChar = fence[0]
    const fenceLen = fence.length
    const openLine = markdown.slice(0, match.index).split("\n").length
    const contentStart = match.index + match[0].length

    const closing = new RegExp(
      `^\\s*${fenceChar === "`" ? "`" : "~"}{${fenceLen},}[ \t]*\\r?$`,
      "gm"
    )
    closing.lastIndex = contentStart
    const closeMatch = closing.exec(markdown)

    if (!closeMatch) {
      // Unclosed fence: treat the rest of the body as the diagram.
      const source = markdown.slice(contentStart).replace(/\s+$/, "")
      if (source) out.push({ source, startLine: openLine })
      break
    }

    const source = markdown
      .slice(contentStart, closeMatch.index)
      .replace(/\s+$/, "")
    if (source) out.push({ source, startLine: openLine })
    MERMAID_FENCE_RE.lastIndex = closeMatch.index + closeMatch[0].length
  }
  return out
}
