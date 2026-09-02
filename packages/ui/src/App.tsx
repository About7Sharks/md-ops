import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense, memo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { API_BASE, useApi } from './api'
import type { Root } from './api'
import { clearPageSessionGraphCache } from './systemGraphModel'
import { extractFrontmatter, fileKind, fileKindLabel, isImageFile, isMarkdownFile, isTextPreviewFile, parseFrontmatterTags, parseWikilinks, resolveWikilinkToPath } from './obsidian'
import { buildFileTree, ancestorFolderPaths, folderPathsFromFiles } from './fileTree'
import type { FileTreeNode } from './fileTree'
import { assetUrl, markdownWithWikilinksAndImages, resolveVaultAssetPath } from './markdownAssets'
import { buildNewMarkdownPath, normalizeFolderPath } from './newFilePath'
import { buildQuickLinks, preferredQuickLinkRoot, preferredRootId } from './quickLinks'
import { currentRootRecentNotes, loadRecentNotes, recordRecentNote } from './recentNotes'
import type { RecentNote } from './recentNotes'
import SidebarNavigation from './SidebarNavigation'
import type { SidebarMode } from './SidebarNavigation'
import ActivityNavigation from './ActivityNavigation'
import { markdownHeadingId, parseMarkdownHeadings, searchRootEntries } from './activityNavigationModel'
import type { ActivityDestination, PanelActivityId } from './activityNavigationModel'
import CreateNoteDialog from './CreateNoteDialog'
import type { CreateNoteSubmission } from './CreateNoteDialog'
import RichMarkdownEditor from './RichMarkdownEditor'
import UnsavedChangesDialog from './UnsavedChangesDialog'
import { extractMermaidBlocks } from './mermaidDiagrams'
import { mermaidExportFilename } from './mermaidExport'
import DiagramsPanel from './DiagramsPanel'
import ThemePicker from './ThemePicker'
import { applyUiSettings, loadUiSettings, saveUiSettings } from './themeModel'
import type { UiSettings } from './themeModel'
import './App.css'
import './activityNavigation.css'

// Bundle-size: mermaid's non-diagram core (~460 KiB min) and d3 were statically
// pulled into the boot bundle because App imported MermaidDiagram and SystemGraph
// eagerly. Both are only rendered on demand (a note containing ```mermaid blocks,
// or the Graph activity), so load them behind React.lazy code-split boundaries.
const MermaidDiagram = lazy(() =>
  import('./MermaidDiagram').then((m) => ({ default: m.MermaidDiagram })),
)
const SystemGraph = lazy(() =>
  import('./SystemGraph').then((m) => ({ default: m.default })),
)

function displayRootLabel(root: Pick<Root, 'id' | 'label'>): string {
  return root.label || root.id.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function displayRootMeta(root: Pick<Root, 'id'>): string {
  return root.id
}

type DocumentView = 'split' | 'edit' | 'preview' | 'read' | 'diagrams'
type SideNavAction = 'file' | 'folder' | 'rename-folder'
type SideNavConfirmationAction = 'create-file' | 'create-folder' | 'delete-file' | 'delete-folder'
type SideNavConfirmation = {
  action: SideNavConfirmationAction
  path: string
  warning?: string
}
type PendingDocumentTransition = {
  reason: string
  run: () => void | Promise<void>
}
const documentViews: DocumentView[] = ['read', 'split', 'edit', 'preview', 'diagrams']
const VISIBLE_WIKILINK_LIMIT = 100
// Layout breakpoint: below this width the app runs its mobile layout (drawer
// + single-pane document). One constant so the threshold can't drift across
// the handlers that branch on it.
export const DESKTOP_BREAKPOINT = 900

type DeepLink = {
  root: string
  path: string
  view: DocumentView
}

function parseDocumentView(raw: string | null): DocumentView {
  if (raw === 'edit' || raw === 'preview' || raw === 'read' || raw === 'diagrams') return raw
  return 'split'
}

function parseDeepLink(): DeepLink | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const root = params.get('root')?.trim()
  const path = params.get('path')?.replace(/^\/+/, '').trim()
  const view = parseDocumentView(params.get('view'))
  if (!root || !path) return null
  return { root, path, view }
}

function buildShareUrl(selectedPath: string, view: DocumentView): string {
  if (typeof window === 'undefined') return ''
  const [root, ...rest] = selectedPath.split('/')
  const url = new URL(window.location.href)
  url.searchParams.set('root', root)
  url.searchParams.set('path', rest.join('/'))
  url.searchParams.set('view', view)
  return url.toString()
}

function viewLabel(view: DocumentView): string {
  switch (view) {
    case 'edit': return 'Edit'
    case 'preview': return 'Preview'
    case 'read': return 'Read'
    case 'split': return 'Split'
    case 'diagrams': return 'Diagrams'
  }
}

function fileDisplayName(path: string): string {
  return path.split('/').pop() || path
}

function normalizeFolderSegment(input: string): string {
  const name = input.trim()
  if (!name) throw new Error('Folder name is required')
  if (name.includes('/') || name.includes('\\')) throw new Error('Folder name cannot contain slashes')
  if (name === '.' || name === '..') throw new Error('Folder name cannot be . or ..')
  return name
}

function joinFolderPath(parentFolder: string, folderName: string): string {
  const parent = normalizeFolderPath(parentFolder)
  const name = normalizeFolderSegment(folderName)
  return parent ? `${parent}/${name}` : name
}

function parentFolderPath(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

function folderTone(path: string): number {
  let hash = 0
  for (const char of path) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return (hash >>> 0) % 5
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3.75 6.75A1.75 1.75 0 0 1 5.5 5h4.19l1.7 2h7.11a1.75 1.75 0 0 1 1.75 1.75v8.75a1.75 1.75 0 0 1-1.75 1.75h-13A1.75 1.75 0 0 1 3.75 17.5V6.75Z" />
    </svg>
  )
}

function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3.75 7.25A1.75 1.75 0 0 1 5.5 5.5h4.19l1.7 2h7.11a1.75 1.75 0 0 1 1.75 1.75v8.25a1.75 1.75 0 0 1-1.75 1.75h-13A1.75 1.75 0 0 1 3.75 17.5V7.25Z" />
      <path d="M15.5 11.25v4.5M13.25 13.5h4.5" />
    </svg>
  )
}

const markdownHeadingComponents: Components = {
  h1: ({ node, ...props }) => <h1 {...props} id={markdownHeadingId(node?.position?.start.line)} tabIndex={-1} />,
  h2: ({ node, ...props }) => <h2 {...props} id={markdownHeadingId(node?.position?.start.line)} tabIndex={-1} />,
  h3: ({ node, ...props }) => <h3 {...props} id={markdownHeadingId(node?.position?.start.line)} tabIndex={-1} />,
  h4: ({ node, ...props }) => <h4 {...props} id={markdownHeadingId(node?.position?.start.line)} tabIndex={-1} />,
  h5: ({ node, ...props }) => <h5 {...props} id={markdownHeadingId(node?.position?.start.line)} tabIndex={-1} />,
  h6: ({ node, ...props }) => <h6 {...props} id={markdownHeadingId(node?.position?.start.line)} tabIndex={-1} />,
}

type MarkdownDocumentProps = {
  markdown: string
  fileList: string[]
  activeRoot: string | null
  selectedRelPath: string | null
  onOpenWikilink: (target: string) => void
}

