import { useEffect, useId, useMemo, useRef } from 'react'
import { diffLines } from './lineDiff'
import type { LineDiffRow } from './lineDiff'
import './unsavedChangesDialog.css'

export type UnsavedChangesSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | string

export type UnsavedChangesDialogProps = {
  open: boolean
  title?: string
  reason?: string
  original: string
  current: string
  saveState?: UnsavedChangesSaveState
  busy?: boolean
  saveDisabled?: boolean
  conflict?: string | boolean | null
  error?: string | null
  onSave: () => void | Promise<void>
  onDiscard: () => void
  onStay: () => void
  onCopyDraft?: () => void | Promise<void>
  /** Override the default primary-action copy for transition or review flows. */
  saveLabel?: string
  /** Override destructive-action copy for a specific pending transition. */
  discardLabel?: string
  /** Override the safe-action copy; this button is focused when the dialog opens. */
  stayLabel?: string
  /** Optional copy-action label. Supplying it with onCopyDraft exposes a review-only action. */
  copyDraftLabel?: string
  /** Optional contextual label, such as "Review only" or "Before switching notes". */
  reviewLabel?: string
}

function messageFrom(value: string | boolean | null | undefined, fallback: string): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : fallback
}

function rowDescription(row: LineDiffRow): string {
  if (row.kind === 'added') return `Added current line ${row.currentLine ?? ''}`
  if (row.kind === 'removed') return `Removed original line ${row.originalLine ?? ''}`
  return `Unchanged line ${row.currentLine ?? row.originalLine ?? ''}`
}

export default function UnsavedChangesDialog({
  open,
  title = 'Review unsaved changes',
  reason = 'You have edits that have not been saved.',
  original,
  current,
  saveState = 'idle',
  busy = false,
  saveDisabled = false,
  conflict,
  error,
  onSave,
  onDiscard,
  onStay,
  onCopyDraft,
  saveLabel = 'Save and continue',
  discardLabel = 'Discard changes',
  stayLabel = 'Keep editing',
  copyDraftLabel = 'Copy draft',
  reviewLabel,
}: UnsavedChangesDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const cardRef = useRef<HTMLDivElement | null>(null)
  const stayButtonRef = useRef<HTMLButtonElement | null>(null)
  const diff = useMemo(() => diffLines(original, current), [current, original])
  const conflictMessage = messageFrom(conflict, 'The saved version changed. Review the conflict before continuing.')
  const errorMessage = messageFrom(error, 'Saving the draft failed. Your edits are still in this editor.')
  const statusMessage = errorMessage ?? conflictMessage
  const isSaving = busy || saveState === 'saving'

  useEffect(() => {
    if (!open) return

    const focusInitialAction = () => stayButtonRef.current?.focus()
    const frame = window.requestAnimationFrame(focusInitialAction)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onStay()
        return
      }
      if (event.key !== 'Tab') return

      const dialog = cardRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('hidden'))
      if (focusable.length === 0) return

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

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onStay, open])

  if (!open) return null

  const changes = diff.added + diff.removed
  const dialogRole = statusMessage ? 'alertdialog' : 'dialog'

  return (
    <div className="unsaved-changes-overlay" role="presentation">
      <div
        ref={cardRef}
        className="unsaved-changes-dialog"
        role={dialogRole}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="unsaved-changes-heading">
          <div>
            {reviewLabel ? <p className="unsaved-changes-review-label">{reviewLabel}</p> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <p className="unsaved-changes-change-total">{changes} change{changes === 1 ? '' : 's'}</p>
        </div>

        <p id={descriptionId} className="unsaved-changes-description">{reason}</p>

        {statusMessage ? (
          <p className="unsaved-changes-status unsaved-changes-status-error" role="alert" aria-live="assertive">
            {statusMessage}
          </p>
        ) : (
          <p className="unsaved-changes-status" role="status" aria-live="polite">
            {isSaving ? 'Saving your draft…' : 'Review the changes below before deciding.'}
          </p>
        )}

        <div className="unsaved-changes-summary" aria-label="Change summary">
          <span className="unsaved-changes-added-count">+ {diff.added} added</span>
          <span className="unsaved-changes-removed-count">− {diff.removed} removed</span>
          <span>{diff.unchanged} unchanged</span>
        </div>

        {diff.capped ? (
          <p className="unsaved-changes-cap-notice" role="status" aria-live="polite">
            This document is large, so the preview uses a safe non-minimal comparison.
          </p>
        ) : null}

        <div className="unsaved-changes-diff" aria-label="Line-by-line changes" tabIndex={0}>
          {diff.rows.length === 0 ? (
            <p className="unsaved-changes-empty-diff">No line changes to display.</p>
          ) : diff.rows.map((row, index) => (
            <div className={`unsaved-changes-row unsaved-changes-row-${row.kind}`} key={`${row.kind}-${row.originalLine}-${row.currentLine}-${index}`}>
              <span className="unsaved-changes-marker" aria-hidden="true">
                {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}
              </span>
              <span className="unsaved-changes-line-number" aria-hidden="true">
                {row.currentLine ?? row.originalLine ?? ''}
              </span>
              <span className="unsaved-changes-row-label">{rowDescription(row)}</span>
              <code className="unsaved-changes-line-text">{row.text || ' '}</code>
            </div>
          ))}
        </div>

        <div className="unsaved-changes-actions">
          {onCopyDraft ? (
            <button type="button" className="unsaved-changes-copy" onClick={onCopyDraft} disabled={isSaving}>
              {copyDraftLabel}
            </button>
          ) : null}
          <button type="button" className="unsaved-changes-discard" onClick={onDiscard} disabled={isSaving}>
            {discardLabel}
          </button>
          <button type="button" className="unsaved-changes-save" onClick={onSave} disabled={isSaving || saveDisabled}>
            {isSaving ? 'Saving…' : saveLabel}
          </button>
          <button ref={stayButtonRef} type="button" className="unsaved-changes-stay" onClick={onStay}>
            {stayLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
