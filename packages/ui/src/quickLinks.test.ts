import { describe, expect, it } from 'bun:test'
import { buildQuickLinks, preferredQuickLinkRoot, preferredRootId } from './quickLinks'

const roots = [
  { id: 'docs' },
  { id: 'archive' },
]

describe('quick links', () => {
  it('uses generic filter-only quick links for every root set', () => {
    const links = buildQuickLinks(roots)

    expect(links).toEqual([
      { label: 'All files', path: '/' },
      { label: 'Notes', path: 'notes/' },
      { label: 'Projects', path: 'projects/' },
    ])
    expect(links.some((link) => link.rootHint)).toBe(false)
  })

  it('adds a logical Home link and prefers its root without physical paths', () => {
    const configured = [{ id: 'docs' }, { id: 'vault', home: 'Vault-Admin/Dashboard.md' }]
    expect(preferredRootId(configured)).toBe('vault')
    expect(buildQuickLinks(configured)[0]).toEqual({
      label: 'Home',
      path: 'Vault-Admin/Dashboard.md',
      rootHint: 'vault',
      readView: true,
    })
  })

  it('uses the hinted quick-link root even when another root is active', () => {
    expect(preferredQuickLinkRoot(roots, 'docs', 'archive')).toBe('archive')
  })

  it('falls back to the active root if the hinted root is unavailable', () => {
    expect(preferredQuickLinkRoot(roots, 'archive', 'missing')).toBe('archive')
  })

  it('uses configured order when no active or hinted root is available', () => {
    expect(preferredRootId(roots)).toBe('docs')
  })
})
