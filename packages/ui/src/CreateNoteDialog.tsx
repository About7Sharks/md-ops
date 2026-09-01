import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { buildNewMarkdownPath } from './newFilePath'
import { buildNoteTemplate, noteTemplates, suggestedMarkdownFileName, syncMarkdownFileName } from './noteTemplates'
import type { NoteTemplateId } from './noteTemplates'
import './createNoteDialog.css'

export type CreateNoteRoot = {
  id: string
  label: string
}

export type CreateNoteSubmission = {
  rootId: string
  folder: string
  name: string
  body: string
}

export type CreateNoteDialogProps = {
  open: boolean
  roots: readonly CreateNoteRoot[]
  folders: readonly string[]
  currentRootId?: string | null
  initialRootId?: string | null
  currentFolder?: string | null
  initialFolder?: string | null
  existingFiles: readonly string[]
  busy?: boolean
  error?: string | null
  initialDate?: string
  onClose: () => void
  onSubmit: (submission: CreateNoteSubmission) => void
}

type Draft = {
  rootId: string
  folder: string
  title: string
  name: string
  body: string
  template: NoteTemplateId
  nameManuallyEdited: boolean
  bodyTemplateManaged: boolean
}

function localDateKey(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return offsetDate.toISOString().slice(0, 10)
}

function initialDraft(props: CreateNoteDialogProps): Draft {
  const rootId = props.initialRootId ?? props.currentRootId ?? props.roots[0]?.id ?? ''
  const folder = props.initialFolder ?? props.currentFolder ?? ''
  return {
    rootId,
    folder,
    title: '',
    name: suggestedMarkdownFileName(''),
    body: '',
    template: 'blank',
    nameManuallyEdited: false,
    bodyTemplateManaged: true,
  }
}

function knownPath(existingFiles: readonly string[], rootId: string, path: string): boolean {
  return existingFiles.some((file) => file === path || file === `${rootId}/${path}`)
}

export function validateCreateNoteDraft(draft: Pick<Draft, 'rootId' | 'folder' | 'name'>, existingFiles: readonly string[]): string | null {
  if (!draft.rootId) return 'Choose a source before creating a note.'
  try {
    const path = buildNewMarkdownPath(draft.folder, draft.name)
    if (knownPath(existingFiles, draft.rootId, path)) return 'A note already exists at this path. Choose another name or folder.'
  } catch (error) {
    return error instanceof Error ? error.message : 'Check the note path.'
  }
  return null
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')]
    .filter((element) => element.tabIndex >= 0)
}

