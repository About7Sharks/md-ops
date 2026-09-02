const DEFAULT_SCALE = 2
// Conservative limits that also fit iOS/WebKit canvas implementations.
const MAX_CANVAS_SIDE = 4_096
const MAX_CANVAS_PIXELS = 16_777_216

export type SvgDimensionInput = {
  viewBox: string | null
  width: string | null
  height: string | null
  renderedWidth?: number
  renderedHeight?: number
}

export type PngDimensions = {
  width: number
  height: number
  scale: number
}

function positiveNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function numericSvgLength(value: string | null): number | null {
  if (!value) return null
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i)
  return match ? positiveNumber(match[1]) : null
}

export function resolveSvgDimensions(input: SvgDimensionInput): { width: number; height: number } {
  if (input.viewBox) {
    const values = input.viewBox.trim().split(/[\s,]+/).map(Number)
    if (values.length === 4) {
      const width = positiveNumber(values[2])
      const height = positiveNumber(values[3])
      if (width && height) return { width, height }
    }
  }

  const attributeWidth = numericSvgLength(input.width)
  const attributeHeight = numericSvgLength(input.height)
  if (attributeWidth && attributeHeight) {
    return { width: attributeWidth, height: attributeHeight }
  }

  const renderedWidth = positiveNumber(input.renderedWidth)
  const renderedHeight = positiveNumber(input.renderedHeight)
  if (renderedWidth && renderedHeight) {
    return { width: renderedWidth, height: renderedHeight }
  }

  throw new Error('Diagram has no exportable size')
}

export function fitPngDimensions(
  sourceWidth: number,
  sourceHeight: number,
  preferredScale = DEFAULT_SCALE,
): PngDimensions {
  const width = positiveNumber(sourceWidth)
  const height = positiveNumber(sourceHeight)
  const requestedScale = positiveNumber(preferredScale)
  if (!width || !height || !requestedScale) throw new Error('Diagram has no exportable size')

  const scale = Math.min(
    requestedScale,
    MAX_CANVAS_SIDE / width,
    MAX_CANVAS_SIDE / height,
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
  )

  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  }
}

export function mermaidExportFilename(notePath: string | null | undefined, sourceLine?: number): string {
  const rawName = notePath?.split(/[\\/]/).pop()?.replace(/\.(?:md|mmd|mermaid)$/i, '') || 'mermaid-diagram'
  const stem = rawName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 72)
    .replace(/-+$/g, '') || 'mermaid-diagram'
  const lineSuffix = Number.isInteger(sourceLine) && Number(sourceLine) > 0 ? `-line-${sourceLine}` : ''
  return `${stem}${lineSuffix}.png`
}

export function svgMarkupToDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Browser could not rasterize the Mermaid diagram'))
    image.src = url
  })
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Browser could not create a PNG image'))
    }, 'image/png')
  })
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.hidden = true
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // Let the browser consume the click before releasing the object URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export async function downloadMermaidPng(
  svg: SVGSVGElement,
  filename: string,
): Promise<PngDimensions> {
  const bounds = svg.getBoundingClientRect()
  const source = resolveSvgDimensions({
    viewBox: svg.getAttribute('viewBox'),
    width: svg.getAttribute('width'),
    height: svg.getAttribute('height'),
    renderedWidth: bounds.width,
    renderedHeight: bounds.height,
  })
  const output = fitPngDimensions(source.width, source.height)

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(source.width))
  clone.setAttribute('height', String(source.height))
  clone.style.maxWidth = 'none'
  clone.style.width = `${source.width}px`
  clone.style.height = `${source.height}px`

  // An encoded data URL avoids WebKit's Blob-backed SVG canvas taint path.
  const image = await loadSvgImage(svgMarkupToDataUrl(new XMLSerializer().serializeToString(clone)))
  const canvas = document.createElement('canvas')
  canvas.width = output.width
  canvas.height = output.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Browser does not support PNG export')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, output.width, output.height)
  context.drawImage(image, 0, 0, output.width, output.height)
  downloadBlob(await canvasToPng(canvas), filename)
  return output
}
