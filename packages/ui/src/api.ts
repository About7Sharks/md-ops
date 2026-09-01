import { useState, useCallback } from 'react'

export function apiBaseFromPathname(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length && /\.[A-Za-z0-9]+$/.test(segments[segments.length - 1])) segments.pop()
  return segments.length ? `/${segments.join('/')}` : ''
}

export const API_BASE = typeof window === 'undefined' ? '' : apiBaseFromPathname(window.location.pathname)

// Module-level sequence counter. Each useApi() instance keeps its own openFile
// sequence, so stale fetches from a previous instance are dropped by the seq
// check (the counter is shared but the seq value is per-call).
let openSeq = 0

// Single-flight health probe: concurrent callers share one in-flight fetch,
// so the cold-start double-fire (mount effect + first loadRoots) collapses
// into a single /health request instead of racing two.
let healthInflight: Promise<void> | null = null

export type Root = { id: string; label?: string; home?: string }

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type PersistFileResult =
  | { status: 'ok'; savedContent: string; etag: string }
  | { status: 'reload-required'; savedContent: string; writeAccepted: true; message: string }
  | { status: 'conflict'; message: string }
  | { status: 'err'; message: string }

type PersistFileOptions = {
  path: string
  body: string
  ifMatch?: string
  fetcher?: Fetcher
  apiBase?: string
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: unknown; message?: unknown } | null
  if (typeof payload?.message === 'string' && payload.message) return payload.message
  if (typeof payload?.error === 'string' && payload.error) return payload.error
  return fallback
}

export async function persistFileAndVerify({
  path,
  body,
  ifMatch,
  fetcher = fetch,
  apiBase = API_BASE,
}: PersistFileOptions): Promise<PersistFileResult> {
  const headers: Record<string, string> = { 'X-Confirm-Write': '1', 'Content-Type': 'text/plain' }
  if (ifMatch) headers['If-Match'] = ifMatch

  let writeResponse: Response
  try {
    writeResponse = await fetcher(apiBase + '/api/file?path=' + encodeURIComponent(path), {
      method: 'PUT',
      headers,
      body,
    })
  } catch (error) {
    return { status: 'err', message: error instanceof Error ? error.message : 'Save failed' }
  }

  if (writeResponse.status === 409) {
    return { status: 'conflict', message: 'File was modified elsewhere. Refetch to get latest.' }
  }
  if (!writeResponse.ok) {
    return {
      status: 'err',
      message: await responseError(writeResponse, 'Save failed: ' + writeResponse.status),
    }
  }

  const responseEtag = writeResponse.headers.get('etag')
  if (responseEtag) {
    return { status: 'ok', savedContent: body, etag: responseEtag }
  }

  let verificationResponse: Response
  try {
    verificationResponse = await fetcher(apiBase + '/api/file?path=' + encodeURIComponent(path))
  } catch {
    return {
      status: 'reload-required',
      savedContent: body,
      writeAccepted: true,
      message: 'The server accepted your save, but MD Ops could not verify a fresh version. Copy any newer local edits, then reload before editing again.',
    }
  }

  if (!verificationResponse.ok) {
    return {
      status: 'reload-required',
      savedContent: body,
      writeAccepted: true,
      message: `The server accepted your save, but version verification failed (HTTP ${verificationResponse.status}). Copy any newer local edits, then reload before editing again.`,
    }
  }

  const verifiedContent = await verificationResponse.text()
  const verifiedEtag = verificationResponse.headers.get('etag')
  if (!verifiedEtag) {
    return {
      status: 'reload-required',
      savedContent: body,
      writeAccepted: true,
      message: 'The server accepted your save, but version verification returned no ETag. Copy any newer local edits, then reload before editing again.',
    }
  }
  if (verifiedContent !== body) {
    return {
      status: 'reload-required',
      savedContent: body,
      writeAccepted: true,
      message: 'The server accepted your save, but the file changed again before verification finished. Copy your local draft, then reload and reconcile the latest version.',
    }
  }

  return { status: 'ok', savedContent: body, etag: verifiedEtag }
}

