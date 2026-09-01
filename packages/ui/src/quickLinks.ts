import type { Root } from './api'

type RootLike = Pick<Root, 'id' | 'home'>

export type QuickLink = {
  label: string
  path: string
  rootHint?: string
  readView?: boolean
}

export function preferredRootId(roots: RootLike[] | null | undefined): string | null {
  if (!roots?.length) return null
  return roots.find((root) => root.home)?.id ?? roots[0].id
}

function rootExists(roots: RootLike[] | null | undefined, rootId: string): boolean {
  return Boolean(roots?.some((root) => root.id === rootId))
}

export function preferredQuickLinkRoot(
  roots: RootLike[] | null | undefined,
  activeRoot: string | null | undefined,
  rootHint?: string,
): string | null {
  if (rootHint && rootExists(roots, rootHint)) return rootHint
  if (activeRoot && rootExists(roots, activeRoot)) return activeRoot
  return preferredRootId(roots)
}

export function buildQuickLinks(roots: RootLike[] | null | undefined): QuickLink[] {
  // Folder-style links only filter the selected source, so they remain safe when a demo has no matching files.
  const home = roots?.find((root) => root.home)
  return [
    ...(home?.home ? [{ label: 'Home', path: home.home, rootHint: home.id, readView: true }] : []),
    { label: 'All files', path: '/' },
    { label: 'Notes', path: 'notes/' },
    { label: 'Projects', path: 'projects/' },
  ]
}
