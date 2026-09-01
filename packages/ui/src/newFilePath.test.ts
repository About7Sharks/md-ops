import { describe, expect, it } from 'bun:test'
import { buildNewMarkdownPath, normalizeFolderPath, normalizeMarkdownFileName } from './newFilePath'

describe('normalizeFolderPath', () => {
  it('cleans relative folder input', () => {
    expect(normalizeFolderPath(' Projects / Notes/ ')).toBe('Projects/Notes')
    expect(normalizeFolderPath('')).toBe('')
  })

  it('rejects traversal and absolute folders', () => {
    expect(() => normalizeFolderPath('/etc')).toThrow('relative')
    expect(() => normalizeFolderPath('Projects/../Secrets')).toThrow('Folder cannot contain')
  })
})

describe('normalizeMarkdownFileName', () => {
  it('adds .md when the user types a bare note name', () => {
    expect(normalizeMarkdownFileName('New Note')).toBe('New Note.md')
    expect(normalizeMarkdownFileName('diagram.mermaid')).toBe('diagram.mermaid')
  })

  it('keeps directories out of the file name field', () => {
    expect(() => normalizeMarkdownFileName('Projects/New.md')).toThrow('folder')
  })
})

describe('buildNewMarkdownPath', () => {
  it('combines selected folder and note name', () => {
    expect(buildNewMarkdownPath('Projects/AI', 'Launch')).toBe('Projects/AI/Launch.md')
  })
})
