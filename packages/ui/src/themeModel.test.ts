import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, THEMES, applyUiSettings, isThemeId, parseUiSettings } from './themeModel'

describe('parseUiSettings', () => {
  test('null falls back to defaults', () => {
    expect(parseUiSettings(null)).toEqual(DEFAULT_SETTINGS)
  })
  test('valid payload round-trips', () => {
    const raw = JSON.stringify({ theme: 'deep-sea', readingWidth: 'wide', readingSize: 'large' })
    expect(parseUiSettings(raw)).toEqual({ theme: 'deep-sea', readingWidth: 'wide', readingSize: 'large' })
  })
  test('unknown theme or junk falls back per-field', () => {
    const parsed = parseUiSettings(JSON.stringify({ theme: 'neon', readingWidth: 'wide' }))
    expect(parsed.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(parsed.readingWidth).toBe('wide')
    expect(parseUiSettings('{broken json').theme).toBe(DEFAULT_SETTINGS.theme)
  })
  test('isThemeId accepts every declared preset', () => {
    for (const theme of THEMES) expect(isThemeId(theme.id)).toBe(true)
    expect(isThemeId('light')).toBe(false)
  })
})

describe('applyUiSettings', () => {
  test('sets data-theme and reading vars on the document element', () => {
    const calls: Array<[string, string]> = []
    const fakeDoc = {
      documentElement: {
        dataset: {} as Record<string, string>,
        style: { setProperty: (k: string, v: string) => calls.push([k, v]) },
      },
    } as unknown as Document
    applyUiSettings({ theme: 'warm-ink', readingWidth: 'full', readingSize: 'compact' }, fakeDoc)
    expect(fakeDoc.documentElement.dataset.theme).toBe('warm-ink')
    expect(calls).toEqual([['--read-max-width', '100%'], ['--read-font-size', '15px']])
  })
})