// Large operational notes can produce tens of thousands of DOM nodes. Keep
// their Markdown subtree stable when an unrelated sidebar or toolbar control
// changes App state; reparsing the same megabyte-scale note made every click
// block the main thread for several seconds.
const MarkdownDocument = memo(function MarkdownDocument({ markdown, fileList, activeRoot, selectedRelPath, onOpenWikilink }: MarkdownDocumentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        ...markdownHeadingComponents,
        a: ({ href, children, ...props }) => {
          const wikilinkPrefix = href?.startsWith('#wikilink:') ? '#wikilink:' : href?.startsWith('wikilink:') ? 'wikilink:' : null
          if (href && wikilinkPrefix) {
            const encodedTarget = href.slice(wikilinkPrefix.length)
            const target = decodeURIComponent(encodedTarget)
            const resolved = resolveWikilinkToPath(target, fileList)
            return (
              <button
                type="button"
                className={`wikilink-inline ${resolved ? '' : 'unresolved'}`}
                onClick={() => resolved && onOpenWikilink(target)}
                disabled={!resolved}
              >
                {children}
              </button>
            )
          }
          return <a href={href} {...props}>{children}</a>
        },
        img: ({ src, alt, ...props }) => {
          if (activeRoot) {
            const relPath = resolveVaultAssetPath(src, selectedRelPath)
            if (relPath) {
              return <img src={assetUrl(API_BASE, activeRoot, relPath)} alt={alt ?? ''} loading="lazy" {...props} />
            }
          }
          return <img src={src} alt={alt ?? ''} loading="lazy" {...props} />
        },
        code: ({ className, children, node, ...props }) => {
          if (className?.includes('language-mermaid')) {
            const source = String(children ?? '').replace(/\n$/, '')
            const sourceLine = node?.position?.start.line
            return (
              <Suspense fallback={<div className="mermaid-diagram" data-role="mermaid-diagram-loading" />}>
                <MermaidDiagram
                  source={source}
                  downloadName={mermaidExportFilename(selectedRelPath, sourceLine)}
                  exportLabel={sourceLine ? `Mermaid diagram at line ${sourceLine}` : 'Mermaid diagram'}
                />
              </Suspense>
            )
          }
          const isBlock = className?.includes('language-')
          return isBlock
            ? <pre className="markdown-code-block"><code className={className} {...props}>{children}</code></pre>
            : <code className={className} {...props}>{children}</code>
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
})

export default function App() {
  const { roots, files, folders, loadRoots, loadTree, openFile, selectBinaryFile, saveFile, createFile, createFolder: createFolderApi, renameFolder, deleteFile, deleteFolder: deleteFolderApi, health, selectedPath, content, lastSavedContent, etag, setContent, error, clearError, isDirty, treeLoading } = useApi()
  const [activeRoot, setActiveRoot] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'reload-required' | 'conflict' | 'err'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [pendingDocumentTransition, setPendingDocumentTransition] = useState<PendingDocumentTransition | null>(null)
  const [writeMode, setWriteMode] = useState(false)
  // Files is the mobile landing surface unless a shared link already identifies a note.
  // Desktop retains its persistent sidebar and never opts into this mobile default.
  const [sidebarOpen, setSidebarOpen] = useState(() => (
    typeof window !== 'undefined' && window.innerWidth <= DESKTOP_BREAKPOINT && !parseDeepLink()
  ))
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false)
  const [uiSettings, setUiSettings] = useState<UiSettings>(() => {
    const base = loadUiSettings()
    // ?theme=<id> overrides the stored theme for this load only (deep links, demos).
    const urlTheme = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('theme') : null
    if (urlTheme && urlTheme !== base.theme && ['slate-rose', 'github-quiet', 'deep-sea', 'warm-ink', 'paper-night'].includes(urlTheme)) {
      return { ...base, theme: urlTheme as UiSettings['theme'] }
    }
    return base
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => { applyUiSettings(uiSettings) }, [uiSettings])
  // Persist only explicit user changes so a transient ?theme= link never sticks.
  const handleUiSettingsChange = useCallback((next: UiSettings) => {
    setUiSettings(next)
    saveUiSettings(next)
  }, [])
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem('mdops.sidebarWidth'))
    return Number.isFinite(stored) && stored >= 200 && stored <= 520 ? stored : 280
  })
  const sidebarDragRef = useRef<{ startX: number; startW: number } | null>(null)
  useEffect(() => {
    if (desktopSidebarCollapsed) return
    const onMove = (e: PointerEvent) => {
      const drag = sidebarDragRef.current
      if (!drag) return
      const w = Math.min(520, Math.max(200, drag.startW + (e.clientX - drag.startX)))
      setSidebarWidth(w)
    }
    const onUp = () => {
      if (!sidebarDragRef.current) return
      sidebarDragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSidebarWidth((w) => { localStorage.setItem('mdops.sidebarWidth', String(w)); return w })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [desktopSidebarCollapsed])
  const startSidebarDrag = (e: React.PointerEvent) => {
    if (desktopSidebarCollapsed) return
    e.preventDefault()
    sidebarDragRef.current = { startX: e.clientX, startW: sidebarWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const [activityView, setActivityView] = useState<PanelActivityId>('files')
  const [activitySearch, setActivitySearch] = useState('')
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('all')
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>(() => loadRecentNotes())
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())
  const [documentView, setDocumentView] = useState<DocumentView>('read')
  const [showGraph, setShowGraph] = useState(false)
  const [showWikilinks, setShowWikilinks] = useState(() => (typeof window !== 'undefined' ? window.innerWidth > DESKTOP_BREAKPOINT : true))
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [draftCopyStatus, setDraftCopyStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [showCreate, setShowCreate] = useState(false)
  const [createStatus, setCreateStatus] = useState<'idle' | 'creating' | 'exists' | 'err'>('idle')
  const [createError, setCreateError] = useState<string | null>(null)
  const latestContentRef = useRef(content)
  latestContentRef.current = content
  const [sideNavAction, setSideNavAction] = useState<SideNavAction | null>(null)
  const [sideNavParent, setSideNavParent] = useState('')
  const [sideNavTarget, setSideNavTarget] = useState('')
  const [sideNavInput, setSideNavInput] = useState('')
  const [sideNavStatus, setSideNavStatus] = useState<'idle' | 'working' | 'err'>('idle')
  const [sideNavError, setSideNavError] = useState<string | null>(null)
  const [sideNavConfirmation, setSideNavConfirmation] = useState<SideNavConfirmation | null>(null)
  const deepLink = useMemo(() => parseDeepLink(), [])
  const quickLinks = useMemo(() => buildQuickLinks(roots), [roots])
  const appliedDeepLink = useRef(false)
  const appliedRootHome = useRef(false)
  const recordedRecentOpen = useRef<string | null>(null)
  const workspaceHeaderRef = useRef<HTMLElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const sideNavCancelRef = useRef<HTMLButtonElement | null>(null)
  const sideNavConfirmRef = useRef<HTMLButtonElement | null>(null)
  const [workspaceHeaderHeight, setWorkspaceHeaderHeight] = useState(0)

  useEffect(() => {
    loadRoots()
  }, [loadRoots])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const header = workspaceHeaderRef.current
    if (!header) return

    const updateHeaderHeight = () => setWorkspaceHeaderHeight(Math.ceil(header.getBoundingClientRect().height))
    updateHeaderHeight()

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeaderHeight) : null
    resizeObserver?.observe(header)
    window.addEventListener('resize', updateHeaderHeight)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateHeaderHeight)
    }
  }, [])

  const fileList = files || []
  const allFolderList = useMemo(() => {
    const merged = new Set<string>([...(folders ?? []), ...folderPathsFromFiles(fileList)])
    return [...merged].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  }, [folders, fileList])
  const activeRootConfig = useMemo(() => roots?.find((root) => root.id === activeRoot) ?? null, [roots, activeRoot])
  const recentRootLabel = useCallback((rootId: string) => {
    const root = roots?.find((candidate) => candidate.id === rootId)
    return root ? displayRootLabel(root) : rootId
  }, [roots])
  const visibleRecentNotes = useMemo(() => {
    const withCurrentRoot = currentRootRecentNotes(recentNotes, activeRoot, fileList)
    return roots ? withCurrentRoot.filter((note) => roots.some((root) => root.id === note.rootId)) : withCurrentRoot
  }, [activeRoot, fileList, recentNotes, roots])
  const parsed = useMemo(() => extractFrontmatter(content ?? ''), [content])
  const noteTags = useMemo(() => parseFrontmatterTags(parsed.frontmatter), [parsed.frontmatter])
  const wikilinks = useMemo(() => parseWikilinks(parsed.body), [parsed.body])
  const visibleWikilinks = useMemo(() => wikilinks.slice(0, VISIBLE_WIKILINK_LIMIT), [wikilinks])
  const outlineHeadings = useMemo(() => parseMarkdownHeadings(parsed.body), [parsed.body])
  const rootSearchResults = useMemo(
    () => searchRootEntries(activitySearch, fileList, allFolderList),
    [activitySearch, allFolderList, fileList]
  )

  const requestDocumentTransition = useCallback((reason: string, run: () => void | Promise<void>): boolean => {
    if (!isDirty) {
      void run()
      return true
    }
    setShowDiff(false)
    setPendingDocumentTransition({ reason, run })
    return false
  }, [isDirty])

  useEffect(() => {
    if (!isDirty || typeof window === 'undefined') return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [isDirty])

  const handleSelectRoot = useCallback((rootId: string) => {
    if (rootId === activeRoot) return
    requestDocumentTransition(`switch to ${recentRootLabel(rootId)}`, () => {
      setActiveRoot(rootId)
      setSearch('')
      setExpandedFolders(new Set())
      loadTree(rootId)
    })
  }, [activeRoot, loadTree, recentRootLabel, requestDocumentTransition])

  const searchTerm = search.trim().toLowerCase()
  const filteredFiles = searchTerm
    ? fileList.filter((f) => f.toLowerCase().includes(searchTerm))
    : fileList
  const filteredFolders = searchTerm
    ? allFolderList.filter((folder) => folder.toLowerCase().includes(searchTerm))
    : allFolderList
  const selectedRelPath = selectedPath && activeRoot ? selectedPath.replace(`${activeRoot}/`, '') : null
  const selectedAncestors = useMemo(() => ancestorFolderPaths(selectedRelPath), [selectedRelPath])
  const fileTree = useMemo(() => buildFileTree(filteredFiles, filteredFolders), [filteredFiles, filteredFolders])
  const folderOptions = allFolderList
  const searchActive = search.trim().length > 0
  const renderedMarkdown = useMemo(
    () => markdownWithWikilinksAndImages(parsed.body, API_BASE, activeRoot, selectedRelPath),
    [activeRoot, parsed.body, selectedRelPath]
  )
  const mermaidBlocks = useMemo(() => extractMermaidBlocks(parsed.body), [parsed.body])
  const documentStats = useMemo(() => {
    const source = content ?? ''
    const trimmed = source.trim()
    return {
      lines: source ? source.split(/\r\n|\r|\n/).length : 0,
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      chars: source.length,
    }
  }, [content])
  const selectedDisplayPath = selectedPath ? (activeRoot ? selectedPath.replace(`${activeRoot}/`, '') : selectedPath) : ''
  const selectedFolder = selectedRelPath ? parentFolderPath(selectedRelPath) : ''
  const selectedKind = selectedRelPath ? fileKind(selectedRelPath) : null
  const selectedIsMarkdown = selectedRelPath ? isMarkdownFile(selectedRelPath) : false
  const selectedIsTextPreview = selectedRelPath ? isTextPreviewFile(selectedRelPath) : false
  const selectedIsImage = selectedRelPath ? isImageFile(selectedRelPath) : false
  // openFile clears content to null before fetching; content === '' is an
  // empty file or an error. Binary selections (images, other non-text) never
  // fetch, so content === null is their steady state, not a load.
  const contentLoading = selectedRelPath !== null && content === null && error === null && (selectedIsMarkdown || selectedIsTextPreview)
  const selectedAssetUrl = selectedRelPath && activeRoot ? assetUrl(API_BASE, activeRoot, selectedRelPath) : ''
  const activeRootLabel = activeRootConfig ? displayRootLabel(activeRootConfig) : 'No source'
  const hasRenderedMarkdown = renderedMarkdown.trim().length > 0
  const etagPreview = etag ? etag.replace(/^W\//, '').replace(/"/g, '').slice(0, 12) : null

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => {
      if (window.innerWidth > DESKTOP_BREAKPOINT) setShowWikilinks(true)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!roots?.length || appliedDeepLink.current) return
    if (!deepLink) return
    const rootExists = roots.some((root) => root.id === deepLink.root)
    if (!rootExists) {
      appliedDeepLink.current = true
      return
    }
    setActiveRoot(deepLink.root)
    loadTree(deepLink.root)
    openFile(deepLink.root, deepLink.path)
    setDocumentView(deepLink.view)
    if (typeof window !== 'undefined' && window.innerWidth <= DESKTOP_BREAKPOINT) {
      setSidebarOpen(false)
      if (deepLink.view === 'split') setDocumentView('preview')
    }
    appliedDeepLink.current = true
  }, [roots, deepLink, loadTree, openFile])

  useEffect(() => {
    if (!roots?.length || activeRoot) return
    // The deep-link effect and this fallback effect run from the same render.
    // Keep a valid shared link authoritative even after that effect flips its ref.
    if (deepLink && roots.some((root) => root.id === deepLink.root)) return
    const fallbackRoot = preferredRootId(roots)
    if (!fallbackRoot) return
    setActiveRoot(fallbackRoot)
    loadTree(fallbackRoot)
    const rootHome = roots.find((root: Root) => root.id === fallbackRoot)?.home
    if (rootHome && !appliedRootHome.current) {
      openFile(fallbackRoot, rootHome)
      setDocumentView('read')
      appliedRootHome.current = true
    }
  }, [roots, activeRoot, deepLink, loadTree, openFile])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (!selectedPath) {
      url.searchParams.delete('root')
      url.searchParams.delete('path')
      url.searchParams.delete('view')
    } else {
      const [root, ...rest] = selectedPath.split('/')
      url.searchParams.set('root', root)
      url.searchParams.set('path', rest.join('/'))
      url.searchParams.set('view', documentView)
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [selectedPath, documentView])

  useEffect(() => {
    if (!selectedPath || content === null) {
      recordedRecentOpen.current = null
      return
    }
    if (error || recordedRecentOpen.current === selectedPath) return
    const [rootId, ...pathParts] = selectedPath.split('/')
    const path = pathParts.join('/')
    if (!rootId || !path || !isMarkdownFile(path)) return

    recordedRecentOpen.current = selectedPath
    setRecentNotes(recordRecentNote({ rootId, path, openedAt: Date.now() }))
  }, [content, error, selectedPath])

  const handleQuickLink = useCallback((path: string, rootHint?: string, readView = false) => {
    const rootId = preferredQuickLinkRoot(roots, activeRoot, rootHint)
    if (!rootId) return

    requestDocumentTransition(`open ${path.replace(/\/$/, '')}`, () => {
      setActiveRoot(rootId)
      loadTree(rootId)

      if (path.endsWith('/')) {
        setSearch(path.replace(/\/$/, ''))
        return
      }
      openFile(rootId, path)
      if (readView) setDocumentView('read')
      setSidebarOpen(false)
    })
  }, [activeRoot, roots, loadTree, openFile, requestDocumentTransition])

  const handleOpenFromTree = useCallback((relPath: string) => {
    if (!activeRoot) return
    if (selectedRelPath === relPath) {
      setSidebarOpen(false)
      return
    }
    requestDocumentTransition(`open ${relPath}`, () => {
      if (isImageFile(relPath) || !isTextPreviewFile(relPath)) {
        selectBinaryFile(activeRoot, relPath)
      } else {
        openFile(activeRoot, relPath)
      }
      setSidebarOpen(false)
    })
  }, [activeRoot, openFile, requestDocumentTransition, selectBinaryFile, selectedRelPath])

  const handleOpenFromGraph = useCallback((rootId: string, relPath: string) => {
    requestDocumentTransition(`open ${relPath} from graph`, () => {
      setActiveRoot(rootId)
      loadTree(rootId)
      openFile(rootId, relPath)
      setShowGraph(false)
      setSidebarOpen(false)
    })
  }, [loadTree, openFile, requestDocumentTransition])

  const handleOpenFromDiagrams = useCallback((relPath: string) => {
    if (!activeRoot) return
    requestDocumentTransition(`open ${relPath} from diagrams`, () => {
      openFile(activeRoot, relPath)
      setDocumentView('diagrams')
      setShowGraph(false)
      setSidebarOpen(false)
      setMobileControlsOpen(false)
    })
  }, [activeRoot, openFile, requestDocumentTransition])

  const handleOpenGraph = useCallback(() => {
    setSidebarOpen(false)
    setMobileControlsOpen(false)
    setShowGraph(true)
  }, [])

  const handleActivitySelect = useCallback((destination: ActivityDestination) => {
    if (destination.kind === 'graph') {
      handleOpenGraph()
      return
    }

    setShowGraph(false)
    setActivityView(destination.id as PanelActivityId)
    setMobileControlsOpen(false)
    if (typeof window !== 'undefined' && window.innerWidth <= DESKTOP_BREAKPOINT) {
      setSidebarOpen(true)
    } else {
      setDesktopSidebarCollapsed(false)
    }
  }, [handleOpenGraph])

  const handleSearchFolder = useCallback((path: string) => {
    setSearch(path)
    setSidebarMode('all')
    setActivityView('files')
    setExpandedFolders((current) => {
      const next = new Set(current)
      const parts = path.split('/').filter(Boolean)
      for (let index = 1; index <= parts.length; index += 1) next.add(parts.slice(0, index).join('/'))
      return next
    })
  }, [])

  const handleOpenRecent = useCallback((note: RecentNote) => {
    if (!roots?.some((root) => root.id === note.rootId)) return
    requestDocumentTransition(`open recent note ${note.path}`, () => {
      setActiveRoot(note.rootId)
      loadTree(note.rootId)
      openFile(note.rootId, note.path)
      setSidebarOpen(false)
    })
  }, [loadTree, openFile, requestDocumentTransition, roots])

  const handleOpenWikilink = useCallback((target: string) => {
    if (!activeRoot) return
    const resolved = resolveWikilinkToPath(target, fileList)
    if (!resolved) return
    requestDocumentTransition(`follow wikilink to ${resolved}`, () => {
      openFile(activeRoot, resolved)
      setSidebarOpen(false)
    })
  }, [activeRoot, fileList, openFile, requestDocumentTransition])

  const handleOutlineHeading = useCallback((headingId: string) => {
    if (!selectedIsMarkdown || typeof window === 'undefined') return
    setDocumentView((current) => current === 'edit' ? 'preview' : current)
    setSidebarOpen(false)
    setMobileControlsOpen(false)
    // The heading may not be mounted yet: the preview pane parses markdown
    // asynchronously. Retry a few frames before giving up so a fast click
    // doesn't silently miss the scroll target.
    let attempt = 0
    const tryScroll = () => {
      const heading = document.getElementById(headingId)
      heading?.scrollIntoView({ block: 'start' })
      heading?.focus({ preventScroll: true })
      if (!heading && attempt < 20 && typeof requestAnimationFrame === 'function') {
        attempt += 1
        requestAnimationFrame(tryScroll)
      }
    }
    window.requestAnimationFrame(tryScroll)
  }, [selectedIsMarkdown])

  const focusEditor = useCallback(() => {
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }, [])

  const openCreateDialog = useCallback(() => {
    requestDocumentTransition('start a new note', () => {
      if (!activeRoot && roots?.length) {
        const fallbackRoot = preferredRootId(roots)
        if (fallbackRoot) {
          setActiveRoot(fallbackRoot)
          loadTree(fallbackRoot)
        }
      }
      setCreateStatus('idle')
      setCreateError(null)
      setShowCreate(true)
    })
  }, [activeRoot, loadTree, requestDocumentTransition, roots])

  const handleCreateFile = useCallback(async (submission: CreateNoteSubmission) => {
    const { rootId, folder, name, body } = submission
    let relPath: string
    try {
      relPath = buildNewMarkdownPath(folder, name)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Invalid file path')
      setCreateStatus('err')
      return
    }
    if (rootId === activeRoot && fileList.some((file) => file.toLowerCase() === relPath.toLowerCase())) {
      setCreateError('File already exists in this source')
      setCreateStatus('exists')
      return
    }
    setCreateStatus('creating')
    setCreateError(null)
    const result = await createFile(rootId, relPath, body)
    if (result === 'ok') {
      clearPageSessionGraphCache()
      setActiveRoot(rootId)
      await loadTree(rootId)
      setExpandedFolders((current) => {
        const next = new Set(current)
        for (const folder of ancestorFolderPaths(relPath)) next.add(folder)
        return next
      })
      setDocumentView('edit')
      setWriteMode(true)
      setShowCreate(false)
      setCreateStatus('idle')
      setSaveStatus('ok')
      setLastSavedAt(Date.now())
      if (typeof window !== 'undefined' && window.innerWidth <= DESKTOP_BREAKPOINT) setSidebarOpen(false)
      focusEditor()
      return
    }
    setCreateStatus(result === 'exists' ? 'exists' : 'err')
    setCreateError(result === 'exists' ? 'File already exists. Pick a new name or open it from the tree.' : 'Create failed')
  }, [activeRoot, createFile, fileList, focusEditor, loadTree])

  const startSideNavAction = useCallback((action: SideNavAction, parentFolder = '', targetFolder = '') => {
    setSideNavAction(action)
    setSideNavParent(parentFolder)
    setSideNavTarget(targetFolder)
    setSideNavInput(action === 'rename-folder' ? targetFolder.split('/').pop() || targetFolder : '')
    setSideNavStatus('idle')
    setSideNavError(null)
    if (parentFolder) {
      setExpandedFolders((current) => new Set(current).add(parentFolder))
    }
  }, [])

  const cancelSideNavAction = useCallback(() => {
    setSideNavAction(null)
    setSideNavParent('')
    setSideNavTarget('')
    setSideNavInput('')
    setSideNavStatus('idle')
    setSideNavError(null)
    setSideNavConfirmation(null)
  }, [])

  const submitSideNavAction = useCallback(async () => {
    if (!activeRoot || !sideNavAction || sideNavStatus === 'working') return
    setSideNavError(null)

    try {
      if (sideNavAction === 'file') {
        const relPath = buildNewMarkdownPath(sideNavParent, sideNavInput)
        if (fileList.some((file) => file.toLowerCase() === relPath.toLowerCase())) {
          throw new Error('File already exists')
        }
        setSideNavConfirmation({ action: 'create-file', path: relPath })
        return
      }

      if (sideNavAction === 'folder') {
        const relPath = joinFolderPath(sideNavParent, sideNavInput)
        if (allFolderList.some((folder) => folder.toLowerCase() === relPath.toLowerCase())) {
          throw new Error('Folder already exists')
        }
        setSideNavConfirmation({ action: 'create-folder', path: relPath })
        return
      }

      setSideNavStatus('working')
      const newName = normalizeFolderSegment(sideNavInput)
      const targetPath = sideNavTarget
      const targetParent = parentFolderPath(targetPath)
      const toRelPath = targetParent ? `${targetParent}/${newName}` : newName
      if (allFolderList.some((folder) => folder.toLowerCase() === toRelPath.toLowerCase() && folder.toLowerCase() !== targetPath.toLowerCase())) {
        throw new Error('Target folder already exists')
      }
      const result = await renameFolder(activeRoot, targetPath, toRelPath)
      if (result !== 'ok') throw new Error(result === 'exists' ? 'Target folder already exists' : 'Rename folder failed')
      clearPageSessionGraphCache()
      await loadTree(activeRoot)
      setExpandedFolders((current) => {
        const next = new Set<string>()
        for (const folder of current) {
          if (folder === targetPath || folder.startsWith(`${targetPath}/`)) {
            next.add(`${toRelPath}${folder.slice(targetPath.length)}`)
          } else {
            next.add(folder)
          }
        }
        for (const folder of ancestorFolderPaths(`${toRelPath}/placeholder.md`)) next.add(folder)
        next.add(toRelPath)
        return next
      })
      if (selectedRelPath && selectedRelPath.startsWith(`${targetPath}/`)) {
        openFile(activeRoot, `${toRelPath}${selectedRelPath.slice(targetPath.length)}`)
      }
      cancelSideNavAction()
    } catch (err) {
      setSideNavStatus('err')
      setSideNavError(err instanceof Error ? err.message : 'Action failed')
    }
  }, [activeRoot, allFolderList, cancelSideNavAction, fileList, loadTree, openFile, renameFolder, selectedRelPath, sideNavAction, sideNavInput, sideNavParent, sideNavStatus, sideNavTarget])

  const confirmSideNavAction = useCallback(async () => {
    if (!activeRoot || !sideNavConfirmation || sideNavStatus === 'working') return
    setSideNavStatus('working')
    setSideNavError(null)

    try {
      if (sideNavConfirmation.action === 'create-file') {
        const result = await createFile(activeRoot, sideNavConfirmation.path, '# Untitled\n')
        if (result !== 'ok') throw new Error(result === 'exists' ? 'File already exists' : 'Create file failed')
        clearPageSessionGraphCache()
        await loadTree(activeRoot)
        setExpandedFolders((current) => {
          const next = new Set(current)
          for (const folder of ancestorFolderPaths(sideNavConfirmation.path)) next.add(folder)
          return next
        })
        setDocumentView('edit')
        if (typeof window !== 'undefined' && window.innerWidth <= DESKTOP_BREAKPOINT) setSidebarOpen(false)
        cancelSideNavAction()
        return
      }

      if (sideNavConfirmation.action === 'create-folder') {
        const result = await createFolderApi(activeRoot, sideNavConfirmation.path)
        if (result !== 'ok') throw new Error(result === 'exists' ? 'Folder already exists' : 'Create folder failed')
        clearPageSessionGraphCache()
        await loadTree(activeRoot)
        setExpandedFolders((current) => {
          const next = new Set(current)
          for (const folder of ancestorFolderPaths(`${sideNavConfirmation.path}/placeholder.md`)) next.add(folder)
          next.add(sideNavConfirmation.path)
          return next
        })
        cancelSideNavAction()
        return
      }

      if (sideNavConfirmation.action === 'delete-file') {
        const result = await deleteFile(activeRoot, sideNavConfirmation.path)
        if (result !== 'ok') throw new Error('Delete file failed')
        clearPageSessionGraphCache()
        await loadTree(activeRoot)
        setSideNavError(null)
        setSideNavConfirmation(null)
        setSideNavStatus('idle')
        return
      }

      const result = await deleteFolderApi(activeRoot, sideNavConfirmation.path)
      if (result !== 'ok') throw new Error('Delete folder failed')
      clearPageSessionGraphCache()
      await loadTree(activeRoot)
      setExpandedFolders((current) => {
        const next = new Set<string>()
        for (const folder of current) {
          if (folder !== sideNavConfirmation.path && !folder.startsWith(`${sideNavConfirmation.path}/`)) next.add(folder)
        }
        return next
      })
      setSideNavError(null)
      cancelSideNavAction()
    } catch (err) {
      setSideNavConfirmation(null)
      setSideNavStatus('err')
      setSideNavError(err instanceof Error ? err.message : 'Action failed')
    }
  }, [activeRoot, cancelSideNavAction, createFile, createFolderApi, deleteFile, deleteFolderApi, loadTree, sideNavConfirmation, sideNavStatus])

  const cancelSideNavConfirmation = useCallback(() => {
    if (sideNavStatus !== 'working') setSideNavConfirmation(null)
  }, [sideNavStatus])

  const requestSideNavFileDelete = useCallback((targetPath: string) => {
    if (!activeRoot || !targetPath) return
    const dirtyWarning = selectedRelPath === targetPath && isDirty ? 'Unsaved changes in this note will be lost.' : undefined
    setSideNavError(null)
    setSideNavConfirmation({ action: 'delete-file', path: targetPath, warning: dirtyWarning })
  }, [activeRoot, isDirty, selectedRelPath])

  const requestSideNavFolderDelete = useCallback((folderPath: string) => {
    if (!activeRoot || !folderPath) return
    const selectedInsideFolder = selectedRelPath === folderPath || selectedRelPath?.startsWith(`${folderPath}/`)
    const selectedWarning = selectedInsideFolder ? 'The currently open note is inside this folder and will close.' : undefined
    setSideNavError(null)
    setSideNavConfirmation({ action: 'delete-folder', path: folderPath, warning: selectedWarning })
  }, [activeRoot, selectedRelPath])

  const handleDeleteFile = useCallback((relPath?: string) => {
    const targetPath = relPath || selectedRelPath || ''
    if (!activeRoot || !targetPath) return
    if (!writeMode) return
    requestSideNavFileDelete(targetPath)
  }, [activeRoot, requestSideNavFileDelete, selectedRelPath, writeMode])

  const handleToggleWriteMode = useCallback(() => {
    if (saveStatus === 'reload-required') return
    if (writeMode) {
      requestDocumentTransition('finish editing this note', () => setWriteMode(false))
      return
    }
    if (!selectedIsMarkdown) return
    setWriteMode(true)
    if (documentView === 'preview' || documentView === 'read' || documentView === 'diagrams') setDocumentView('edit')
    setMobileControlsOpen(false)
    focusEditor()
  }, [documentView, focusEditor, requestDocumentTransition, saveStatus, selectedIsMarkdown, writeMode])

  const handleSave = useCallback(async (reviewOnFailure = true): Promise<boolean> => {
    if (!writeMode || !selectedPath || !selectedIsMarkdown || content === null) return false
    const submittedContent = content
    setSaveStatus('saving')
    clearError()
    const result = await saveFile(selectedPath, submittedContent, etag ?? undefined)
    const hasNewerDraft = latestContentRef.current !== submittedContent
    if (result === 'ok') {
      clearPageSessionGraphCache()
      setSaveStatus(hasNewerDraft ? 'idle' : 'ok')
      setLastSavedAt(Date.now())
      setShowDiff(false)
      return !hasNewerDraft
    } else if (result === 'reload-required') {
      // The write committed; only the post-save verification needs reconciliation.
      clearPageSessionGraphCache()
      setSaveStatus('reload-required')
      setLastSavedAt(null)
      setShowDiff(false)
      setWriteMode(false)
      if (hasNewerDraft) setPendingDocumentTransition(null)
      return !hasNewerDraft
    } else if (result === 'conflict') {
      setSaveStatus('conflict')
      if (reviewOnFailure) setShowDiff(true)
    } else {
      setSaveStatus('err')
      if (reviewOnFailure) setShowDiff(true)
    }
    return false
  }, [writeMode, selectedPath, selectedIsMarkdown, content, etag, saveFile, clearError])

  const continuePendingDocumentTransition = useCallback(async () => {
    const transition = pendingDocumentTransition
    if (!transition) return
    setPendingDocumentTransition(null)
    await transition.run()
  }, [pendingDocumentTransition])

  const handlePendingSave = useCallback(async () => {
    const saved = await handleSave(false)
    if (saved) await continuePendingDocumentTransition()
  }, [continuePendingDocumentTransition, handleSave])

  const handlePendingDiscard = useCallback(() => {
    setContent(lastSavedContent ?? '')
    if (saveStatus !== 'reload-required') setSaveStatus('idle')
    setShowDiff(false)
    if (saveStatus !== 'reload-required') clearError()
    void continuePendingDocumentTransition()
  }, [clearError, continuePendingDocumentTransition, lastSavedContent, saveStatus, setContent])

  const handleDiscardDraft = useCallback(() => {
    setShowDiff(false)
    if (saveStatus !== 'reload-required') {
      setSaveStatus('idle')
      clearError()
    }
    if (saveStatus === 'conflict' && activeRoot && selectedRelPath) {
      openFile(activeRoot, selectedRelPath)
      return
    }
    setContent(lastSavedContent ?? '')
    focusEditor()
  }, [activeRoot, clearError, focusEditor, lastSavedContent, openFile, saveStatus, selectedRelPath, setContent])

  const draftCopyTimerRef = useRef<number | null>(null)
  const linkCopyTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (draftCopyTimerRef.current) window.clearTimeout(draftCopyTimerRef.current)
      if (linkCopyTimerRef.current) window.clearTimeout(linkCopyTimerRef.current)
    }
  }, [])
  const handleCopyDraft = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard || content === null) {
      setDraftCopyStatus('err')
      return
    }
    try {
      await navigator.clipboard.writeText(content)
      setDraftCopyStatus('ok')
    } catch {
      setDraftCopyStatus('err')
    }
    if (draftCopyTimerRef.current) window.clearTimeout(draftCopyTimerRef.current)
    draftCopyTimerRef.current = window.setTimeout(() => setDraftCopyStatus('idle'), 2000)
  }, [content])

  const handleReloadPage = useCallback(() => {
    if (typeof window !== 'undefined') window.location.reload()
  }, [])

  useEffect(() => {
    setSaveStatus('idle')
    setLastSavedAt(null)
    setShowDiff(false)
  }, [selectedPath])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return
      if (!writeMode || !selectedPath || !selectedIsMarkdown || content === null || !isDirty || saveStatus === 'saving') return
      event.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [content, handleSave, isDirty, saveStatus, selectedIsMarkdown, selectedPath, writeMode])

  const handleCopyLink = useCallback(async () => {
    if (!selectedPath || typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(buildShareUrl(selectedPath, documentView))
      setCopyStatus('ok')
    } catch {
      setCopyStatus('err')
    }
    if (linkCopyTimerRef.current) window.clearTimeout(linkCopyTimerRef.current)
    linkCopyTimerRef.current = window.setTimeout(() => setCopyStatus('idle'), 2000)
  }, [selectedPath, documentView])

  const showEditPane = (documentView === 'split' || documentView === 'edit') && selectedIsTextPreview
  const showRenderedPane = (documentView === 'split' || documentView === 'preview' || documentView === 'read' || !selectedIsTextPreview) && documentView !== 'diagrams'
  const showDiagramsPane = documentView === 'diagrams' && selectedIsMarkdown
  const isReadView = documentView === 'read'
  const mobileViewLabel = documentView === 'edit' ? 'Source' : viewLabel(documentView)
  const canSaveSelected = selectedIsMarkdown
  const editorSaveStatus = saveStatus === 'saving'
    ? 'Saving…'
    : saveStatus === 'reload-required'
      ? 'Saved — reload required'
    : saveStatus === 'conflict'
      ? 'Conflict — local draft kept'
      : saveStatus === 'err'
        ? 'Save failed — local draft kept'
        : isDirty
          ? 'Unsaved changes'
          : lastSavedAt
            ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : 'In sync'
  const documentTitle = selectedRelPath ? fileDisplayName(selectedRelPath) : 'No note selected'
  const documentStateLabel = !selectedPath
    ? 'Idle'
    : content === null
      ? 'Loading'
      : saveStatus === 'reload-required'
        ? 'Reload required'
        : isDirty
          ? 'Unsaved changes'
          : 'In sync'
  const sideNavConfirmationTitle = sideNavConfirmation?.action === 'create-file'
    ? 'Create file?'
    : sideNavConfirmation?.action === 'create-folder'
      ? 'Create folder?'
      : sideNavConfirmation?.action === 'delete-file'
        ? 'Delete file?'
        : 'Delete folder?'
  const sideNavConfirmationDescription = sideNavConfirmation?.action === 'delete-folder'
    ? 'This deletes the folder and everything inside it.'
    : sideNavConfirmation?.action === 'delete-file'
      ? 'This permanently deletes the file.'
      : 'The item will be created after you confirm.'
  const appStyle = { '--mobile-sidebar-top': `${workspaceHeaderHeight}px` } as CSSProperties

  const renderSideNavInput = (parentFolder: string, depth: number): ReactNode => {
    if (!sideNavAction || sideNavAction === 'rename-folder' || sideNavParent !== parentFolder) return null
    const style = { '--tree-indent': `${depth * 14}px` } as CSSProperties
    const label = sideNavAction === 'file' ? 'New file' : 'New folder'
    return (
      <div className="tree-inline-row" style={style}>
        <span className="file-kind">{sideNavAction === 'file' ? 'MD' : 'DIR'}</span>
        <input
          className="tree-inline-input"
          value={sideNavInput}
          onChange={(event) => setSideNavInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submitSideNavAction()
            if (event.key === 'Escape') cancelSideNavAction()
          }}
          onBlur={() => {
            if (!sideNavInput.trim()) cancelSideNavAction()
          }}
          placeholder={sideNavAction === 'file' ? 'new-note.md' : 'new-folder'}
          aria-label={label}
          autoFocus
        />
        <button type="button" className="tree-mini-action" onMouseDown={(event) => event.preventDefault()} onClick={() => void submitSideNavAction()} disabled={sideNavStatus === 'working'} aria-label={`Review ${label.toLowerCase()}`}>✓</button>
        <button type="button" className="tree-mini-action" onMouseDown={(event) => event.preventDefault()} onClick={cancelSideNavAction} aria-label={`Cancel ${label.toLowerCase()}`}>×</button>
      </div>
    )
  }

  const renderTreeNodes = (nodes: FileTreeNode[], depth = 0): ReactNode[] => {
    const rows: ReactNode[] = []
    if (depth === 0) rows.push(renderSideNavInput('', 0))

    for (const node of nodes) {
      const style = { '--tree-indent': `${depth * 14}px` } as CSSProperties

      if (node.type === 'folder') {
        const isExpanded = searchActive || expandedFolders.has(node.path) || selectedAncestors.has(node.path) || sideNavParent === node.path
        const renaming = sideNavAction === 'rename-folder' && sideNavTarget === node.path
        rows.push(
          <details
            key={node.path}
            className="tree-node tree-node-folder"
            open={isExpanded}
            onToggle={(event) => {
              const isOpen = event.currentTarget.open
              setExpandedFolders((current) => {
                const next = new Set(current)
                if (isOpen) {
                  next.add(node.path)
                } else {
                  next.delete(node.path)
                }
                return next
              })
            }}
          >
            <summary
              className={`tree-item tree-folder ${isExpanded ? 'expanded' : ''}`}
              style={style}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name} folder, ${node.fileCount} files`}
              title={node.path}
            >
              <span className="folder-caret">{isExpanded ? '▾' : '▸'}</span>
              <span className={`folder-icon folder-tone-${folderTone(node.path)}`} aria-hidden="true"><FolderIcon /></span>
              {renaming ? (
                <input
                  className="tree-inline-input rename-input"
                  value={sideNavInput}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setSideNavInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submitSideNavAction()
                    if (event.key === 'Escape') cancelSideNavAction()
                  }}
                  aria-label={`Rename ${node.name} folder`}
                  autoFocus
                />
              ) : (
                <>
                  <span className="tree-label folder-label">{node.name}</span>
                  <span className="folder-count">{node.fileCount}</span>
                  <span className="tree-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <button type="button" className="tree-action-btn" title="New file" aria-label={`New file in ${node.path}`} onClick={() => startSideNavAction('file', node.path)}>＋</button>
                    <button type="button" className="tree-action-btn tree-folder-create-btn" title="New folder" aria-label={`New folder in ${node.path}`} onClick={() => startSideNavAction('folder', node.path)}><FolderPlusIcon /></button>
                    <button type="button" className="tree-action-btn" title="Rename folder" aria-label={`Rename ${node.path}`} onClick={() => startSideNavAction('rename-folder', parentFolderPath(node.path), node.path)}>✎</button>
                    <button type="button" className="tree-action-btn danger" title="Delete folder" aria-label={`Delete ${node.path}`} onClick={() => requestSideNavFolderDelete(node.path)}>×</button>
                  </span>
                </>
              )}
            </summary>
            {isExpanded ? <div className="tree-children">{renderSideNavInput(node.path, depth + 1)}{renderTreeNodes(node.children, depth + 1)}</div> : null}
          </details>
        )
        continue
      }

      const fullPath = `${activeRoot}/${node.path}`
      const isActive = selectedPath === fullPath
      const kind = fileKind(node.path)
      rows.push(
        <div
          key={node.path}
          role="button"
          tabIndex={0}
          aria-current={isActive ? 'page' : undefined}
          className={`tree-item tree-file ${isActive ? 'active' : ''}`}
          style={style}
          title={node.path}
          onClick={() => handleOpenFromTree(node.path)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            handleOpenFromTree(node.path)
          }}
        >
          <span className={`file-kind file-kind-${kind}`}>{fileKindLabel(node.path)}</span>
          <span className="tree-label">{fileDisplayName(node.path)}</span>
          <span className="tree-actions file-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <button type="button" className="tree-action-btn danger" title={isMarkdownFile(node.path) ? 'Delete file' : 'Delete is only enabled for markdown files'} aria-label={`Delete ${node.path}`} disabled={!isMarkdownFile(node.path)} onClick={() => requestSideNavFileDelete(node.path)}>×</button>
          </span>
        </div>
      )
    }

    return rows
  }

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''} ${desktopSidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={appStyle}>
      <aside id="file-sidebar" className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}>
        <ActivityNavigation active={showGraph ? 'graph' : activityView} variant="rail" onSelect={handleActivitySelect}>
          <button
            type="button"
            className={`desktop-only sidebar-collapse-btn ${desktopSidebarCollapsed ? 'active' : ''}`}
            aria-label={desktopSidebarCollapsed ? 'Expand file sidebar' : 'Collapse file sidebar'}
            aria-expanded={!desktopSidebarCollapsed}
            aria-controls="file-sidebar"
            title={desktopSidebarCollapsed ? 'Expand file sidebar' : 'Collapse file sidebar'}
            onClick={() => setDesktopSidebarCollapsed((collapsed) => !collapsed)}
          >
            {desktopSidebarCollapsed ? '›' : '‹'}
          </button>
        </ActivityNavigation>
        <div className="sidebar-panel">
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <div className="brand-lockup">
              <div className="brand-mark" aria-hidden="true">MD</div>
              <div>
                <h1>MD Ops</h1>
                <p>Files · Markdown operations</p>
              </div>
            </div>
            <button type="button" className="mobile-only sidebar-close" aria-label="Close file sidebar" onClick={() => setSidebarOpen(false)}>✕</button>
          </div>
          <div className="sidebar-status-row">
            <div className={`health ${health === 'ok' ? 'health-ok' : health === 'checking' ? 'health-checking' : 'health-err'}`}>
              <span aria-hidden="true" />
              {health === 'ok' ? 'Healthy' : health === 'checking' ? 'Checking' : 'Unreachable'}
            </div>
            <div className="sidebar-counts">
              <span>{fileList.length} files</span>
              <span>{allFolderList.length} folders</span>
            </div>
          </div>
        </div>

        <details className="roots root-picker">
          <summary className="root-picker-summary">
            <span className="root-picker-kicker">Source</span>
            <span className="root-label">{activeRootConfig ? displayRootLabel(activeRootConfig) : 'Choose source'}</span>
            <span className="root-id">{activeRootConfig ? displayRootMeta(activeRootConfig) : 'No root selected'}</span>
          </summary>
          <div className="root-picker-menu">
            {(roots || []).map((r) => (
              <button
                key={r.id}
                type="button"
                className={`root-btn ${activeRoot === r.id ? 'active' : ''}`}
                onClick={() => handleSelectRoot(r.id)}
              >
                <span className="root-label">{displayRootLabel(r)}</span>
                <span className="root-id">{displayRootMeta(r)}</span>
              </button>
            ))}
          </div>
        </details>

        {activityView === 'files' ? <SidebarNavigation
          mode={sidebarMode}
          onModeChange={setSidebarMode}
          recentNotes={visibleRecentNotes}
          rootLabel={recentRootLabel}
          onOpenRecent={handleOpenRecent}
          pinned={(
            <div className="quick-links" aria-label="Pinned files and folders">
              <span className="quick-links-label">Quick access</span>
              {quickLinks.map(({ label, path, rootHint, readView }) => (
                <button key={path} type="button" className="quick-link" onClick={() => handleQuickLink(path, rootHint, readView)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          all={(
            <>
              <section className="mobile-quick-access" aria-label="Quick access">
                <span className="mobile-quick-access-label">Quick access</span>
                <div className="mobile-quick-access-links">
                  {quickLinks.slice(0, 3).map(({ label, path, rootHint, readView }) => (
                    <button key={path} type="button" className="mobile-quick-access-link" onClick={() => handleQuickLink(path, rootHint, readView)}>
                      {label}
                    </button>
                  ))}
                </div>
              </section>
              <input
                type="text"
                className="search"
                aria-label="Search files and folders"
                placeholder="Search files/folders…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <div className="explorer-bar">
                <span>Explorer</span>
                <div className="explorer-actions" aria-label="Explorer actions">
                  <button type="button" className="tree-action-btn" onClick={() => setExpandedFolders(new Set(allFolderList))} disabled={allFolderList.length === 0} title="Expand all folders" aria-label="Expand all folders">⊞</button>
                  <button type="button" className="tree-action-btn" onClick={() => setExpandedFolders(new Set())} disabled={!expandedFolders.size} title="Collapse all folders" aria-label="Collapse all folders">⊟</button>
                  <button type="button" className="tree-action-btn" onClick={() => startSideNavAction('file', selectedRelPath ? parentFolderPath(selectedRelPath) : '')} disabled={!activeRoot} title="New file" aria-label="New file">＋</button>
                  <button type="button" className="tree-action-btn tree-folder-create-btn" onClick={() => startSideNavAction('folder', selectedRelPath ? parentFolderPath(selectedRelPath) : '')} disabled={!activeRoot} title="New folder" aria-label="New folder"><FolderPlusIcon /></button>
                </div>
              </div>
              {sideNavError ? <div className="tree-inline-error">{sideNavError}</div> : null}

              <div className="tree" aria-label="File tree">
                {fileTree.length > 0 || sideNavAction ? renderTreeNodes(fileTree) : (
                  <div className="tree-empty">
                    <strong>{searchActive ? 'No matches' : 'No files'}</strong>
                    <span>{searchActive ? search : activeRootLabel}</span>
                  </div>
                )}
              </div>
            </>
          )}
        /> : null}

        {activityView === 'search' ? (
          <section className="activity-panel" aria-label="Current source search">
            <header className="activity-panel-header">
              <span>Current source</span>
              <h2>Search</h2>
              <p>{activeRoot ? `Find files and folders in ${activeRootLabel}.` : 'Choose a source to search.'}</p>
            </header>
            <input
              type="search"
              className="activity-search-input"
              aria-label="Search current source files and folders"
              placeholder="File or folder name…"
              value={activitySearch}
              onChange={(event) => setActivitySearch(event.target.value)}
              disabled={!activeRoot}
            />
            <div className="activity-result-status" role="status">
              {activitySearch.trim() ? `${rootSearchResults.length} ${rootSearchResults.length === 1 ? 'match' : 'matches'}` : 'Type a file or folder name.'}
            </div>
            <div className="activity-result-list" aria-label="Search results">
              {rootSearchResults.slice(0, 100).map((result) => (
                <button
                  key={`${result.kind}:${result.path}`}
                  type="button"
                  className="activity-result"
                  onClick={() => result.kind === 'file' ? handleOpenFromTree(result.path) : handleSearchFolder(result.path)}
                  aria-label={`${result.kind === 'file' ? 'Open file' : 'Show folder'} ${result.path}`}
                >
                  <span className="activity-result-kind">{result.kind === 'file' ? fileKindLabel(result.path) : 'DIR'}</span>
                  <span><strong>{result.name}</strong><small>{result.path}</small></span>
                </button>
              ))}
              {activitySearch.trim() && rootSearchResults.length === 0 ? (
                <div className="activity-empty"><strong>No matches</strong><span>Try a shorter file or folder name.</span></div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activityView === 'outline' ? (
          <section className="activity-panel" aria-label="Document outline">
            <header className="activity-panel-header">
              <span>Current note</span>
              <h2>Outline</h2>
              <p>{selectedIsMarkdown ? selectedDisplayPath : 'No Markdown note selected.'}</p>
            </header>
            {!selectedIsMarkdown ? (
              <div className="activity-empty"><strong>Outline unavailable</strong><span>Select a Markdown note to list its headings.</span></div>
            ) : content === null ? (
              <div className="activity-empty"><strong>Loading outline</strong><span>The selected note is still loading.</span></div>
            ) : outlineHeadings.length ? (
              <div className="outline-list">
                {outlineHeadings.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    className="outline-item"
                    style={{ '--outline-depth': heading.depth } as CSSProperties}
                    title={`Line ${heading.line}: ${heading.text}`}
                    onClick={() => handleOutlineHeading(heading.id)}
                  >
                    <span>H{heading.depth}</span>
                    <strong>{heading.text}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <div className="activity-empty"><strong>No headings</strong><span>Add a Markdown heading to create an outline.</span></div>
            )}
          </section>
        ) : null}

        {activityView === 'links' ? (
          <section className="activity-panel" aria-label="Note links">
            <header className="activity-panel-header">
              <span>Current note</span>
              <h2>Links</h2>
              <p>{selectedIsMarkdown ? selectedDisplayPath : 'No Markdown note selected.'}</p>
            </header>
            {!selectedIsMarkdown ? (
              <div className="activity-empty"><strong>Links unavailable</strong><span>Select a Markdown note to inspect its wikilinks.</span></div>
            ) : content === null ? (
              <div className="activity-empty"><strong>Loading links</strong><span>The selected note is still loading.</span></div>
            ) : (
              <div className="links-panel-content">
                <section aria-labelledby="outgoing-links-heading">
                  <div className="activity-section-title"><h3 id="outgoing-links-heading">Outgoing</h3><span>{wikilinks.length}</span></div>
                  {wikilinks.length ? (
                    <div className="activity-result-list">
                      {visibleWikilinks.map((link, index) => {
                        const resolved = resolveWikilinkToPath(link.target, fileList)
                        return (
                          <button
                            key={`${link.raw}-${index}`}
                            type="button"
                            className={`activity-result link-result ${resolved ? '' : 'unresolved'}`}
                            onClick={() => resolved && handleOpenWikilink(link.target)}
                            disabled={!resolved}
                            aria-label={resolved ? `Open linked note ${resolved}` : `Unresolved link ${link.target}`}
                          >
                            <span className="activity-result-kind">LINK</span>
                            <span><strong>{link.alias || link.target}</strong><small>{resolved || 'Unresolved in current source'}</small></span>
                          </button>
                        )
                      })}
                    </div>
                  ) : <div className="activity-empty compact"><span>No outgoing wikilinks.</span></div>}
                  {wikilinks.length > visibleWikilinks.length ? (
                    <div className="activity-result-status">Showing first {visibleWikilinks.length} of {wikilinks.length} links.</div>
                  ) : null}
                </section>
                <section className="backlinks-unavailable" aria-labelledby="backlinks-heading">
                  <div className="activity-section-title"><h3 id="backlinks-heading">Backlinks</h3><span>Unavailable</span></div>
                  <p>MD Ops has not loaded the content of other Markdown notes. Backlinks cannot be computed safely from filenames alone.</p>
                </section>
              </div>
            )}
          </section>
        ) : null}

        {activityView === 'diagrams' && activeRoot ? (
          <DiagramsPanel root={activeRoot} onOpenNote={handleOpenFromDiagrams} />
        ) : activityView === 'diagrams' ? (
          <section className="activity-panel" aria-label="All mermaid diagrams">
            <header className="activity-panel-header">
              <span>Workspace</span>
              <h2>Diagrams</h2>
              <p>Select a source to browse its diagrams.</p>
            </header>
            <div className="activity-empty"><strong>No source selected</strong><span>Choose a source above to see its mermaid diagrams.</span></div>
          </section>
        ) : null}

        {activityView === 'files' ? <footer className="drawer-footer" aria-label="File actions">
          <div className="drawer-footer-actions">
            <button type="button" className="drawer-footer-btn primary" onClick={openCreateDialog} disabled={!activeRoot}>
              <span aria-hidden="true">＋</span>
              New note
            </button>
            <button
              type="button"
              className="drawer-footer-btn"
              onClick={() => startSideNavAction('folder', selectedRelPath ? parentFolderPath(selectedRelPath) : '')}
              disabled={!activeRoot}
            >
              <FolderPlusIcon />
              New folder
            </button>
          </div>
          <button
            type="button"
            className={`drawer-write-state ${writeMode ? 'active' : ''}`}
            onClick={handleToggleWriteMode}
            aria-pressed={writeMode}
            disabled={!selectedIsMarkdown || saveStatus === 'reload-required'}
            title="Controls document editing only; Explorer file management remains available"
          >
            <span aria-hidden="true">{writeMode ? '✎' : '⌑'}</span>
            {saveStatus === 'reload-required' ? 'Reload needed' : writeMode ? 'Write on' : 'Read only'}
            <small>{saveStatus === 'reload-required' ? 'Version check required' : writeMode ? 'Editing enabled' : 'Tap to enable editing'}</small>
          </button>
        </footer> : null}
        </div>
      </aside>
      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file sidebar"
        title="Drag to resize sidebar"
        onPointerDown={startSidebarDrag}
        onDoubleClick={() => { setSidebarWidth(280); localStorage.setItem('mdops.sidebarWidth', '280') }}
      />
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close file sidebar"
        onClick={() => setSidebarOpen(false)}
      />

      <main className="main">
        <header className="workspace-header" ref={workspaceHeaderRef}>
          <div className="document-heading">
            <button
              type="button"
              className={`toolbar-btn mobile-only mobile-files-toggle ${activityView === 'files' ? 'active' : ''}`}
              aria-expanded={sidebarOpen}
              aria-controls="file-sidebar"
              data-active={activityView === 'files'}
              onClick={() => {
                setActivityView('files')
                setSidebarOpen((open) => !open)
              }}
            >
              Files
            </button>
            <div className="document-title-block">
              <div className="document-kicker">
                <span>{activeRootLabel}</span>
                {selectedFolder ? <span title={selectedFolder}>{selectedFolder}</span> : null}
              </div>
              <h2 title={selectedDisplayPath || 'Select a note'}>{documentTitle}</h2>
              <div className="document-meta-row">
                <span className={`meta-pill ${selectedKind ? `file-kind-${selectedKind}` : ''}`}>{selectedKind ? fileKindLabel(selectedRelPath || '') : 'NONE'}</span>
                <span className={`meta-pill state-${isDirty ? 'dirty' : selectedPath ? 'clean' : 'idle'}`} title={isDirty ? "You have edits not yet saved — tap the Save button to persist them." : selectedPath ? "No pending changes." : "No note selected."}>{documentStateLabel}</span>
                <span className="meta-pill">{documentStats.lines} lines</span>
                <span className="meta-pill">{documentStats.words} words</span>
                {etagPreview ? <span className="meta-pill mono">etag {etagPreview}</span> : null}
              </div>
            </div>
            <div className="mobile-only mobile-header-actions" aria-label="Note actions">
              <button
                type="button"
                className="toolbar-btn primary mobile-new-note"
                onClick={openCreateDialog}
                disabled={!activeRoot}
                aria-label="Create new note"
              >
                <span className="mobile-new-note-symbol" aria-hidden="true">+</span>
                <span className="mobile-new-note-label">New Note</span>
              </button>
              <button
                type="button"
                className={`toolbar-btn mobile-write-toggle ${writeMode ? 'active' : ''}`}
                onClick={handleToggleWriteMode}
                aria-pressed={writeMode}
                disabled={!selectedIsMarkdown || saveStatus === 'reload-required'}
              >
                {saveStatus === 'reload-required' ? 'Reload' : writeMode ? 'Done' : 'Edit'}
              </button>
              <button
                type="button"
                className={`toolbar-btn mobile-controls-toggle ${mobileControlsOpen ? 'active' : ''}`}
                aria-label={`Choose document view; current view ${mobileViewLabel}`}
                aria-expanded={mobileControlsOpen}
                aria-controls="document-toolbar"
                onClick={() => setMobileControlsOpen((open) => !open)}
              >
                <span className="mobile-controls-label">View</span>
                <span className="mobile-controls-summary">{mobileViewLabel}</span>
              </button>
            </div>
          </div>

          <div id="document-toolbar" className={`toolbar ${mobileControlsOpen ? 'mobile-controls-open' : ''}`} aria-label="Document controls">
            <button type="button" className="toolbar-btn primary new-file-btn" onClick={openCreateDialog} disabled={!activeRoot}>
              New Note
            </button>
            <div className="view-tabs" aria-label="Document view">
              {documentViews.map((view) => (
                <button
                  key={view}
                  type="button"
                  className={`view-tab ${documentView === view ? 'active' : ''}`}
                  onClick={() => setDocumentView(view)}
                  aria-pressed={documentView === view}
                  title={view === 'split' ? 'Source and preview' : view === 'edit' ? 'Source only' : view === 'preview' ? 'Preview only' : view === 'read' ? 'Reading view' : 'Mermaid diagrams only'}
                >
                  {viewLabel(view)}
                </button>
              ))}
            </div>
            <button type="button" className={`toolbar-btn write-toggle ${writeMode ? 'active' : ''}`} onClick={handleToggleWriteMode} aria-pressed={writeMode} aria-label={saveStatus === 'reload-required' ? 'Reload latest before editing' : writeMode ? 'Finish editing' : 'Start writing'} title="Controls document editing only; Explorer file management remains available" disabled={!selectedIsMarkdown || saveStatus === 'reload-required'}>
              {saveStatus === 'reload-required' ? 'Reload needed' : writeMode ? 'Done writing' : 'Start writing'}
            </button>
            <details className="toolbar-menu">
              <summary className="toolbar-btn ghost">More</summary>
              <div className="toolbar-menu-panel toolbar-menu-panel-right" role="menu" aria-label="File actions">
                <button type="button" role="menuitem" className="toolbar-menu-item" onClick={handleOpenGraph} title="Open the system graph view">Graph</button>
                <button type="button" role="menuitem" className="toolbar-menu-item" onClick={handleCopyLink} disabled={!selectedPath} title="Copy a shareable link to this note">
                  {copyStatus === 'ok' ? 'Link Copied' : copyStatus === 'err' ? 'Copy Failed' : 'Copy Link'}
                </button>
                <button type="button" role="menuitem" className="toolbar-menu-item" onClick={() => setShowDiff(true)} disabled={!isDirty} title="Open a diff of your unsaved edits">Review changes</button>
                <button type="button" role="menuitem" className="toolbar-menu-item danger" onClick={() => void handleDeleteFile()} disabled={!writeMode || !selectedRelPath || !selectedIsMarkdown} title="Permanently delete this note (write mode required)">Delete File</button>
              </div>
            </details>
            <div className="theme-picker-anchor">
              <button
                type="button"
                className={`toolbar-btn ghost theme-settings-btn ${settingsOpen ? 'active' : ''}`}
                aria-label="Appearance settings"
                aria-expanded={settingsOpen}
                title="Theme, reading width and size"
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <span className={`theme-dot theme-dot-${uiSettings.theme}`} aria-hidden="true" />
                Appearance
              </button>
              {settingsOpen ? <ThemePicker settings={uiSettings} onChange={handleUiSettingsChange} onClose={() => setSettingsOpen(false)} /> : null}
            </div>
            <button type="button" className="save-btn" title={!writeMode ? "Tap 'Start writing' to enable saving" : 'Save note'} disabled={!writeMode || !selectedPath || !canSaveSelected || !isDirty || saveStatus === 'saving' || saveStatus === 'reload-required'} onClick={() => void handleSave()}>
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'ok' ? 'Saved ✓' : saveStatus === 'reload-required' ? 'Reload needed' : saveStatus === 'conflict' ? 'Conflict' : 'Save'}
            </button>
          </div>
        </header>

        {!writeMode && selectedIsMarkdown && saveStatus !== 'reload-required' ? (
          <div className="editor-mode-notice" role="status">
            <span>Viewing only</span>
            <button type="button" onClick={handleToggleWriteMode}>Edit this note</button>
          </div>
        ) : null}
        {saveStatus === 'reload-required' ? (
          <div className="banner err save-reconcile-banner" role="alert">
            <span>{error ?? 'The save reached the server, but MD Ops needs a fresh version before editing can continue.'}</span>
            <div className="save-reconcile-actions">
              <button type="button" onClick={() => void handleCopyDraft()}>
                {draftCopyStatus === 'ok' ? 'Draft copied' : draftCopyStatus === 'err' ? 'Copy unavailable' : 'Copy current draft'}
              </button>
              <button type="button" onClick={handleReloadPage}>Reload latest</button>
            </div>
          </div>
        ) : error && saveStatus !== 'conflict' && saveStatus !== 'err' ? <div className="banner err">{error}</div> : null}

        <CreateNoteDialog
          open={showCreate}
          roots={(roots ?? []).map((root) => ({ id: root.id, label: displayRootLabel(root) }))}
          folders={folderOptions}
          currentRootId={activeRoot}
          currentFolder={selectedFolder}
          existingFiles={activeRoot ? fileList.map((file) => `${activeRoot}/${file}`) : []}
          busy={createStatus === 'creating'}
          error={createError}
          onClose={() => {
            if (createStatus === 'creating') return
            setShowCreate(false)
            setCreateError(null)
            setCreateStatus('idle')
          }}
          onSubmit={(submission) => void handleCreateFile(submission)}
        />

        <div className="editor-wrap">
          {!selectedPath ? (
            <div className="empty">
              <div className="empty-panel mobile-empty-panel">
                <div className="empty-kicker">{activeRootLabel}</div>
                <h2>Ready for markdown ops</h2>
                <div className="empty-meta-grid">
                  <div>
                    <strong>{treeLoading ? '…' : fileList.length}</strong>
                    <span>{treeLoading ? 'Loading files…' : 'Files indexed'}</span>
                  </div>
                  <div>
                    <strong>{allFolderList.length}</strong>
                    <span>Folders</span>
                  </div>
                  <div>
                    <strong>{quickLinks.length}</strong>
                    <span>Pinned paths</span>
                  </div>
                </div>
                <div className="empty-actions">
                  <button type="button" className="toolbar-btn primary mobile-only" onClick={() => setSidebarOpen(true)}>Browse Files</button>
                  <button type="button" className="toolbar-btn primary" onClick={openCreateDialog} disabled={!activeRoot}>New Note</button>
                  <button type="button" className="toolbar-btn ghost" onClick={handleOpenGraph}>Graph</button>
                </div>
                <div className="empty-quick-links">
                  {quickLinks.slice(0, 6).map(({ label, path, rootHint }) => (
                    <button key={path} type="button" onClick={() => handleQuickLink(path, rootHint)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {showEditPane ? (
                <div className={`pane edit-pane ${selectedIsMarkdown ? 'rich-editor-pane' : ''}`}>
                  {selectedIsMarkdown ? (
                    <RichMarkdownEditor
                      ref={editorRef}
                      value={content ?? ''}
                      onChange={setContent}
                      readOnly={!writeMode || content === null}
                      ariaLabel={`Edit ${documentTitle}`}
                      title={writeMode ? 'Markdown editor' : 'Markdown preview'}
                      isDirty={isDirty}
                      saveStatus={editorSaveStatus}
                      onSave={isDirty && writeMode ? () => void handleSave() : undefined}
                      onShowChanges={isDirty ? () => setShowDiff(true) : undefined}
                    />
                  ) : (
                    <>
                      <div className="pane-header">
                        <div>
                          <span className="pane-kicker">Source</span>
                          <strong>Text preview</strong>
                        </div>
                        <span>{documentStats.chars} chars</span>
                      </div>
                      <textarea className="editor" value={content ?? ''} readOnly spellCheck={false} aria-label={`Preview ${documentTitle}`} />
                    </>
                  )}
                </div>
              ) : null}

              {showDiagramsPane && (
                <div className="pane diagrams-pane">
                  <div className="pane-header">
                    <div>
                      <span className="pane-kicker">Diagrams</span>
                      <strong>{mermaidBlocks.length === 1 ? '1 mermaid diagram' : `${mermaidBlocks.length} mermaid diagrams`}</strong>
                    </div>
                    <span>Rendered only</span>
                  </div>
                  <div className="diagrams-list">
                    {mermaidBlocks.length === 0 ? (
                      <div className="preview-empty">
                        <strong>No mermaid diagrams</strong>
                        <span>This note has no ```mermaid code blocks to render.</span>
                      </div>
                    ) : (
                      mermaidBlocks.map((block, index) => (
                        <div key={`${block.startLine}-${index}`} className="diagram-block">
                          <div className="diagram-block-head">
                            <span>Diagram {index + 1}</span>
                            <span className="diagram-block-line">line {block.startLine}</span>
                          </div>
                          <Suspense fallback={<div className="mermaid-diagram" data-role="mermaid-diagram-loading" />}>
                            <MermaidDiagram
                              source={block.source}
                              downloadName={mermaidExportFilename(selectedRelPath, block.startLine)}
                              exportLabel={`Diagram ${index + 1} at line ${block.startLine}`}
                            />
                          </Suspense>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {showRenderedPane && (
                <div className={`pane preview-pane ${isReadView ? 'read-pane' : ''}`}>
                <div className="pane-header">
                  <div>
                    <span className="pane-kicker">{isReadView ? 'Read' : 'Preview'}</span>
                    <strong>{selectedIsImage ? 'Image preview' : selectedIsMarkdown ? (isReadView ? 'Focused reading' : 'Rendered markdown') : selectedIsTextPreview ? 'Raw file preview' : 'File details'}</strong>
                  </div>
                  <span>{selectedIsMarkdown ? `${wikilinks.length} links · ${noteTags.length} tags` : selectedKind ? fileKindLabel(selectedRelPath || '') : 'File'}</span>
                </div>
                <div className="preview">
                  {contentLoading ? (
                    <div className="preview-skeleton" role="status" aria-label="Loading note">
                      <div className="skeleton-line skeleton-line-lg" />
                      <div className="skeleton-line" />
                      <div className="skeleton-line" />
                      <div className="skeleton-line skeleton-line-short" />
                      <div className="skeleton-line" />
                      <div className="skeleton-line" />
                      <div className="skeleton-line skeleton-line-short" />
                    </div>
                  ) : null}
                  {selectedIsMarkdown && parsed.frontmatter ? (
                    <details className="frontmatter-block">
                      <summary>Frontmatter · {parsed.frontmatter.split(/\r\n|\r|\n/).length} lines</summary>
                      <pre>{parsed.frontmatter}</pre>
                    </details>
                  ) : null}

                  {selectedIsMarkdown && wikilinks.length > 0 ? (
                    <div className="wikilink-bar">
                      <div className="section-header-row">
                        <strong>Links in note</strong>
                        <button type="button" className="section-toggle-btn" onClick={() => setShowWikilinks((v) => !v)}>
                          {showWikilinks ? 'Hide' : `Show (${wikilinks.length})`}
                        </button>
                      </div>
                      {showWikilinks ? (
                        <div className="wikilink-list">
                          {visibleWikilinks.map((link, index) => {
                            const resolved = resolveWikilinkToPath(link.target, fileList)
                            return (
                              <button
                                key={`${link.raw}-${index}`}
                                type="button"
                                className={`wikilink-chip ${resolved ? '' : 'unresolved'}`}
                                onClick={() => resolved && handleOpenWikilink(link.target)}
                                disabled={!resolved}
                                title={resolved ? `Open ${resolved}` : 'Unresolved wikilink'}
                              >
                                {link.alias || link.target}
                                {!resolved ? ' · unresolved' : ''}
                              </button>
                            )
                          })}
                        </div>
                      ) : null}
                      {wikilinks.length > visibleWikilinks.length ? (
                        <span className="wikilink-limit">Showing first {visibleWikilinks.length} of {wikilinks.length} links.</span>
                      ) : null}
                    </div>
                  ) : null}

                  {selectedIsImage ? (
                    <div className="binary-preview image-file-preview">
                      <img src={selectedAssetUrl} alt={selectedDisplayPath} loading="lazy" />
                      <a href={selectedAssetUrl} target="_blank" rel="noreferrer">Open image in new tab</a>
                    </div>
                  ) : selectedIsMarkdown && hasRenderedMarkdown ? (
                    <MarkdownDocument
                      markdown={renderedMarkdown}
                      fileList={fileList}
                      activeRoot={activeRoot}
                      selectedRelPath={selectedRelPath}
                      onOpenWikilink={handleOpenWikilink}
                    />
                  ) : selectedIsTextPreview ? (
                    <pre className="raw-file-preview">{content ?? ''}</pre>
                  ) : selectedRelPath && !contentLoading ? (
                    <div className="preview-empty binary-preview">
                      <strong>File is visible, preview is not enabled yet</strong>
                      <span>{selectedDisplayPath}</span>
                      <span>Inline preview currently supports Markdown, common text/code/data files, and raster images.</span>
                    </div>
                  ) : contentLoading ? null : (
                    <div className="preview-empty">
                      <strong>Empty note</strong>
                      <span>Nothing to render yet.</span>
                    </div>
                  )}

                  {selectedIsMarkdown && noteTags.length > 0 ? (
                    <div className="tag-bar">
                      <strong>Tags</strong>
                      <div className="tag-list">
                        {noteTags.map((tag) => (
                          <span key={tag} className="tag-chip">#{tag}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              )}
            </>
          )}
        </div>

        {showGraph && (
          <Suspense fallback={null}>
            <SystemGraph activeRoot={activeRoot || preferredRootId(roots)} activeDocumentPath={selectedIsMarkdown ? selectedPath : null} roots={roots} onClose={() => setShowGraph(false)} onOpenFile={handleOpenFromGraph} />
          </Suspense>
        )}
      </main>
      <ActivityNavigation active={showGraph ? 'graph' : activityView} variant="mobile" onSelect={handleActivitySelect} />
      <UnsavedChangesDialog
        open={Boolean(pendingDocumentTransition && isDirty)}
        title={saveStatus === 'reload-required' ? 'Reload required before another save' : 'Save your work before continuing?'}
        reason={saveStatus === 'reload-required'
          ? `The server accepted the submitted version, but newer edits are still local. Copy them before reloading, or explicitly discard them before you ${pendingDocumentTransition?.reason ?? 'continue'}.`
          : `You have unsaved edits. Choose what to do before you ${pendingDocumentTransition?.reason ?? 'continue'}.`}
        original={lastSavedContent ?? ''}
        current={content ?? ''}
        saveState={saveStatus}
        saveDisabled={saveStatus === 'reload-required'}
        conflict={saveStatus === 'conflict' ? 'The server copy changed. Your local draft is still safe here.' : null}
        error={saveStatus === 'reload-required'
          ? (error ?? 'Reload the latest version before saving again.')
          : saveStatus === 'err'
            ? (error ?? 'Saving failed. Your local draft is still safe here.')
            : null}
        onSave={handlePendingSave}
        onDiscard={handlePendingDiscard}
        onStay={() => {
          setPendingDocumentTransition(null)
          if (saveStatus !== 'reload-required') {
            setSaveStatus('idle')
            clearError()
          }
          focusEditor()
        }}
        onCopyDraft={handleCopyDraft}
        saveLabel={saveStatus === 'reload-required' ? 'Reload required' : 'Save and continue'}
        discardLabel={saveStatus === 'reload-required' ? 'Discard newer edits and continue' : 'Discard and continue'}
        stayLabel={saveStatus === 'reload-required' ? 'Keep local draft' : 'Keep editing'}
        reviewLabel={saveStatus === 'reload-required' ? 'Reconciliation required' : 'Unsaved work'}
      />
      <UnsavedChangesDialog
        open={Boolean(showDiff && isDirty && selectedPath && !pendingDocumentTransition)}
        title={saveStatus === 'reload-required' ? 'Reload required before another save' : saveStatus === 'conflict' ? 'Resolve save conflict' : 'Review your changes'}
        reason={saveStatus === 'reload-required'
          ? 'The submitted version reached the server, but this newer local draft has not. Copy it, close this review, and reload the latest version before reconciling.'
          : saveStatus === 'conflict'
            ? 'The server copy changed after you opened this note. Copy your draft, retry, or explicitly reload the latest copy.'
            : 'Compare the current draft with the last saved version before saving or discarding it.'}
        original={lastSavedContent ?? ''}
        current={content ?? ''}
        saveState={saveStatus}
        saveDisabled={saveStatus === 'reload-required'}
        conflict={saveStatus === 'conflict' ? 'Nothing was overwritten. Your local draft remains in the editor.' : null}
        error={saveStatus === 'reload-required'
          ? (error ?? 'Reload the latest version before saving again.')
          : saveStatus === 'err'
            ? (error ?? 'Saving failed. Your local draft remains in the editor.')
            : null}
        onSave={async () => { await handleSave(false) }}
        onDiscard={handleDiscardDraft}
        onStay={() => {
          setShowDiff(false)
          if (saveStatus !== 'conflict' && saveStatus !== 'err' && saveStatus !== 'reload-required') setSaveStatus('idle')
          focusEditor()
        }}
        onCopyDraft={handleCopyDraft}
        saveLabel={saveStatus === 'reload-required' ? 'Reload required' : saveStatus === 'conflict' ? 'Try saving again' : 'Save changes'}
        discardLabel={saveStatus === 'reload-required' ? 'Discard newer edits' : saveStatus === 'conflict' ? 'Reload latest' : 'Discard draft'}
        stayLabel={saveStatus === 'reload-required' ? 'Keep local draft' : 'Back to editor'}
        reviewLabel={saveStatus === 'reload-required' ? 'Reconciliation required' : 'Change review'}
      />
      {sideNavConfirmation ? (
        <div className="side-nav-confirm-overlay">
          <section
            className="side-nav-confirm-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="side-nav-confirm-title"
            aria-describedby="side-nav-confirm-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancelSideNavConfirmation()
              if (event.key === 'Tab' && sideNavStatus !== 'working') {
                event.preventDefault()
                const nextFocus = event.target === sideNavCancelRef.current ? sideNavConfirmRef : sideNavCancelRef
                nextFocus.current?.focus()
              }
            }}
          >
            <h2 id="side-nav-confirm-title">{sideNavConfirmationTitle}</h2>
            <p id="side-nav-confirm-description">{sideNavConfirmationDescription}</p>
            <code>{sideNavConfirmation.path}</code>
            {sideNavConfirmation.warning ? <p className="side-nav-confirm-warning">{sideNavConfirmation.warning}</p> : null}
            <div className="side-nav-confirm-actions">
              <button ref={sideNavCancelRef} type="button" className="diff-btn ghost" onClick={cancelSideNavConfirmation} disabled={sideNavStatus === 'working'} autoFocus>Cancel</button>
              <button ref={sideNavConfirmRef} type="button" className="save-btn danger" onClick={() => void confirmSideNavAction()} disabled={sideNavStatus === 'working'}>
                {sideNavStatus === 'working' ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
