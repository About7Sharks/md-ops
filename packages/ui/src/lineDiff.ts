export type LineDiffKind = 'added' | 'removed' | 'unchanged'

export type LineDiffRow = {
  kind: LineDiffKind
  text: string
  originalLine: number | null
  currentLine: number | null
}

export type LineDiffResult = {
  rows: LineDiffRow[]
  added: number
  removed: number
  unchanged: number
  /** True when the bounded fallback was used instead of a minimal LCS edit script. */
  capped: boolean
}

export type LineDiffOptions = {
  /**
   * Maximum number of cells in the LCS matrix. The default keeps interaction
   * responsive while still covering ordinary Markdown notes.
   */
  maxCells?: number
}

const DEFAULT_MAX_CELLS = 300_000

function markdownLines(text: string): string[] {
  return text === '' ? [] : text.split('\n')
}

function countRows(rows: LineDiffRow[], capped: boolean): LineDiffResult {
  let added = 0
  let removed = 0
  let unchanged = 0

  for (const row of rows) {
    if (row.kind === 'added') added += 1
    else if (row.kind === 'removed') removed += 1
    else unchanged += 1
  }

  return { rows, added, removed, unchanged, capped }
}

function fallbackDiff(original: string[], current: string[]): LineDiffResult {
  let prefixLength = 0
  const sharedLength = Math.min(original.length, current.length)
  while (prefixLength < sharedLength && original[prefixLength] === current[prefixLength]) {
    prefixLength += 1
  }

  let originalEnd = original.length
  let currentEnd = current.length
  while (
    originalEnd > prefixLength
    && currentEnd > prefixLength
    && original[originalEnd - 1] === current[currentEnd - 1]
  ) {
    originalEnd -= 1
    currentEnd -= 1
  }

  const rows: LineDiffRow[] = []
  for (let index = 0; index < prefixLength; index += 1) {
    rows.push({ kind: 'unchanged', text: original[index], originalLine: index + 1, currentLine: index + 1 })
  }
  for (let index = prefixLength; index < originalEnd; index += 1) {
    rows.push({ kind: 'removed', text: original[index], originalLine: index + 1, currentLine: null })
  }
  for (let index = prefixLength; index < currentEnd; index += 1) {
    rows.push({ kind: 'added', text: current[index], originalLine: null, currentLine: index + 1 })
  }
  for (let originalIndex = originalEnd, currentIndex = currentEnd; originalIndex < original.length; originalIndex += 1, currentIndex += 1) {
    rows.push({
      kind: 'unchanged',
      text: original[originalIndex],
      originalLine: originalIndex + 1,
      currentLine: currentIndex + 1,
    })
  }

  return countRows(rows, true)
}

/**
 * Creates a line-oriented edit script from original Markdown to current
 * Markdown. It uses LCS for a stable, minimal line diff. If the requested
 * input would exceed the matrix cap, it returns a valid non-minimal edit
 * script that preserves shared prefix/suffix lines and marks `capped`.
 */
export function diffLines(originalText: string, currentText: string, options: LineDiffOptions = {}): LineDiffResult {
  const original = markdownLines(originalText)
  const current = markdownLines(currentText)

  if (original.length === 0 && current.length === 0) return countRows([], false)

  const maxCells = options.maxCells ?? DEFAULT_MAX_CELLS
  if (!Number.isSafeInteger(maxCells) || maxCells < 0) {
    throw new Error('maxCells must be a non-negative safe integer')
  }
  if (original.length * current.length > maxCells) return fallbackDiff(original, current)

  const width = current.length + 1
  const directions = new Uint8Array((original.length + 1) * width)
  let previous = new Uint32Array(width)
  let next = new Uint32Array(width)

  // Direction values: 1 = unchanged diagonal, 2 = remove from original,
  // 3 = add from current. Keeping the matrix makes backtracking exact.
  for (let originalIndex = 1; originalIndex <= original.length; originalIndex += 1) {
    for (let currentIndex = 1; currentIndex <= current.length; currentIndex += 1) {
      const directionIndex = originalIndex * width + currentIndex
      if (original[originalIndex - 1] === current[currentIndex - 1]) {
        next[currentIndex] = previous[currentIndex - 1] + 1
        directions[directionIndex] = 1
      } else if (previous[currentIndex] >= next[currentIndex - 1]) {
        next[currentIndex] = previous[currentIndex]
        directions[directionIndex] = 2
      } else {
        next[currentIndex] = next[currentIndex - 1]
        directions[directionIndex] = 3
      }
    }
    const completed = previous
    previous = next
    next = completed
    next.fill(0)
  }

  const rows: LineDiffRow[] = []
  let originalIndex = original.length
  let currentIndex = current.length
  while (originalIndex > 0 || currentIndex > 0) {
    const direction = originalIndex > 0 && currentIndex > 0
      ? directions[originalIndex * width + currentIndex]
      : 0

    if (direction === 1) {
      rows.push({
        kind: 'unchanged',
        text: original[originalIndex - 1],
        originalLine: originalIndex,
        currentLine: currentIndex,
      })
      originalIndex -= 1
      currentIndex -= 1
    } else if (originalIndex > 0 && (currentIndex === 0 || direction === 2)) {
      rows.push({ kind: 'removed', text: original[originalIndex - 1], originalLine: originalIndex, currentLine: null })
      originalIndex -= 1
    } else {
      rows.push({ kind: 'added', text: current[currentIndex - 1], originalLine: null, currentLine: currentIndex })
      currentIndex -= 1
    }
  }

  rows.reverse()
  // Backtracking reverses a tied add/remove boundary. Both orders are valid
  // edit scripts, but removal followed by addition is the readable convention
  // for a changed line in a review dialog.
  for (let index = 0; index + 1 < rows.length; index += 1) {
    if (rows[index].kind === 'added' && rows[index + 1].kind === 'removed') {
      const added = rows[index]
      rows[index] = rows[index + 1]
      rows[index + 1] = added
      index += 1
    }
  }
  return countRows(rows, false)
}

export const lineDiff = diffLines