export default function CreateNoteDialog(props: CreateNoteDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const dateRef = useRef(props.initialDate ?? localDateKey(new Date()))
  const [draft, setDraft] = useState<Draft>(() => initialDraft(props))

  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = props.open
    if (props.open && !wasOpen) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dateRef.current = props.initialDate ?? localDateKey(new Date())
      setDraft(initialDraft(props))
      requestAnimationFrame(() => titleRef.current?.focus())
    }
    if (!props.open && wasOpen) openerRef.current?.focus()
  }, [props.open, props.initialRootId, props.currentRootId, props.initialFolder, props.currentFolder, props.initialDate, props.roots])

  const path = useMemo(() => {
    try {
      return buildNewMarkdownPath(draft.folder, draft.name)
    } catch {
      return ''
    }
  }, [draft.folder, draft.name])
  const validationError = validateCreateNoteDraft(draft, props.existingFiles)
  const canSubmit = !props.busy && !validationError && Boolean(path)
  const describedBy = ['create-note-dialog-description', validationError ? 'create-note-path-error' : '', props.error ? 'create-note-submit-error' : ''].filter(Boolean).join(' ')

  const updateTitle = (title: string) => {
    setDraft((current) => ({
      ...current,
      title,
      name: syncMarkdownFileName(title, current.name, current.nameManuallyEdited),
      body: current.bodyTemplateManaged ? buildNoteTemplate(current.template, title, dateRef.current) : current.body,
    }))
  }

  const selectTemplate = (template: NoteTemplateId) => {
    setDraft((current) => ({
      ...current,
      template,
      body: buildNoteTemplate(template, current.title, dateRef.current),
      bodyTemplateManaged: true,
    }))
  }

  const submit = () => {
    if (!canSubmit) return
    props.onSubmit({ rootId: draft.rootId, folder: draft.folder, name: draft.name.trim(), body: draft.body })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onClose()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = focusableElements(dialogRef.current)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!props.open) return null

  return (
    <div className="create-note-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !props.busy) props.onClose() }}>
      <div
        ref={dialogRef}
        className="create-note-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-note-dialog-title"
        aria-describedby={describedBy}
        onKeyDown={handleKeyDown}
      >
        <header className="create-note-header">
          <div>
            <p className="create-note-eyebrow">New Markdown note</p>
            <h2 id="create-note-dialog-title">Create a note</h2>
            <p id="create-note-dialog-description">Choose a starting point, place it in a source, then create and open it.</p>
          </div>
          <button className="create-note-close" type="button" onClick={props.onClose} disabled={props.busy} aria-label="Close create note dialog">×</button>
        </header>

        <div className="create-note-scroll">
          <section className="create-note-section" aria-labelledby="create-note-template-label">
            <div className="create-note-section-heading">
              <h3 id="create-note-template-label">Start with a template</h3>
              <span aria-live="polite">{noteTemplates.find((template) => template.id === draft.template)?.label}</span>
            </div>
            <div className="create-note-templates" role="group" aria-labelledby="create-note-template-label">
              {noteTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`create-note-template${draft.template === template.id ? ' create-note-template-selected' : ''}`}
                  aria-pressed={draft.template === template.id}
                  onClick={() => selectTemplate(template.id)}
                >
                  <strong>{template.label}</strong>
                  <span>{template.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="create-note-section create-note-fields" aria-label="Note details">
            <label className="create-note-field" htmlFor="create-note-title">
              <span>Title</span>
              <input ref={titleRef} id="create-note-title" value={draft.title} onChange={(event) => updateTitle(event.target.value)} placeholder="Untitled note" autoComplete="off" />
            </label>
            <label className="create-note-field" htmlFor="create-note-name">
              <span>Filename</span>
              <input
                id="create-note-name"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value, nameManuallyEdited: true }))}
                placeholder="untitled-note.md"
                autoComplete="off"
                aria-describedby={validationError ? 'create-note-path-error' : undefined}
              />
              <small>Updates from the title until you edit this field.</small>
            </label>
            <div className="create-note-source-grid">
              <label className="create-note-field" htmlFor="create-note-root">
                <span>Source</span>
                <select id="create-note-root" value={draft.rootId} onChange={(event) => setDraft((current) => ({ ...current, rootId: event.target.value }))}>
                  {!draft.rootId && <option value="">Choose a source</option>}
                  {props.roots.map((root) => <option key={root.id} value={root.id}>{root.label || root.id}</option>)}
                </select>
              </label>
              <label className="create-note-field" htmlFor="create-note-folder">
                <span>Folder</span>
                <input id="create-note-folder" value={draft.folder} onChange={(event) => setDraft((current) => ({ ...current, folder: event.target.value }))} list="create-note-folders" placeholder="Root folder" autoComplete="off" />
                <datalist id="create-note-folders">
                  {props.folders.map((folder) => <option key={folder} value={folder} />)}
                </datalist>
              </label>
            </div>
            <div className={`create-note-path${validationError ? ' create-note-path-invalid' : ''}`} aria-live="polite">
              <span>New path</span>
              <code>{path || 'Enter a valid filename'}</code>
            </div>
            {validationError && <p id="create-note-path-error" className="create-note-message create-note-message-error" role="alert">{validationError}</p>}
          </section>

          <section className="create-note-section create-note-editor-section" aria-label="Note body">
            <label className="create-note-field" htmlFor="create-note-body"><span>Content</span></label>
            <div className="create-note-editor-grid">
              <textarea id="create-note-body" value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value, bodyTemplateManaged: false }))} placeholder="Write in Markdown…" />
              <div className="create-note-preview" aria-label="Live Markdown preview">
                {draft.body ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.body}</ReactMarkdown> : <p>Preview appears as you write.</p>}
              </div>
            </div>
          </section>
          {props.error && <p id="create-note-submit-error" className="create-note-message create-note-message-error" role="alert">{props.error}</p>}
        </div>

        <footer className="create-note-footer">
          <p className="create-note-shortcut">⌘/Ctrl + Enter to create</p>
          <div className="create-note-actions">
            <button className="create-note-cancel" type="button" onClick={props.onClose} disabled={props.busy}>Cancel</button>
            <button className="create-note-submit" type="button" onClick={submit} disabled={!canSubmit}>{props.busy ? 'Creating…' : 'Create & Open'}</button>
          </div>
        </footer>
      </div>
    </div>
  )
}
