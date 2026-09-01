import { describe, expect, it } from 'bun:test'
import { assetUrl, isImageAssetPath, markdownWithWikilinksAndImages, resolveVaultAssetPath } from './markdownAssets'

describe('markdown image assets', () => {
  const notePath = 'Home/Maintenance/Washing Machine Dripping Into Basin - 2026-06-01.md'

  it('recognizes browser-displayable raster image paths only', () => {
    expect(isImageAssetPath('photo.JPG')).toBe(true)
    expect(isImageAssetPath('folder/scan.avif?raw=1')).toBe(true)
    expect(isImageAssetPath('unsafe.svg')).toBe(false)
    expect(isImageAssetPath('note.md')).toBe(false)
  })

  it('resolves absolute vault paths and relative markdown image paths from the selected note folder', () => {
    expect(resolveVaultAssetPath('Home/Maintenance/Attachments/drip.jpg', notePath)).toBe('Home/Maintenance/Attachments/drip.jpg')
    expect(resolveVaultAssetPath('./Attachments/drip.jpg', notePath)).toBe('Home/Maintenance/Attachments/drip.jpg')
    expect(resolveVaultAssetPath('drip%20photo.jpg', notePath)).toBe('Home/Maintenance/drip photo.jpg')
  })

  it('leaves external URLs and non-images alone', () => {
    expect(resolveVaultAssetPath('https://example.com/photo.jpg', notePath)).toBeNull()
    expect(resolveVaultAssetPath('data:image/png;base64,abc', notePath)).toBeNull()
    expect(resolveVaultAssetPath('README.md', notePath)).toBeNull()
  })

  it('builds encoded API asset URLs', () => {
    expect(assetUrl('/app/md-ops', 'obsidian-vault', 'Home/Maintenance/drip photo.jpg')).toBe(
      '/app/md-ops/api/asset?path=obsidian-vault%2FHome%2FMaintenance%2Fdrip%20photo.jpg'
    )
  })

  it('rewrites Obsidian image embeds and preserves normal wikilinks', () => {
    const rendered = markdownWithWikilinksAndImages(
      'Evidence: ![[Home/Maintenance/Attachments/drip photo.jpg]] and [[Daily/2026-06-01|today]].',
      '',
      'obsidian-vault',
      notePath
    )

    expect(rendered).toContain('![drip photo.jpg](/api/asset?path=obsidian-vault%2FHome%2FMaintenance%2FAttachments%2Fdrip%20photo.jpg)')
    expect(rendered).toContain('[today](#wikilink:Daily%2F2026-06-01)')
  })

  it('does not convert non-image Obsidian embeds into fake markdown images', () => {
    const rendered = markdownWithWikilinksAndImages('Embed: ![[Some Note]]', '', 'obsidian-vault', notePath)
    expect(rendered).toBe('Embed: ![[Some Note]]')
  })
})
