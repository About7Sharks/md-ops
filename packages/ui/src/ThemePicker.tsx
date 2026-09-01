import { useEffect, useRef } from 'react'
import type { ReadingSize, ReadingWidth, UiSettings } from './themeModel'
import { READING_SIZES, READING_WIDTHS, THEMES } from './themeModel'
import './themePicker.css'

type ThemePickerProps = {
  settings: UiSettings
  onChange: (next: UiSettings) => void
  onClose: () => void
}

export default function ThemePicker({ settings, onChange, onClose }: ThemePickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown) }
  }, [onClose])

  return (
    <div className="theme-picker" ref={rootRef} role="dialog" aria-label="Appearance settings">
      <div className="theme-picker-section">
        <div className="theme-picker-label">Theme</div>
        <div className="theme-picker-grid" role="radiogroup" aria-label="Color theme">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={settings.theme === theme.id}
              className={`theme-card ${settings.theme === theme.id ? 'active' : ''}`}
              onClick={() => onChange({ ...settings, theme: theme.id })}
            >
              <span className="theme-card-swatch" aria-hidden="true">
                <span style={{ background: theme.swatch[0] }} />
                <span style={{ background: theme.swatch[1] }} />
                <span className="theme-card-accent" style={{ background: theme.swatch[2] }} />
              </span>
              <span className="theme-card-label">{theme.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="theme-picker-section">
        <div className="theme-picker-label">Reading width</div>
        <div className="theme-segmented" role="radiogroup" aria-label="Reading width">
          {READING_WIDTHS.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={settings.readingWidth === w.id}
              className={settings.readingWidth === w.id ? 'active' : ''}
              onClick={() => onChange({ ...settings, readingWidth: w.id as ReadingWidth })}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-picker-section">
        <div className="theme-picker-label">Reading size</div>
        <div className="theme-segmented" role="radiogroup" aria-label="Reading size">
          {READING_SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={settings.readingSize === s.id}
              className={settings.readingSize === s.id ? 'active' : ''}
              onClick={() => onChange({ ...settings, readingSize: s.id as ReadingSize })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-picker-foot">Saved in this browser. Applies everywhere MD Ops opens.</div>
    </div>
  )
}
