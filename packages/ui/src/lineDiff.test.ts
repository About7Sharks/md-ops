import { describe, expect, it } from 'bun:test'
import { diffLines } from './lineDiff'

describe('diffLines', () => {
  it('reports additions and removals with their source line numbers', () => {
    const result = diffLines('one\ntwo', 'one\nthree\ntwo\nfour')

    expect(result).toMatchObject({ added: 2, removed: 0, unchanged: 2, capped: false })
    expect(result.rows).toEqual([
      { kind: 'unchanged', text: 'one', originalLine: 1, currentLine: 1 },
      { kind: 'added', text: 'three', originalLine: null, currentLine: 2 },
      { kind: 'unchanged', text: 'two', originalLine: 2, currentLine: 3 },
      { kind: 'added', text: 'four', originalLine: null, currentLine: 4 },
    ])
  })

  it('represents a modified line as one removal and one addition', () => {
    const result = diffLines('title\nold body\nfooter', 'title\nnew body\nfooter')

    expect(result).toMatchObject({ added: 1, removed: 1, unchanged: 2, capped: false })
    expect(result.rows.map((row) => [row.kind, row.text])).toEqual([
      ['unchanged', 'title'],
      ['removed', 'old body'],
      ['added', 'new body'],
      ['unchanged', 'footer'],
    ])
  })

  it('handles empty documents', () => {
    expect(diffLines('', '')).toMatchObject({ rows: [], added: 0, removed: 0, unchanged: 0, capped: false })
    expect(diffLines('', 'new')).toMatchObject({ added: 1, removed: 0, unchanged: 0 })
    expect(diffLines('old', '')).toMatchObject({ added: 0, removed: 1, unchanged: 0 })
  })

  it('uses a stable LCS when lines repeat', () => {
    const result = diffLines('repeat\nremove me\nrepeat', 'repeat\nrepeat')

    expect(result).toMatchObject({ added: 0, removed: 1, unchanged: 2, capped: false })
    expect(result.rows.map((row) => row.kind)).toEqual(['unchanged', 'removed', 'unchanged'])
  })

  it('uses a bounded, explicitly marked fallback for pathological inputs', () => {
    const result = diffLines('shared\nold one\nold two\nend', 'shared\nnew one\nnew two\nend', { maxCells: 1 })

    expect(result).toMatchObject({ added: 2, removed: 2, unchanged: 2, capped: true })
    expect(result.rows.map((row) => row.kind)).toEqual([
      'unchanged',
      'removed',
      'removed',
      'added',
      'added',
      'unchanged',
    ])
  })
})
