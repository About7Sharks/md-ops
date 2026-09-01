import { forwardRef, useCallback, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { applyMarkdownCommand, indentMarkdownLines, markdownShortcut } from './markdownCommands'
import type { MarkdownCommand, MarkdownSelection } from './markdownCommands'
import './richMarkdownEditor.css'

export type RichMarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  ariaLabel?: string
  title?: string
  /** Either name can be used by a host while it settles its state model. */
  dirty?: boolean
  isDirty?: boolean
  saveStatus?: string
  saveState?: string
  onSave?: () => void
  onShowChanges?: () => void
}

const toolbar: Array<{ command: MarkdownCommand; label: string; shortcut?: string }> = [
  { command: 'heading', label: 'Heading' },
  { command: 'bold', label: 'Bold', shortcut: '⌘/Ctrl+B' },
  { command: 'italic', label: 'Italic', shortcut: '⌘/Ctrl+I' },
  { command: 'link', label: 'Link', shortcut: '⌘/Ctrl+K' },
  { command: 'inline-code', label: 'Inline code' },
  { command: 'quote', label: 'Quote' },
  { command: 'bulleted-list', label: 'Bulleted list' },
  { command: 'numbered-list', label: 'Numbered list' },
  { command: 'task-list', label: 'Task list' },
  { command: 'code-block', label: 'Code block' },
]

const primaryToolbar = toolbar.slice(0, 4)
const moreToolbar = toolbar.slice(4)
type ToolbarItem = MarkdownCommand | 'more'

function wordCount(value: string): number {
  const words = value.trim().match(/\S+/g)
  return words ? words.length : 0
}

function contextAt(value: string, offset: number) {
  const before = value.slice(0, offset)
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') }
}

