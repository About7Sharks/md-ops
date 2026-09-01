import { describe, expect, it } from 'bun:test'
import { applyMarkdownCommand, indentMarkdownLines, markdownShortcut } from './markdownCommands'

describe('Markdown formatting commands', () => {
  it('wraps selected inline text and keeps the text selected', () => {
    expect(applyMarkdownCommand('bold', 'hello world', 6, 11)).toEqual({ value: 'hello **world**', selectionStart: 8, selectionEnd: 13 })
  })

  it('toggles collapsed inline markers and restores the caret', () => {
    expect(applyMarkdownCommand('italic', 'hello', 5, 5)).toEqual({ value: 'hello**', selectionStart: 6, selectionEnd: 6 })
    expect(applyMarkdownCommand('italic', 'hello**', 6, 6)).toEqual({ value: 'hello', selectionStart: 5, selectionEnd: 5 })
  })

  it('adds and removes selected line prefixes', () => {
    const listed = applyMarkdownCommand('bulleted-list', 'one\ntwo', 0, 7)
    expect(listed).toEqual({ value: '- one\n- two', selectionStart: 2, selectionEnd: 11 })
    expect(applyMarkdownCommand('bulleted-list', listed.value, listed.selectionStart, listed.selectionEnd).value).toBe('one\ntwo')
  })

  it('creates link placeholders with a selection inside the link label', () => {
    expect(applyMarkdownCommand('link', 'read', 4, 4)).toEqual({ value: 'read[](url)', selectionStart: 5, selectionEnd: 5 })
  })

  it('wraps selected text in a fenced code block and preserves the selected body', () => {
    expect(applyMarkdownCommand('code-block', 'const x = 1', 0, 11)).toEqual({ value: '```\nconst x = 1\n```', selectionStart: 4, selectionEnd: 15 })
  })
})

describe('Markdown line indentation', () => {
  it('indents and outdents selected lines while returning restored selection offsets', () => {
    const indented = indentMarkdownLines('one\ntwo', 0, 7)
    expect(indented).toEqual({ value: '  one\n  two', selectionStart: 2, selectionEnd: 11 })
    expect(indentMarkdownLines(indented.value, indented.selectionStart, indented.selectionEnd, true)).toEqual({ value: 'one\ntwo', selectionStart: 0, selectionEnd: 7 })
  })
})

describe('Markdown keyboard shortcut mapping', () => {
  it('maps Mod shortcuts without accepting Alt-modified keys', () => {
    expect(markdownShortcut({ key: 'b', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent)).toBe('bold')
    expect(markdownShortcut({ key: 's', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false } as KeyboardEvent)).toBe('save')
    expect(markdownShortcut({ key: 'k', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false } as KeyboardEvent)).toBeNull()
  })
})
