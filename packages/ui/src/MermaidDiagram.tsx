import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { MERMAID_SECURITY_LEVEL } from './mermaidDiagrams'
import { downloadMermaidPng, mermaidExportFilename } from './mermaidExport'

type MermaidDiagramProps = {
  source: string
  title?: string
  downloadName?: string
  exportLabel?: string
}

// Initialize mermaid exactly once. The module may be re-evaluated under HMR;
// re-initializing would reset theme / startOnLoad state mid-session.
if (typeof window !== 'undefined' && !(window as any).__mdMermaidInit) {
  (window as any).__mdMermaidInit = true
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: MERMAID_SECURITY_LEVEL,
    htmlLabels: false,
    theme: 'default',
  })
}

let renderCounter = 0

/** Render mermaid lazily: only when the block scrolls into view, so a
 *  5-diagram note doesn't fire 5 concurrent renders on mount. Cleanup uses
 *  a generation counter to drop stale writes on unmount. */
export function MermaidDiagram({ source, title, downloadName, exportLabel }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendered, setRendered] = useState(false)
  const [exportStatus, setExportStatus] = useState<'idle' | 'working' | 'ok' | 'error'>('idle')
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.replaceChildren()
    setError(null)
    setRendered(false)
    setExportStatus('idle')
    setExportError(null)
    let cancelled = false
    let generation = 0
    const id = `md-mermaid-${renderCounter++}`

    const render = async (gen: number) => {
      const node = containerRef.current
      if (!node) return
      try {
        const { svg } = await mermaid.render(id, source)
        if (cancelled || generation !== gen) return
        node.innerHTML = svg
        setError(null)
        setRendered(true)
      } catch (err) {
        if (cancelled || generation !== gen) return
        setError(err instanceof Error ? err.message : String(err))
        setRendered(false)
      }
    }

    // Lazy render: only kick off when the block scrolls into view. Without
    // IntersectionObserver we render immediately (fallback for SSR / old
    // browsers).
    let io: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        if (cancelled) return
        for (const e of entries) {
          if (e.isIntersecting) {
            io?.disconnect()
            void render(generation)
          }
        }
      }, { rootMargin: '200px' })
      io.observe(container)
    } else {
      void render(generation)
    }

    return () => {
      cancelled = true
      generation += 1
      io?.disconnect()
    }
  }, [source])

  const handleExport = async () => {
    const svg = containerRef.current?.querySelector('svg')
    if (!svg) return
    setExportStatus('working')
    setExportError(null)
    try {
      await downloadMermaidPng(svg, downloadName || mermaidExportFilename(null))
      setExportStatus('ok')
    } catch (exportFailure) {
      setExportError(exportFailure instanceof Error ? exportFailure.message : String(exportFailure))
      setExportStatus('error')
    }
  }

  const exportAriaLabel = exportLabel
    ? `Export ${exportLabel} as PNG`
    : 'Export Mermaid diagram as PNG'

  return (
    <div className="mermaid-diagram">
      {title ? <h4 className="mermaid-diagram-title">{title}</h4> : null}
      <div ref={containerRef} className="mermaid-diagram-canvas" data-role="mermaid-diagram" />
      {rendered ? (
        <div className="mermaid-diagram-actions">
          <button
            type="button"
            className="mermaid-export-button"
            onClick={() => void handleExport()}
            disabled={exportStatus === 'working'}
            aria-label={exportAriaLabel}
          >
            {exportStatus === 'working' ? 'Preparing PNG…' : exportStatus === 'ok' ? 'Export PNG again' : 'Export PNG'}
          </button>
          <span className="mermaid-export-status" aria-live="polite">
            {exportStatus === 'ok' ? 'PNG ready' : ''}
          </span>
        </div>
      ) : null}
      {exportError ? <div className="mermaid-export-error" role="alert">PNG export failed: {exportError}</div> : null}
      {error ? (
        <div className="mermaid-diagram-error" role="alert">
          <strong>Mermaid render failed</strong>
          <pre>{error}</pre>
        </div>
      ) : null}
      {!error && !rendered ? <div className="mermaid-diagram-loading">Rendering diagram…</div> : null}
    </div>
  )
}