const RichMarkdownEditor = forwardRef<HTMLTextAreaElement, RichMarkdownEditorProps>(function RichMarkdownEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel = 'Markdown editor',
  title,
  dirty,
  isDirty,
  saveStatus,
  saveState,
  onSave,
  onShowChanges,
}, forwardedRef) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const [cursor, setCursor] = useState(0)
  const [moreOpen, setMoreOpen] = useState(false)
  const [activeToolbarItem, setActiveToolbarItem] = useState<ToolbarItem>('heading')
  const moreControlsId = useId()
  const isDirtyValue = isDirty ?? dirty ?? false
  const status = saveStatus ?? saveState ?? (isDirtyValue ? 'Unsaved changes' : 'Saved')
  const context = useMemo(() => contextAt(value, cursor), [cursor, value])

  const setTextareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    textareaRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }, [forwardedRef])

  const restoreSelection = useCallback((next: MarkdownSelection) => {
    const restore = () => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd)
    }
    onChange(next.value)
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore)
    else setTimeout(restore, 0)
  }, [onChange])

  const runCommand = useCallback((command: MarkdownCommand) => {
    if (readOnly) return
    const textarea = textareaRef.current
    if (!textarea) return
    restoreSelection(applyMarkdownCommand(command, value, textarea.selectionStart, textarea.selectionEnd))
  }, [readOnly, restoreSelection, value])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return
    const shortcut = markdownShortcut(event.nativeEvent)
    if (shortcut) {
      event.preventDefault()
      if (shortcut === 'save') onSave?.()
      else runCommand(shortcut)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const textarea = event.currentTarget
      restoreSelection(indentMarkdownLines(value, textarea.selectionStart, textarea.selectionEnd, event.shiftKey))
    }
  }, [onSave, readOnly, restoreSelection, runCommand, value])

  const updateContext = useCallback(() => {
    setCursor(textareaRef.current?.selectionStart ?? 0)
  }, [])

  const runToolbarCommand = useCallback((command: MarkdownCommand, inMorePanel = false) => {
    if (inMorePanel) {
      setMoreOpen(false)
      setActiveToolbarItem('more')
    }
    runCommand(command)
  }, [runCommand])

  const onToolbarKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && moreOpen) {
      event.preventDefault()
      setMoreOpen(false)
      setActiveToolbarItem('more')
      moreButtonRef.current?.focus()
      return
    }

    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    if (!buttons.length) return

    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex = currentIndex
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = buttons.length - 1
    else if (event.key === 'ArrowRight') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length
    else nextIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1

    event.preventDefault()
    buttons[nextIndex]?.focus()
  }, [moreOpen])

  return (
    <section className="rich-markdown-editor" aria-label={title ? undefined : ariaLabel}>
      <div className="rich-markdown-editor__topline">
        <label className="rich-markdown-editor__label" htmlFor="rich-markdown-editor-input">{title ?? 'Markdown'}</label>
        <div className="rich-markdown-editor__actions" aria-label="Document actions">
          {onShowChanges && <button className="rich-markdown-editor__action" type="button" onClick={onShowChanges}>Changes</button>}
          <button className="rich-markdown-editor__action rich-markdown-editor__save" type="button" onClick={onSave} disabled={readOnly || !onSave} title="Save (⌘/Ctrl+S)">Save</button>
        </div>
      </div>
      <div className="rich-markdown-editor__format-row">
        <div
          className="rich-markdown-editor__toolbar"
          role="toolbar"
          aria-label="Markdown formatting"
          aria-orientation="horizontal"
          onKeyDown={onToolbarKeyDown}
        >
          {primaryToolbar.map(({ command, label, shortcut }) => (
            <button
              className="rich-markdown-editor__format"
              type="button"
              key={command}
              onClick={() => runToolbarCommand(command)}
              onFocus={() => setActiveToolbarItem(command)}
              disabled={readOnly}
              tabIndex={activeToolbarItem === command ? 0 : -1}
              title={shortcut ? `${label} (${shortcut})` : label}
              aria-label={shortcut ? `${label}, ${shortcut}` : label}
            >{label}</button>
          ))}
          <button
            ref={moreButtonRef}
            className="rich-markdown-editor__format rich-markdown-editor__more-toggle"
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            onFocus={() => setActiveToolbarItem('more')}
            disabled={readOnly}
            tabIndex={activeToolbarItem === 'more' ? 0 : -1}
            aria-expanded={moreOpen}
            aria-controls={moreControlsId}
          >
            More <span className="rich-markdown-editor__more-chevron" aria-hidden="true">⌄</span>
          </button>
          {moreOpen && (
            <div
              className="rich-markdown-editor__more-controls"
              id={moreControlsId}
              role="group"
              aria-label="More formatting options"
            >
              {moreToolbar.map(({ command, label, shortcut }) => (
                <button
                  className="rich-markdown-editor__format"
                  type="button"
                  key={command}
                  onClick={() => runToolbarCommand(command, true)}
                  onFocus={() => setActiveToolbarItem(command)}
                  disabled={readOnly}
                  tabIndex={activeToolbarItem === command ? 0 : -1}
                  title={shortcut ? `${label} (${shortcut})` : label}
                  aria-label={shortcut ? `${label}, ${shortcut}` : label}
                >{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <textarea
        ref={setTextareaRef}
        id="rich-markdown-editor-input"
        className="rich-markdown-editor__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onSelect={updateContext}
        onKeyUp={updateContext}
        onClick={updateContext}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        spellCheck
        wrap="soft"
        title={title}
        aria-label={ariaLabel}
        aria-readonly={readOnly}
        aria-describedby="rich-markdown-editor-context"
      />
      <footer className="rich-markdown-editor__status" id="rich-markdown-editor-context" aria-live="polite">
        <span className={`rich-markdown-editor__status-state${isDirtyValue ? ' rich-markdown-editor__dirty' : ''}`} title={status}>{status}</span>
        <span>Ln {context.line}, Col {context.column}</span>
        <span>{wordCount(value)} words</span>
        <span>{value.length} chars</span>
      </footer>
    </section>
  )
})

export default RichMarkdownEditor
