import { describe, expect, it } from 'bun:test'
import { buildNoteTemplate, noteTemplates, slugifyNoteTitle, suggestedMarkdownFileName, syncMarkdownFileName } from './noteTemplates'

describe('note templates', () => {
  const date = '2026-08-01'

  it('has every available template exactly once', () => {
    expect(noteTemplates.map((template) => template.id)).toEqual(['blank', 'note', 'meeting', 'daily', 'decision', 'project'])
  })

  it('builds deterministic Markdown for every template', () => {
    const expected: Record<(typeof noteTemplates)[number]['id'], string> = {
      blank: '',
      note: '# Release plan\n\n## Notes\n\n',
      meeting: '# Release plan\n\n**Date:** 2026-08-01\n\n## Attendees\n\n- \n\n## Agenda\n\n1. \n\n## Notes\n\n## Decisions\n\n## Action items\n\n- [ ] \n',
      daily: '# Release plan\n\n**Date:** 2026-08-01\n\n## Focus\n\n- [ ] \n\n## Notes\n\n## Wins\n\n## Tomorrow\n\n',
      decision: '# Release plan\n\n**Date:** 2026-08-01\n\n## Decision\n\n\n## Context\n\n\n## Options considered\n\n1. \n\n## Consequences\n\n\n',
      project: '# Release plan\n\n**Started:** 2026-08-01\n\n## Goal\n\n\n## Scope\n\n- \n\n## Milestones\n\n- [ ] \n\n## Risks\n\n- \n\n## Notes\n\n',
    }

    for (const template of noteTemplates) {
      expect(buildNoteTemplate(template.id, 'Release plan', date)).toBe(expected[template.id])
    }
  })

  it('uses supplied dates and never reads filesystem or user data', () => {
    expect(buildNoteTemplate('daily', '', '1999-12-31')).toContain('Daily note — 1999-12-31')
    expect(buildNoteTemplate('meeting', 'Standup', '2030-02-03')).toContain('**Date:** 2030-02-03')
  })
})

describe('note filename helpers', () => {
  it('creates safe, readable Markdown names', () => {
    expect(slugifyNoteTitle('  Q3: Design & Delivery! ')).toBe('q3-design-delivery')
    expect(suggestedMarkdownFileName('  Q3: Design & Delivery! ')).toBe('q3-design-delivery.md')
  })

  it('supplies a stable fallback for an empty title', () => {
    expect(suggestedMarkdownFileName('')).toBe('untitled-note.md')
  })

  it('syncs from the title only until the filename is edited manually', () => {
    expect(syncMarkdownFileName('Planning', 'untitled-note.md', false)).toBe('planning.md')
    expect(syncMarkdownFileName('Renamed title', 'project-brief.md', true)).toBe('project-brief.md')
  })
})
