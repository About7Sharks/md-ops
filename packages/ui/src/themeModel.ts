/* Theme + reading settings model. Pure logic; App wires it to the DOM. */

export type ThemeId = 'slate-rose' | 'github-quiet' | 'deep-sea' | 'warm-ink' | 'paper-night'
export type ReadingWidth = 'comfort' | 'wide' | 'full'
export type ReadingSize = 'compact' | 'default' | 'large'

export type UiSettings = {
  theme: ThemeId
  readingWidth: ReadingWidth
  readingSize: ReadingSize
}

export type ThemeMeta = {
  id: ThemeId
  label: string
  /** Swatch dots for the picker: background, surface, accent. */
  swatch: [string, string, string]
}

export const THEMES: ThemeMeta[] = [
  { id: 'slate-rose',   label: 'Slate & Rose', swatch: ['#14151a', '#1b1d24', '#d187a0'] },
  { id: 'deep-sea',     label: 'Deep Sea',     swatch: ['#0b0f14', '#11161d', '#45c7a8'] },
  { id: 'github-quiet', label: 'GitHub Quiet', swatch: ['#0d1117', '#161b22', '#2ea88a'] },
  { id: 'warm-ink',     label: 'Warm Ink',     swatch: ['#191614', '#211d1a', '#d98e4a'] },
  { id: 'paper-night',  label: 'Paper Night',  swatch: ['#101010', '#171717', '#c9a227'] },
]

export const READING_WIDTHS: { id: ReadingWidth; label: string; value: string }[] = [
  { id: 'comfort', label: 'Comfort', value: '72ch' },
  { id: 'wide',    label: 'Wide',    value: '960px' },
  { id: 'full',    label: 'Full',    value: '100%' },
]

export const READING_SIZES: { id: ReadingSize; label: string; value: string }[] = [
  { id: 'compact', label: 'Compact', value: '15px' },
  { id: 'default', label: 'Default', value: '16.5px' },
  { id: 'large',   label: 'Large',   value: '18.5px' },
]

export const DEFAULT_SETTINGS: UiSettings = {
  theme: 'slate-rose',
  readingWidth: 'comfort',
  readingSize: 'default',
}

const STORAGE_KEY = 'mdops.uiSe…s.v1'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value)
}

export function parseUiSettings(raw: string | null): UiSettings {
  if (!raw) return DEFAULT_SETTINGS
  try {
    const data = JSON.parse(raw) as Partial<UiSettings>
    return {
      theme: isThemeId(data.theme) ? data.theme : DEFAULT_SETTINGS.theme,
      readingWidth: READING_WIDTHS.some((w) => w.id === data.readingWidth) ? data.readingWidth! : DEFAULT_SETTINGS.readingWidth,
      readingSize: READING_SIZES.some((s) => s.id === data.readingSize) ? data.readingSize! : DEFAULT_SETTINGS.readingSize,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function loadUiSettings(storage: Storage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined): UiSettings {
  if (!storage) return DEFAULT_SETTINGS
  try {
    return parseUiSettings(storage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveUiSettings(settings: UiSettings, storage: Storage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* storage unavailable (private mode) — settings stay session-only */
  }
}

/** Apply settings to the live document: theme attribute + reading CSS variables. */
export function applyUiSettings(settings: UiSettings, doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): void {
  if (!doc) return
  doc.documentElement.dataset.theme = settings.theme
  const width = READING_WIDTHS.find((w) => w.id === settings.readingWidth)?.value ?? READING_WIDTHS[1].value
  const size = READING_SIZES.find((s) => s.id === settings.readingSize)?.value ?? READING_SIZES[1].value
  doc.documentElement.style.setProperty('--read-max-width', width)
  doc.documentElement.style.setProperty('--read-font-size', size)
}
