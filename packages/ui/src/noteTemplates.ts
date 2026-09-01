export const noteTemplateIds = ['blank', 'note', 'meeting', 'daily', 'decision', 'project'] as const

export type NoteTemplateId = (typeof noteTemplateIds)[number]

export type NoteTemplate = {
  id: NoteTemplateId
  label: string
  description: string
}

export const noteTemplates: readonly NoteTemplate[] = [
  { id: 'blank', label: 'Blank', description: 'Start with an empty page.' },
  { id: 'note', label: 'Note', description: 'A focused, general-purpose note.' },
  { id: 'meeting', label: 'Meeting', description: 'Agenda, notes, and follow-ups.' },
  { id: 'daily', label: 'Daily', description: 'A lightweight daily record.' },
  { id: 'decision', label: 'Decision', description: 'Capture context and the call.' },
  { id: 'project', label: 'Project', description: 'Frame goals, milestones, and risks.' },
] as const

function heading(title: string, fallback: string): string {
  return title.trim() || fallback
}

/**
 * Returns deterministic Markdown for a template. Callers supply the date so
 * previews and tests do not depend on the system clock.
 */
export function buildNoteTemplate(template: NoteTemplateId, title: string, date: string): string {
  switch (template) {
    case 'blank':
      return ''
    case 'note':
      return `# ${heading(title, 'Untitled note')}\n\n## Notes\n\n`
    case 'meeting':
      return `# ${heading(title, 'Meeting notes')}\n\n**Date:** ${date}\n\n## Attendees\n\n- \n\n## Agenda\n\n1. \n\n## Notes\n\n## Decisions\n\n## Action items\n\n- [ ] \n`
    case 'daily':
      return `# ${heading(title, `Daily note — ${date}`)}\n\n**Date:** ${date}\n\n## Focus\n\n- [ ] \n\n## Notes\n\n## Wins\n\n## Tomorrow\n\n`
    case 'decision':
      return `# ${heading(title, 'Decision')}\n\n**Date:** ${date}\n\n## Decision\n\n\n## Context\n\n\n## Options considered\n\n1. \n\n## Consequences\n\n\n`
    case 'project':
      return `# ${heading(title, 'Project')}\n\n**Started:** ${date}\n\n## Goal\n\n\n## Scope\n\n- \n\n## Milestones\n\n- [ ] \n\n## Risks\n\n- \n\n## Notes\n\n`
  }
}

export function slugifyNoteTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled-note'
}

export function suggestedMarkdownFileName(title: string): string {
  return `${slugifyNoteTitle(title)}.md`
}

/** Keeps a user-entered filename intact while the title continues to change. */
export function syncMarkdownFileName(title: string, currentName: string, manuallyEdited: boolean): string {
  return manuallyEdited ? currentName : suggestedMarkdownFileName(title)
}
