import { useState, type ReactNode } from 'react'
import type { RecentNote } from './recentNotes'
import './sidebarNavigation.css'

export type SidebarMode = 'all' | 'recent' | 'pinned'

export type ClipboardWriter = Pick<Clipboard, 'writeText'>
export type CopyPathResult = 'copied' | 'unavailable' | 'failed'

type SidebarNavigationProps = {
  mode: SidebarMode
  onModeChange: (mode: SidebarMode) => void
  recentNotes: RecentNote[]
  rootLabel: (rootId: string) => string
  onOpenRecent: (note: RecentNote) => void
  all: ReactNode
  pinned: ReactNode
}

const modes: Array<{ id: SidebarMode, label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'recent', label: 'Recent' },
  { id: 'pinned', label: 'Pinned' },
]

function noteName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

export async function copyRecentNotePath(
  path: string,
  clipboard: ClipboardWriter | null = typeof navigator !== 'undefined' && navigator.clipboard
    ? navigator.clipboard
    : null,
): Promise<CopyPathResult> {
  if (!clipboard || typeof clipboard.writeText !== 'function') return 'unavailable'

  try {
    await clipboard.writeText(path)
    return 'copied'
  } catch {
    return 'failed'
  }
}

function copyFeedback(result: CopyPathResult): string {
  switch (result) {
    case 'copied': return 'Path copied.'
    case 'unavailable': return 'Clipboard is unavailable. Copy the path manually.'
    case 'failed': return 'Could not copy the path. Try again or copy it manually.'
  }
}

export default function SidebarNavigation({ mode, onModeChange, recentNotes, rootLabel, onOpenRecent, all, pinned }: SidebarNavigationProps) {
  const [recentPathFeedback, setRecentPathFeedback] = useState('')

  return (
    <section className="sidebar-navigation" aria-label="Note navigation">
      <div className="sidebar-mode-switch" aria-label="Note list mode">
        {modes.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`sidebar-mode-button ${mode === id ? 'active' : ''}`}
            aria-pressed={mode === id}
            onClick={() => onModeChange(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'all' ? all : null}
      {mode === 'pinned' ? pinned : null}
      {mode === 'recent' ? (
        <div className="recent-notes" aria-label="Recent notes">
          {recentNotes.length ? recentNotes.map((note) => (
            <div className="recent-note-row" key={`${note.rootId}/${note.path}`}>
              <button
                type="button"
                className="recent-note"
                title={`${rootLabel(note.rootId)} · ${note.path}`}
                aria-label={`Open recent note ${note.path} from ${rootLabel(note.rootId)}`}
                onClick={() => onOpenRecent(note)}
              >
                <span className="recent-note-name">{noteName(note.path)}</span>
                <span className="recent-note-meta">{rootLabel(note.rootId)} · {note.path}</span>
              </button>
              <button
                type="button"
                className="recent-note-copy"
                title={`Copy path: ${note.path}`}
                aria-label={`Copy path ${note.path}`}
                onClick={async () => setRecentPathFeedback(copyFeedback(await copyRecentNotePath(note.path)))}
              >
                Copy
              </button>
            </div>
          )) : (
            <div className="recent-notes-empty">
              <strong>No recent notes yet</strong>
              <span>Open a note and it will appear here on this device.</span>
            </div>
          )}
          <p className="recent-note-copy-status" role="status" aria-live="polite">{recentPathFeedback}</p>
        </div>
      ) : null}
    </section>
  )
}
