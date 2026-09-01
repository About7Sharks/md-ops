import { describe, expect, it } from 'bun:test'
import { extractMermaidBlocks, hasMermaidBlocks, MERMAID_SECURITY_LEVEL } from './mermaidDiagrams'

describe('Mermaid security boundary', () => {
  it('treats diagram source as untrusted content', () => {
    expect(MERMAID_SECURITY_LEVEL).toBe('strict')
  })
})

describe('extractMermaidBlocks', () => {
  it('returns an empty array for a body with no mermaid blocks', () => {
    expect(extractMermaidBlocks('plain text\n\n```js\nconst x = 1\n```\n')).toEqual([])
  })

  it('extracts a single backtick mermaid block', () => {
    const blocks = extractMermaidBlocks('heading\n\n```mermaid\nflowchart TD\n    A --> B\n```\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].source).toBe('flowchart TD\n    A --> B')
    expect(blocks[0].startLine).toBe(3)
  })

  it('extracts multiple mermaid blocks in document order', () => {
    const body = [
      '```mermaid',
      'graph LR',
      '    a --> b',
      '```',
      '',
      'text between',
      '',
      '```mermaid',
      'sequenceDiagram',
      '    A->>B: hi',
      '```',
    ].join('\n')
    const blocks = extractMermaidBlocks(body)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].source).toBe('graph LR\n    a --> b')
    expect(blocks[1].source).toBe('sequenceDiagram\n    A->>B: hi')
    expect(blocks[1].startLine).toBe(8)
  })

  it('ignores code blocks with other info strings', () => {
    const body = [
      '```js',
      'const x = 1',
      '```',
      '```mermaid',
      'pie title Pets',
      '    "Dogs" : 386',
      '```',
    ].join('\n')
    const blocks = extractMermaidBlocks(body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].source).toContain('pie title Pets')
  })

  it('supports tilde fences', () => {
    const blocks = extractMermaidBlocks('~~~mermaid\nclassDiagram\n    Animal <|-- Duck\n~~~\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].fence.startsWith('~')).toBe(true)
    expect(blocks[0].source).toBe('classDiagram\n    Animal <|-- Duck')
  })

  it('accepts an info string with trailing attributes', () => {
    const blocks = extractMermaidBlocks('```mermaid {maxWidth: 500}\ngraph TD\n    A --> B\n```\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].source).toBe('graph TD\n    A --> B')
  })

  it('does not close a ``` block on a shorter fence run (inline code inside a diagram)', () => {
    const body = ['```mermaid', 'flowchart TD', '    A["use `tick` value"] --> B', '```'].join('\n')
    const blocks = extractMermaidBlocks(body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].source).toBe('flowchart TD\n    A["use `tick` value"] --> B')
  })

  it('treats an unclosed fence as spanning the rest of the body', () => {
    const blocks = extractMermaidBlocks('```mermaid\ngraph TD\n    A --> B\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].source).toContain('A --> B')
  })
})

describe('hasMermaidBlocks', () => {
  it('reports false for bodies without mermaid and true for those with it', () => {
    expect(hasMermaidBlocks('just text')).toBe(false)
    expect(hasMermaidBlocks('```mermaid\ngraph TD\n    A --> B\n```')).toBe(true)
  })
})
