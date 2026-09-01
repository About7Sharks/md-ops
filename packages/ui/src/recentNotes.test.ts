import { describe, expect, it } from 'bun:test'
import {
  MAX_RECENT_NOTES,
  boundRecentNotes,
  currentRootRecentNotes,
  loadRecentNotes,
  recordRecentNote,
} from './recentNotes'

function memoryStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
    read: () => value,
  }
}

describe('recent notes', () => {
  it('deduplicates by root and path, keeps the newest timestamp, and bounds the list', () => {
    const notes = Array.from({ length: MAX_RECENT_NOTES + 2 }, (_, index) => ({
      rootId: 'vault', path: `notes/${index}.md`, openedAt: index + 1,
    }))
    notes.push({ rootId: 'vault', path: 'notes/3.md', openedAt: 99 })

    const bounded = boundRecentNotes(notes)

    expect(bounded).toHaveLength(MAX_RECENT_NOTES)
    expect(bounded[0]).toEqual({ rootId: 'vault', path: 'notes/3.md', openedAt: 99 })
    expect(bounded.filter((note) => note.path === 'notes/3.md')).toHaveLength(1)
  })

  it('defensively ignores invalid or malformed persisted data', () => {
    const invalid = memoryStorage('{not json')
    expect(loadRecentNotes(invalid)).toEqual([])

    const mixed = memoryStorage(JSON.stringify([
      { rootId: 'vault', path: 'valid.md', openedAt: 10 },
      { rootId: 'vault', path: '../outside.md', openedAt: 11 },
      { rootId: '', path: 'missing-root.md', openedAt: 12 },
    ]))
    expect(loadRecentNotes(mixed)).toEqual([{ rootId: 'vault', path: 'valid.md', openedAt: 10 }])
  })

  it('persists only normalized metadata and moves an opened note to the front', () => {
    const storage = memoryStorage()
    recordRecentNote({ rootId: 'vault', path: 'older.md', openedAt: 10 }, storage)
    const result = recordRecentNote({ rootId: 'vault', path: 'older.md', openedAt: 20 }, storage)

    expect(result).toEqual([{ rootId: 'vault', path: 'older.md', openedAt: 20 }])
    const persisted = JSON.parse(storage.read() ?? '[]')
    expect(persisted).toEqual(result)
    expect(Object.keys(persisted[0]).sort()).toEqual(['openedAt', 'path', 'rootId'])
  })

  it('filters stale entries for the root whose current tree is loaded without hiding other roots', () => {
    const notes = [
      { rootId: 'vault', path: 'kept.md', openedAt: 3 },
      { rootId: 'vault', path: 'deleted.md', openedAt: 2 },
      { rootId: 'workspace', path: 'other-root.md', openedAt: 1 },
    ]

    expect(currentRootRecentNotes(notes, 'vault', ['kept.md'])).toEqual([
      { rootId: 'vault', path: 'kept.md', openedAt: 3 },
      { rootId: 'workspace', path: 'other-root.md', openedAt: 1 },
    ])
  })
})
