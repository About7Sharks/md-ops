import { describe, expect, it } from 'bun:test'
import { apiBaseFromPathname } from './api'

describe('API base from the app mount', () => {
  it('keeps the current mounted path and supports arbitrary same-origin mounts', () => {
    expect(apiBaseFromPathname('/app/md-ops')).toBe('/app/md-ops')
    expect(apiBaseFromPathname('/app/md-ops/')).toBe('/app/md-ops')
    expect(apiBaseFromPathname('/demo/markdown-workbench/')).toBe('/demo/markdown-workbench')
  })

  it('uses the containing mount for an explicit entry document and root hosting', () => {
    expect(apiBaseFromPathname('/demo/markdown-workbench/index.html')).toBe('/demo/markdown-workbench')
    expect(apiBaseFromPathname('/')).toBe('')
  })
})