export function useApi() {
  const [roots, setRoots] = useState<Root[] | null>(null)
  const [files, setFiles] = useState<string[] | null>(null)
  const [folders, setFolders] = useState<string[] | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [health, setHealth] = useState<'checking' | 'ok' | 'err'>('checking')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContentState] = useState<string | null>(null)
  const [lastSavedContent, setLastSavedContent] = useState<string | null>(null)
  const [etag, setEtag] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Single-flight: concurrent cold-start callers (mount effect + first
  // loadRoots) await the same /health fetch instead of racing two.
  const checkHealth = useCallback(async () => {
    if (!healthInflight) {
      healthInflight = fetch(API_BASE + '/health')
        .then((r) => setHealth(r.ok ? 'ok' : 'err'))
        .catch(() => setHealth('err'))
        .finally(() => {
          healthInflight = null
        })
    }
    await healthInflight
  }, [])

  const loadRoots = useCallback(async () => {
    try {
      const r = await fetch(API_BASE + '/api/roots')
      const d = await r.json()
      setRoots(d.roots ?? [])
      checkHealth()
    } catch {
      setRoots([])
      setHealth('err')
    }
  }, [checkHealth])

  const loadTree = useCallback(async (rootId: string) => {
    setTreeLoading(true)
    try {
      const r = await fetch(API_BASE + '/api/tree?root=' + encodeURIComponent(rootId))
      const d = await r.json()
      setFiles(d.files ?? [])
      setFolders(d.folders ?? [])
    } catch {
      setFiles([])
      setFolders([])
    } finally {
      setTreeLoading(false)
    }
  }, [])

  const openFile = useCallback(async (rootId: string, relPath: string) => {
    const fullPath = rootId + '/' + relPath
    setSelectedPath(fullPath)
    setContentState(null)
    setLastSavedContent(null)
    setEtag(null)
    setError(null)
    // Guard: fast note-switching lets a stale fetch resolve after a newer one
    // started. Bump the sequence and drop any response that no longer matches.
    const seq = ++openSeq
    try {
      const r = await fetch(API_BASE + '/api/file?path=' + encodeURIComponent(fullPath))
      if (seq !== openSeq) return
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        if (seq !== openSeq) return
        const message = r.status === 404
          ? 'Note not found — it may have been renamed or deleted.'
          : (d.error || 'Failed to load: ' + r.status)
        setError(message)
        setContentState('')
        return
      }
      const text = await r.text()
      if (seq !== openSeq) return
      setContentState(text)
      setLastSavedContent(text)
      setEtag(r.headers.get('etag'))
    } catch (e) {
      if (seq !== openSeq) return
      setError(e instanceof Error ? e.message : 'Failed to load')
      setContentState('')
    }
  }, [])

  const selectBinaryFile = useCallback((rootId: string, relPath: string) => {
    setSelectedPath(rootId + '/' + relPath)
    setContentState(null)
    setLastSavedContent(null)
    setEtag(null)
    setError(null)
  }, [])

  const saveFile = useCallback(
    async (path: string, body: string, ifMatch?: string): Promise<'ok' | 'reload-required' | 'conflict' | 'err'> => {
      const result = await persistFileAndVerify({ path, body, ifMatch })
      if (result.status === 'ok') {
        // Never replace editor content here: the writer may have typed again while the request was in flight.
        setLastSavedContent(result.savedContent)
        setEtag(result.etag)
        setError(null)
        return 'ok'
      }
      if (result.status === 'reload-required') {
        // The PUT committed this body, but another conditional write is unsafe until a fresh ETag is loaded.
        setLastSavedContent(result.savedContent)
        setEtag(null)
        setError(result.message)
        return 'reload-required'
      }
      setError(result.message)
      return result.status
    },
    []
  )

  const createFile = useCallback(
    async (rootId: string, relPath: string, body: string): Promise<'ok' | 'exists' | 'err'> => {
      const path = `${rootId}/${relPath}`
      const headers: Record<string, string> = {
        'X-Confirm-Write': '1',
        'Content-Type': 'text/plain',
        'If-None-Match': '*',
      }
      try {
        const r = await fetch(API_BASE + '/api/file?path=' + encodeURIComponent(path), {
          method: 'PUT',
          headers,
          body,
        })
        if (r.ok) {
          // Trust the PUT response etag when the server returns one; fall back
          // to a refetch only when the header is missing.
          const etagHeader = r.headers.get('etag')
          if (etagHeader) {
            setSelectedPath(path)
            setContentState(body)
            setLastSavedContent(body)
            setEtag(etagHeader)
          } else {
            const refetch = await fetch(API_BASE + '/api/file?path=' + encodeURIComponent(path))
            if (refetch.ok) {
              const text = await refetch.text()
              setSelectedPath(path)
              setContentState(text)
              setLastSavedContent(text)
              setEtag(refetch.headers.get('etag'))
            } else {
              setSelectedPath(path)
              setContentState(body)
              setLastSavedContent(body)
              setEtag(null)
            }
          }
          setError(null)
          return 'ok'
        }
        if (r.status === 409 || r.status === 412) {
          setError('File already exists. Pick a new name or open the existing note.')
          return 'exists'
        }
        const d = await r.json().catch(() => ({}))
        setError(d.error || 'Create failed: ' + r.status)
        return 'err'
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Create failed')
        return 'err'
      }
    },
    []
  )

  const createFolder = useCallback(
    async (rootId: string, relPath: string): Promise<'ok' | 'exists' | 'err'> => {
      const path = `${rootId}/${relPath}`
      try {
        const r = await fetch(API_BASE + '/api/folder?path=' + encodeURIComponent(path), {
          method: 'PUT',
          headers: { 'X-Confirm-Write': '1' },
        })
        if (r.ok) {
          setError(null)
          return 'ok'
        }
        if (r.status === 409) {
          setError('Folder already exists. Pick a new name or select it from the tree.')
          return 'exists'
        }
        const d = await r.json().catch(() => ({}))
        setError(d.error || 'Create folder failed: ' + r.status)
        return 'err'
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Create folder failed')
        return 'err'
      }
    },
    []
  )

  const renameFolder = useCallback(
    async (rootId: string, fromRelPath: string, toRelPath: string): Promise<'ok' | 'exists' | 'err'> => {
      const from = `${rootId}/${fromRelPath}`
      const to = `${rootId}/${toRelPath}`
      try {
        const r = await fetch(API_BASE + '/api/folder?path=' + encodeURIComponent(from), {
          method: 'PATCH',
          headers: { 'X-Confirm-Write': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ to }),
        })
        if (r.ok) {
          setError(null)
          return 'ok'
        }
        if (r.status === 409) {
          setError('Target folder already exists. Pick a new name.')
          return 'exists'
        }
        const d = await r.json().catch(() => ({}))
        setError(d.error || 'Rename folder failed: ' + r.status)
        return 'err'
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Rename folder failed')
        return 'err'
      }
    },
    []
  )

  const clearSelected = useCallback(() => {
    setSelectedPath(null)
    setContentState(null)
    setLastSavedContent(null)
    setEtag(null)
  }, [])

  const deleteFile = useCallback(
    async (rootId: string, relPath: string): Promise<'ok' | 'err'> => {
      const path = `${rootId}/${relPath}`
      try {
        const r = await fetch(API_BASE + '/api/file?path=' + encodeURIComponent(path), {
          method: 'DELETE',
          headers: { 'X-Confirm-Write': '1' },
        })
        if (r.ok) {
          if (selectedPath === path) clearSelected()
          setError(null)
          return 'ok'
        }
        const d = await r.json().catch(() => ({}))
        setError(d.error || 'Delete file failed: ' + r.status)
        return 'err'
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete file failed')
        return 'err'
      }
    },
    [clearSelected, selectedPath]
  )

  const deleteFolder = useCallback(
    async (rootId: string, relPath: string): Promise<'ok' | 'err'> => {
      const path = `${rootId}/${relPath}`
      try {
        const r = await fetch(API_BASE + '/api/folder?path=' + encodeURIComponent(path) + '&recursive=1', {
          method: 'DELETE',
          headers: { 'X-Confirm-Write': '1' },
        })
        if (r.ok) {
          const selectedPrefix = `${path}/`
          if (selectedPath === path || selectedPath?.startsWith(selectedPrefix)) clearSelected()
          setError(null)
          return 'ok'
        }
        const d = await r.json().catch(() => ({}))
        setError(d.error || 'Delete folder failed: ' + r.status)
        return 'err'
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete folder failed')
        return 'err'
      }
    },
    [clearSelected, selectedPath]
  )

  const setContent = useCallback((value: string) => {
    setContentState(value)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const isDirty = content !== null && lastSavedContent !== null && content !== lastSavedContent

  return {
    roots,
    files,
    folders,
    loadRoots,
    loadTree,
    openFile,
    selectBinaryFile,
    saveFile,
    createFile,
    createFolder,
    renameFolder,
    deleteFile,
    deleteFolder,
    health,
    selectedPath,
    content,
    lastSavedContent,
    etag,
    setContent,
    error,
    clearError,
    checkHealth,
    isDirty,
    treeLoading,
  }
}
