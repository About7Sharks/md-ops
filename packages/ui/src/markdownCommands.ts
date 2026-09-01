export type MarkdownSelection = {
  value: string
  selectionStart: number
  selectionEnd: number
}

export type MarkdownCommand =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'link'
  | 'inline-code'
  | 'quote'
  | 'bulleted-list'
  | 'numbered-list'
  | 'task-list'
  | 'code-block'

function result(value: string, selectionStart: number, selectionEnd = selectionStart): MarkdownSelection {
  return { value, selectionStart, selectionEnd }
}

function clampSelection(value: string, start: number, end: number): [number, number] {
  const selectionStart = Math.max(0, Math.min(start, value.length))
  const selectionEnd = Math.max(selectionStart, Math.min(end, value.length))
  return [selectionStart, selectionEnd]
}

function selectedLines(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  let lineEnd = value.indexOf('\n', end)
  if (lineEnd === -1) lineEnd = value.length
  return { lineStart, lineEnd, text: value.slice(lineStart, lineEnd) }
}

function transformLines(
  value: string,
  start: number,
  end: number,
  transform: (lines: string[]) => string[],
): MarkdownSelection {
  const range = selectedLines(value, start, end)
  const lines = range.text.split('\n')
  const replacement = transform(lines).join('\n')
  const before = value.slice(0, range.lineStart)
  const after = value.slice(range.lineEnd)
  const updated = before + replacement + after
  const mapPosition = (position: number) => {
    if (position < range.lineStart) return position
    if (position > range.lineEnd) return position + replacement.length - range.text.length
    const relative = position - range.lineStart
    const originalBefore = range.text.slice(0, relative)
    const lineIndex = originalBefore.split('\n').length - 1
    const column = relative - (originalBefore.lastIndexOf('\n') + 1)
    const changedBefore = transform(lines.slice(0, lineIndex)).join('\n')
    const changedLine = transform([lines[lineIndex] ?? ''])[0] ?? ''
    const changedColumn = Math.min(changedLine.length, column + changedLine.length - (lines[lineIndex] ?? '').length)
    return range.lineStart + changedBefore.length + (lineIndex ? 1 : 0) + changedColumn
  }
  return result(updated, mapPosition(start), mapPosition(end))
}

function toggleInline(value: string, start: number, end: number, marker: string): MarkdownSelection {
  const [selectionStart, selectionEnd] = clampSelection(value, start, end)
  const selected = value.slice(selectionStart, selectionEnd)
  if (selected && selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
    return result(
      value.slice(0, selectionStart) + selected.slice(marker.length, -marker.length) + value.slice(selectionEnd),
      selectionStart,
      selectionEnd - marker.length * 2,
    )
  }
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)
  if (!selected && before.endsWith(marker) && after.startsWith(marker)) {
    return result(before.slice(0, -marker.length) + after.slice(marker.length), selectionStart - marker.length)
  }
  return result(before + marker + selected + marker + after, selectionStart + marker.length, selectionEnd + marker.length)
}

function toggleLink(value: string, start: number, end: number): MarkdownSelection {
  const [selectionStart, selectionEnd] = clampSelection(value, start, end)
  const selected = value.slice(selectionStart, selectionEnd)
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)
  const suffix = after.match(/^\]\(([^)]*)\)/)
  if (before.endsWith('[') && suffix) {
    const href = suffix[0]
    return result(before.slice(0, -1) + selected + after.slice(href.length), selectionStart - 1, selectionEnd - 1)
  }
  return result(before + '[' + selected + '](url)' + after, selectionStart + 1, selectionEnd + 1)
}

