import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { extractMermaidBlocks } from './mermaidDiagrams'

const panel = readFileSync(new URL('./DiagramsPanel.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

describe('DiagramsPanel contracts', () => {
  it('fetches diagrams from the API for the active root', () => {
    expect(panel).toContain("'/api/diagrams?root='")
  })

  it('opens a note through the provided handler', () => {
    expect(panel).toContain('onOpenNote')
    expect(panel).toContain('onOpenNote(file.path)')
  })

  it('groups blocks by file with an expandable summary', () => {
    expect(panel).toContain('diagram-file-summary')
    expect(panel).toContain('diagram-file-blocks')
  })

  it('renders mermaid blocks inline in the note preview with a distinct PNG export name', () => {
    expect(app).toContain("className?.includes('language-mermaid')")
    expect(app).toContain('<MermaidDiagram')
    expect(app).toContain('downloadName={mermaidExportFilename(selectedRelPath, sourceLine)}')
    expect(app).toContain('exportLabel={`Diagram ${index + 1} at line ${block.startLine}`}')
  })

  it('extracts the same blocks the diagrams view uses', () => {
    const md = '# T\n\n```mermaid\nflowchart TD\n  A-->B\n```\n'
    expect(extractMermaidBlocks(md)).toHaveLength(1)
  })
})
