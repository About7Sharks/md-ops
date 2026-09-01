import { describe, expect, it } from 'bun:test'
import { copyRecentNotePath } from './SidebarNavigation'

describe('copyRecentNotePath', () => {
  it('writes the exact recent-note path to an available clipboard', async () => {
    const writes: string[] = []
    const result = await copyRecentNotePath('projects/plan.md', {
      writeText: async (path) => { writes.push(path) },
    })

    expect(result).toBe('copied')
    expect(writes).toEqual(['projects/plan.md'])
  })

  it('reports when the browser clipboard is unavailable', async () => {
    expect(await copyRecentNotePath('projects/plan.md', null)).toBe('unavailable')
  })

  it('reports clipboard write failures without throwing', async () => {
    const result = await copyRecentNotePath('projects/plan.md', {
      writeText: async () => { throw new Error('Clipboard permission denied') },
    })

    expect(result).toBe('failed')
  })
})