function toggleCodeBlock(value: string, start: number, end: number): MarkdownSelection {
  const [selectionStart, selectionEnd] = clampSelection(value, start, end)
  const range = selectedLines(value, selectionStart, selectionEnd)
  const before = value.slice(0, range.lineStart)
  const after = value.slice(range.lineEnd)
  const lines = range.text.split('\n')

  const lastLine = lines[lines.length - 1]
  if (lines.length >= 2 && lines[0].startsWith('```') && lastLine?.startsWith('```')) {
    const unwrapped = lines.slice(1, -1).join('\n')
    const updated = before + unwrapped + after
    return result(updated, Math.max(range.lineStart, selectionStart - lines[0].length - 1), Math.max(range.lineStart, selectionEnd - lastLine.length - 2))
  }

  const opening = before.lastIndexOf('```')
  const closing = value.indexOf('\n```', selectionEnd)
  if (opening !== -1 && opening >= before.lastIndexOf('\n') && closing !== -1) {
    const openingEnd = value.indexOf('\n', opening)
    const fenceEnd = closing + 4
    const withoutClosing = value.slice(0, closing) + value.slice(fenceEnd)
    const withoutFences = withoutClosing.slice(0, opening) + withoutClosing.slice(openingEnd + 1)
    const removedBefore = openingEnd - opening + 1
    const removedClosing = fenceEnd - closing
    return result(withoutFences, selectionStart - removedBefore, selectionEnd - removedBefore - (selectionEnd > closing ? removedClosing : 0))
  }

  const body = range.text
  const inserted = `\`\`\`\n${body}\n\`\`\``
  return result(before + inserted + after, selectionStart + 4, selectionEnd + 4)
}

export function applyMarkdownCommand(command: MarkdownCommand, value: string, start: number, end: number): MarkdownSelection {
  const [selectionStart, selectionEnd] = clampSelection(value, start, end)
  switch (command) {
    case 'bold': return toggleInline(value, selectionStart, selectionEnd, '**')
    case 'italic': return toggleInline(value, selectionStart, selectionEnd, '*')
    case 'inline-code': return toggleInline(value, selectionStart, selectionEnd, '`')
    case 'link': return toggleLink(value, selectionStart, selectionEnd)
    case 'heading':
      return transformLines(value, selectionStart, selectionEnd, (lines) => {
        const hasHeading = lines.every((line) => /^#{1,6}\s/.test(line) || line === '')
        return lines.map((line) => hasHeading ? line.replace(/^#{1,6}\s/, '') : `## ${line}`)
      })
    case 'quote':
      return transformLines(value, selectionStart, selectionEnd, (lines) => {
        const quoted = lines.every((line) => /^>\s?/.test(line) || line === '')
        return lines.map((line) => quoted ? line.replace(/^>\s?/, '') : `> ${line}`)
      })
    case 'bulleted-list':
      return transformLines(value, selectionStart, selectionEnd, (lines) => {
        const listed = lines.every((line) => /^\s*[-*+]\s+/.test(line) || line === '')
        return lines.map((line) => listed ? line.replace(/^(\s*)[-*+]\s+/, '$1') : line ? `- ${line}` : line)
      })
    case 'numbered-list':
      return transformLines(value, selectionStart, selectionEnd, (lines) => {
        const listed = lines.every((line) => /^\s*\d+[.)]\s+/.test(line) || line === '')
        let number = 1
        return lines.map((line) => {
          if (!line) return line
          if (listed) return line.replace(/^(\s*)\d+[.)]\s+/, '$1')
          return `${number++}. ${line}`
        })
      })
    case 'task-list':
      return transformLines(value, selectionStart, selectionEnd, (lines) => {
        const listed = lines.every((line) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line) || line === '')
        return lines.map((line) => listed ? line.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1') : line ? `- [ ] ${line}` : line)
      })
    case 'code-block': return toggleCodeBlock(value, selectionStart, selectionEnd)
  }
}

export function indentMarkdownLines(value: string, start: number, end: number, outdent = false): MarkdownSelection {
  return transformLines(value, start, end, (lines) => lines.map((line) => {
    if (!outdent) return line ? `  ${line}` : line
    return line.replace(/^(?:\t| {1,2})/, '')
  }))
}

export function markdownShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): MarkdownCommand | 'save' | null {
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return null
  switch (event.key.toLowerCase()) {
    case 'b': return 'bold'
    case 'i': return 'italic'
    case 'k': return 'link'
    case 's': return 'save'
    default: return null
  }
}
