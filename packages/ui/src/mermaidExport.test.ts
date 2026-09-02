import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  fitPngDimensions,
  mermaidExportFilename,
  resolveSvgDimensions,
  svgMarkupToDataUrl,
} from './mermaidExport'

const component = readFileSync(new URL('./MermaidDiagram.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

describe('Mermaid PNG export UI', () => {
  it('offers the action only for a completed render and reports export failures', () => {
    expect(component).toContain("{rendered ? (")
    expect(component).toContain("'Export PNG'")
    expect(component).toContain('await downloadMermaidPng')
    expect(component).toContain('PNG export failed:')
  })

  it('disables HTML labels so SVG rasterization does not taint the canvas', () => {
    expect(component).toContain('securityLevel: MERMAID_SECURITY_LEVEL')
    expect(component).toContain('htmlLabels: false')
  })

  it('gives repeated export actions diagram-specific accessible names', () => {
    expect(component).toContain('aria-label={exportAriaLabel}')
    expect(app).toContain('`Mermaid diagram at line ${sourceLine}`')
    expect(app).toContain('exportLabel={`Diagram ${index + 1} at line ${block.startLine}`}')
  })

  it('removes stale SVG and export state before rendering changed source', () => {
    expect(component).toContain('container.replaceChildren()')
    expect(component).toContain('setRendered(false)')
    expect(component).toContain("setExportStatus('idle')")
    expect(component).toContain('setExportError(null)')
  })
})

describe('svgMarkupToDataUrl', () => {
  it('encodes SVG markup into a WebKit-safe data URL', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg"><text fill="#123">A & B</text></svg>'
    const url = svgMarkupToDataUrl(markup)
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(url).not.toContain('#123')
    expect(decodeURIComponent(url.split(',')[1])).toBe(markup)
  })
})

describe('mermaidExportFilename', () => {
  it('uses the note name and source line to keep multiple exports distinct', () => {
    expect(mermaidExportFilename('Systems/Service Map.md', 42)).toBe('service-map-line-42.png')
  })

  it('removes Mermaid and Markdown extensions and unsafe filename characters', () => {
    expect(mermaidExportFilename('Plans/Q3: Launch?.mermaid')).toBe('q3-launch.png')
  })

  it('falls back to a stable generic name', () => {
    expect(mermaidExportFilename(null)).toBe('mermaid-diagram.png')
  })
})

describe('resolveSvgDimensions', () => {
  it('prefers the SVG viewBox so responsive diagrams retain their intrinsic aspect ratio', () => {
    expect(resolveSvgDimensions({ viewBox: '0 0 640 320', width: '100%', height: null })).toEqual({
      width: 640,
      height: 320,
    })
  })

  it('uses numeric dimensions when no valid viewBox is available', () => {
    expect(resolveSvgDimensions({ viewBox: null, width: '480', height: '240px' })).toEqual({
      width: 480,
      height: 240,
    })
  })

  it('falls back to rendered dimensions and rejects an empty diagram', () => {
    expect(resolveSvgDimensions({ viewBox: 'bad', width: '100%', height: 'auto', renderedWidth: 300, renderedHeight: 150 })).toEqual({
      width: 300,
      height: 150,
    })
    expect(() => resolveSvgDimensions({ viewBox: null, width: null, height: null, renderedWidth: 0, renderedHeight: 0 })).toThrow(
      'Diagram has no exportable size',
    )
  })
})

describe('fitPngDimensions', () => {
  it('exports ordinary diagrams at 2x resolution', () => {
    expect(fitPngDimensions(600, 300)).toEqual({ width: 1200, height: 600, scale: 2 })
  })

  it('preserves aspect ratio while bounding very large canvases', () => {
    const fitted = fitPngDimensions(10_000, 5_000)
    expect(fitted.width).toBeLessThanOrEqual(4_096)
    expect(fitted.height).toBeLessThanOrEqual(4_096)
    expect(fitted.width / fitted.height).toBe(2)
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(16_777_216)
  })

  it('keeps a 4096-square source inside iOS canvas limits', () => {
    expect(fitPngDimensions(4_096, 4_096)).toEqual({ width: 4_096, height: 4_096, scale: 1 })
  })
})
