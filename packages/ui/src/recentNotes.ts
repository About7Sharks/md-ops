export const RECENT_NOTES_STORAGE_KEY = 'md-ops.recent-notes.v1'
export const MAX_RECENT_NOTES = 7

export type RecentNote = {
  rootId: string
  path: string
  openedAt: number
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function validRecentNote(value: unknown): RecentNote | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RecentNote>
  if (typeof candidate.rootId !== 'string' || !candidate.rootId.trim()) return null
  if (typeof candidate.path !== 'string' || !candidate.path.trim()) return null
  const rootId = candidate.rootId.trim()
  const path = candidate.path.trim()
  if (path.startsWith('/') || path.split('/').includes('..')) return null
  if (typeof candidate.openedAt !== 'number' || !Number.isFinite(candidate.openedAt) || candidate.openedAt <= 0) return null
  return { rootId, path, openedAt: candidate.openedAt }
}

function newerFirst(a: RecentNote, b: RecentNote): number {
  if (b.openedAt !== a.openedAt) return b.openedAt - a.openedAt
  return `${a.rootId}/${a.path}`.localeCompare(`${b.rootId}/${b.path}`)
}

export function boundRecentNotes(notes: RecentNote[], maximum = MAX_RECENT_NOTES): RecentNote[] {
  const limit = Math.max(0, Math.floor(maximum))
  const byNote = new Map<string, RecentNote>()
  for (const note of notes) {
    const valid = validRecentNote(note)
    if (!valid) continue
    const key = `${valid.rootId}\u0000${valid.path}`
    const existing = byNote.get(key)
    if (!existing || valid.openedAt > existing.openedAt) byNote.set(key, valid)
  }
  return [...byNote.values()].sort(newerFirst).slice(0, limit)
}

export function loadRecentNotes(storage: StorageLike | null = defaultStorage()): RecentNote[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(RECENT_NOTES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? boundRecentNotes(parsed) : []
  } catch {
    return []
  }
}

export function saveRecentNotes(notes: RecentNote[], storage: StorageLike | null = defaultStorage()): RecentNote[] {
  const bounded = boundRecentNotes(notes)
  if (!storage) return bounded
  try {
    storage.setItem(RECENT_NOTES_STORAGE_KEY, JSON.stringify(bounded))
  } catch {
    // Storage can be unavailable in private browsing or when quota is exhausted.
  }
  return bounded
}

export function recordRecentNote(note: RecentNote, storage: StorageLike | null = defaultStorage()): RecentNote[] {
  return saveRecentNotes([note, ...loadRecentNotes(storage)], storage)
}

export function currentRootRecentNotes(notes: RecentNote[], rootId: string | null, files: string[]): RecentNote[] {
  if (!rootId) return boundRecentNotes(notes)
  const currentFiles = new Set(files)
  return boundRecentNotes(notes).filter((note) => note.rootId !== rootId || currentFiles.has(note.path))
}
