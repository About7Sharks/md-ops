import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const editor = readFileSync(new URL('./RichMarkdownEditor.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./richMarkdownEditor.css', import.meta.url), 'utf8')

function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1])
    .join('\n')
}

describe('rich markdown editor toolbar', () => {
  it('keeps every formatting command behind a compact primary row and explicit disclosure', () => {
    const commands = [...editor.matchAll(/\{ command: '([^']+)', label:/g)].map((match) => match[1])
    expect(commands).toEqual([
      'heading',
      'bold',
      'italic',
      'link',
      'inline-code',
      'quote',
      'bulleted-list',
      'numbered-list',
      'task-list',
      'code-block',
    ])
    expect(editor).toContain('const primaryToolbar = toolbar.slice(0, 4)')
    expect(editor).toContain('const moreToolbar = toolbar.slice(4)')
    expect(editor).toContain('aria-expanded={moreOpen}')
    expect(editor).toContain('aria-controls={moreControlsId}')
    expect(editor).toContain('aria-label="More formatting options"')
    expect(editor).not.toContain('rich-markdown-editor__format-jump')

    const toolbarDeclarations = declarationsFor('.rich-markdown-editor__toolbar')
    expect(toolbarDeclarations).toContain('flex-wrap: wrap')
    expect(toolbarDeclarations).not.toContain('overflow-x: auto')
    const moreDeclarations = declarationsFor('.rich-markdown-editor__more-controls')
    expect(moreDeclarations).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(moreDeclarations).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(declarationsFor('.rich-markdown-editor')).toContain('container-type: inline-size')
    expect(css).toContain('@container (max-width: 420px)')
    const touchLayout = css.slice(css.indexOf('@media (max-width: 900px)'))
    expect(touchLayout).toContain('.rich-markdown-editor__action { min-height: 44px; }')
    expect(touchLayout).toContain('.rich-markdown-editor__format { min-height: 44px; }')
  })

  it('uses roving focus and conventional horizontal-toolbar navigation', () => {
    expect(editor).toContain('role="toolbar"')
    expect(editor).toContain('aria-orientation="horizontal"')
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(editor).toContain(`'${key}'`)
    }
    expect(editor).toContain('button:not(:disabled)')
    expect(editor).toContain('buttons[nextIndex]?.focus()')
    expect(editor).toContain("event.key === 'Escape' && moreOpen")
  })
})

describe('rich markdown editor status', () => {
  it('stays on one concise line and gives long save states the ellipsis slot', () => {
    const statusDeclarations = declarationsFor('.rich-markdown-editor__status')
    expect(statusDeclarations).toContain('flex-wrap: nowrap')
    expect(statusDeclarations).toContain('white-space: nowrap')
    const stateDeclarations = declarationsFor('.rich-markdown-editor__status > .rich-markdown-editor__status-state')
    expect(stateDeclarations).toContain('min-width: 0')
    expect(stateDeclarations).toContain('text-overflow: ellipsis')
    expect(editor).toContain('Ln {context.line}, Col {context.column}')
    expect(editor).toContain('{value.length} chars')
  })
})
