import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { activityDestinations, parseMarkdownHeadings, searchRootEntries } from './activityNavigationModel'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const appCss = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
const activityCss = readFileSync(new URL('./activityNavigation.css', import.meta.url), 'utf8')

describe('activity navigation contracts', () => {
  it('uses the same six destinations and opens Graph through the existing graph surface', () => {
    expect(activityDestinations.map(({ id }) => id)).toEqual(['files', 'search', 'graph', 'outline', 'links', 'diagrams'])
    expect(activityDestinations.find(({ id }) => id === 'graph')?.kind).toBe('graph')
    expect(activityDestinations.find(({ id }) => id === 'diagrams')?.kind).toBe('panel')
    const selectionHandler = app.slice(app.indexOf('const handleActivitySelect'), app.indexOf('const handleSearchFolder'))
    expect(selectionHandler).toContain("if (destination.kind === 'graph')")
    expect(selectionHandler).toContain('handleOpenGraph()')
    expect(selectionHandler).toContain('setShowGraph(false)')
    expect(app).toContain('variant="rail"')
    expect(app).toContain('variant="mobile"')
    expect(app).toContain('showGraph && (')
    expect(app).toContain('<Suspense fallback={null}>')
    expect(app).toContain('<SystemGraph activeRoot={activeRoot || preferredRootId(roots)}')
  })

  it('adds the activity rail beside the existing explorer width instead of taking space from it', () => {
    expect(activityCss).toContain('width: clamp(328px, calc(23vw + 48px), 392px)')
    expect(activityCss).toContain('flex: 0 0 clamp(328px, calc(23vw + 48px), 392px)')
    expect(activityCss).toContain('width: calc(100% - 48px)')
    expect(appCss).toContain('padding-right: 10px')
    expect(appCss).toContain('.tree-item:hover .folder-label')
    expect(appCss).toContain('padding-right: 104px')
    expect(appCss).not.toContain('padding-right: 114px')
  })
})

describe('current-root search', () => {
  it('matches file and folder paths without a backend content-search contract', () => {
    expect(searchRootEntries('plan', ['Plans/Q3.md', 'Notes/plan-review.md', 'README.md'], ['Plans', 'Archive'])).toEqual([
      { kind: 'folder', path: 'Plans', name: 'Plans' },
      { kind: 'file', path: 'Notes/plan-review.md', name: 'plan-review.md' },
      { kind: 'file', path: 'Plans/Q3.md', name: 'Q3.md' },
    ])
    expect(searchRootEntries('  ', ['note.md'], ['Notes'])).toEqual([])
  })
})

describe('Markdown outline', () => {
  it('uses Markdown block parsing for real headings and rendered start-line targets', () => {
    const markdown = '# Project\ntext\n### Phase\n```md\n## Example only\n```\nFirst line\nsecond line\n---\n> quote\n---\n- item\n  continuation\n---\n\tcode\n---\n[ref]: /url\n---\n'
    expect(parseMarkdownHeadings(markdown)).toEqual([
      { depth: 1, text: 'Project', line: 1, id: 'md-heading-1' },
      { depth: 3, text: 'Phase', line: 3, id: 'md-heading-3' },
      { depth: 2, text: 'First line\nsecond line', line: 7, id: 'md-heading-7' },
    ])
  })

  it('wires outline focus to rendered heading IDs and labels unavailable backlinks honestly', () => {
    expect(app).toContain("setDocumentView((current) => current === 'edit' ? 'preview' : current)")
    expect(app).toContain('document.getElementById(headingId)')
    expect(app).toContain('heading?.scrollIntoView')
    expect(app).toContain('Backlinks cannot be computed safely from filenames alone.')
  })
})

describe('large note interaction performance', () => {
  it('keeps the rendered Markdown subtree stable across unrelated App state changes', () => {
    expect(app).toContain('const MarkdownDocument = memo(function MarkdownDocument')
    expect(app).toContain('<MarkdownDocument')
    expect(app.match(/<ReactMarkdown/g)).toHaveLength(1)
  })

  it('bounds eager wikilink controls while preserving the complete link count', () => {
    expect(app).toContain('const VISIBLE_WIKILINK_LIMIT = 100')
    expect(app).toContain('wikilinks.slice(0, VISIBLE_WIKILINK_LIMIT)')
    expect(app.match(/visibleWikilinks\.map/g)).toHaveLength(2)
    expect(app).toContain('Showing first {visibleWikilinks.length} of {wikilinks.length} links.')
  })
})
