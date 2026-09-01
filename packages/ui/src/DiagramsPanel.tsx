import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BASE } from './api'

export type DiagramFile = {
  path: string
  blocks: Array<{ line: number; source: string }>
}

type DiagramsPanelProps = {
  root: string
  onOpenNote: (path: string) => void
}

type LoadState = 'loading' | 'ok' | 'err'

function folderPrefix(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash > 0 ? path.slice(0, slash) : ''
}

function basename(path: string): string {
  return path.split('/').pop() || path
}

export default function DiagramsPanel({ root, onOpenNote }: DiagramsPanelProps) {
  const [files, setFiles] = useState<DiagramFile[] | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    if (!root) {
      setFiles([])
      setState('ok')
      return
    }
    setState('loading')
    try {
      const res = await fetch(API_BASE + '/api/diagrams?root=' + encodeURIComponent(root))
      if (!res.ok) throw new Error('load failed')
      const data = await res.json()
      setFiles(data.files ?? [])
      setState('ok')
    } catch {
      setFiles([])
      setState('err')
    }
  }, [root])

  useEffect(() => {
    void load()
  }, [load])

  const totalBlocks = useMemo(() => files?.reduce((sum, f) => sum + f.blocks.length, 0) ?? 0, [files])

  const toggle = useCallback((path: string) => {
    setExpanded((current) => ({ ...current, [path]: !current[path] }))
  }, [])

  const heading = `${totalBlocks === 1 ? '1 diagram' : `${totalBlocks} diagrams`} in ${files?.length ?? 0} ${(files?.length ?? 0) === 1 ? 'note' : 'notes'}`

  return (
    <section className="activity-panel" aria-label="All mermaid diagrams">
      <header className="activity-panel-header">
        <span>Workspace</span>
        <h2>Diagrams</h2>
        <p>{root ? heading : 'Select a source to browse its diagrams.'}</p>
      </header>

      {state === 'loading' ? (
        <div className="activity-empty"><strong>Scanning diagrams</strong><span>Reading Markdown notes for mermaid blocks.</span></div>
      ) : state === 'err' ? (
        <div className="activity-empty"><strong>Diagrams unavailable</strong><span>Could not load diagrams for this source.</span></div>
      ) : files && files.length === 0 ? (
        <div className="activity-empty"><strong>No mermaid diagrams</strong><span>No mermaid blocks were found in this source.</span></div>
      ) : (
        <div className="activity-result-list diagrams-panel-list">
          {(files ?? []).map((file) => {
            const isOpen = Boolean(expanded[file.path])
            return (
              <div key={file.path} className={`diagram-file ${isOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className="activity-result diagram-file-summary"
                  onClick={() => toggle(file.path)}
                  aria-expanded={isOpen}
                  aria-label={`${basename(file.path)}: ${file.blocks.length} diagram${file.blocks.length === 1 ? '' : 's'}`}
                >
                  <span className="activity-result-kind">{file.blocks.length}</span>
                  <span>
                    <strong>{basename(file.path)}</strong>
                    <small>{folderPrefix(file.path) || root}</small>
                  </span>
                </button>
                {isOpen ? (
                  <div className="diagram-file-blocks">
                    {file.blocks.map((block, index) => (
                      <button
                        key={`${block.line}-${index}`}
                        type="button"
                        className="diagram-file-block"
                        onClick={() => onOpenNote(file.path)}
                        title={`Open ${basename(file.path)}`}
                      >
                        <span className="diagram-file-block-meta">Diagram {index + 1} · line {block.line}</span>
                        <span className="diagram-file-block-source">{block.source.split('\n').slice(0, 3).join(' · ')}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
