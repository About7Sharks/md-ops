import { describe, expect, it } from 'bun:test'
import { parseWikilinks } from './obsidian'

describe('parseWikilinks', () => {
  it('extracts normal wikilinks and ignores embedded image wikilinks', () => {
    const links = parseWikilinks('See [[Home/Maintenance/README]] and ![[Attachments/photo.jpg]] plus [[Daily/2026-06-01|today]].')
    expect(links.map((link) => ({ target: link.target, alias: link.alias }))).toEqual([
      { target: 'Home/Maintenance/README', alias: undefined },
      { target: 'Daily/2026-06-01', alias: 'today' },
    ])
  })
})
