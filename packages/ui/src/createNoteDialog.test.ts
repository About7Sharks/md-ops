import { describe, expect, it } from 'bun:test'
import { validateCreateNoteDraft } from './CreateNoteDialog'

describe('create-note source contract', () => {
  it('validates a relative Markdown path through the shared path helper', () => {
    expect(validateCreateNoteDraft({ rootId: 'personal', folder: 'Projects / Launch', name: 'Brief' }, [])).toBeNull()
    expect(validateCreateNoteDraft({ rootId: 'personal', folder: '../private', name: 'Brief' }, [])).toContain('Folder cannot contain')
  })

  it('rejects exact existing paths with or without their root prefix', () => {
    const draft = { rootId: 'personal', folder: 'Projects', name: 'Brief' }
    expect(validateCreateNoteDraft(draft, ['Projects/Brief.md'])).toContain('already exists')
    expect(validateCreateNoteDraft(draft, ['personal/Projects/Brief.md'])).toContain('already exists')
  })
})

describe('create-note dialog accessibility contract', () => {
  it('keeps template choices as pressed buttons inside a labelled group', async () => {
    const source = await Bun.file(new URL('./CreateNoteDialog.tsx', import.meta.url)).text()

    expect(source).toContain('role="group" aria-labelledby="create-note-template-label"')
    expect(source).toContain('aria-pressed={draft.template === template.id}')
    expect(source).not.toContain('role="listitem"')
  })

  it('themes the body editor directly instead of depending on label ancestry', async () => {
    const styles = await Bun.file(new URL('./createNoteDialog.css', import.meta.url)).text()

    expect(styles).toMatch(/\.create-note-editor-grid textarea\s*\{[^}]*background:\s*var\(--bg-deep\);[^}]*color:\s*var\(--text\);/s)
  })
})
