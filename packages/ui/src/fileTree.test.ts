import { describe, expect, it } from 'bun:test'
import { ancestorFolderPaths, buildFileTree, folderPathsFromFiles } from './fileTree'

function findFolder(nodes: ReturnType<typeof buildFileTree>, path: string) {
  const queue = [...nodes]
  while (queue.length) {
    const node = queue.shift()!
    if (node.type === 'folder' && node.path === path) return node
    queue.push(...node.children)
  }
  return null
}

describe('buildFileTree', () => {
  it('counts each descendant file exactly once for folders', () => {
    const tree = buildFileTree([
      'Projects/alpha.md',
      'Projects/Nested/beta.md',
      'Projects/Nested/gamma.md',
      'Projects/Nested/Deep/delta.md',
      'Root.md',
    ])

    expect(findFolder(tree, 'Projects')?.fileCount).toBe(4)
    expect(findFolder(tree, 'Projects/Nested')?.fileCount).toBe(3)
    expect(findFolder(tree, 'Projects/Nested/Deep')?.fileCount).toBe(1)
  })

  it('keeps root-level files visible without inventing a folder', () => {
    const tree = buildFileTree(['Root.md', 'Folder/Note.md'])
    expect(tree.map((node) => `${node.type}:${node.path}`)).toEqual(['folder:Folder', 'file:Root.md'])
  })

  it('sorts folders before files with numeric-aware names', () => {
    const tree = buildFileTree(['Note 10.md', 'Note 2.md', 'Folder 2/A.md', 'Folder 10/A.md'])
    expect(tree.map((node) => node.path)).toEqual(['Folder 2', 'Folder 10', 'Note 2.md', 'Note 10.md'])
  })

  it('shows empty folders returned by the API', () => {
    const tree = buildFileTree(['Folder/Note.md'], ['Empty', 'Parent/Child'])
    expect(tree.map((node) => `${node.type}:${node.path}:${node.fileCount}`)).toEqual([
      'folder:Empty:0',
      'folder:Folder:1',
      'folder:Parent:0',
    ])
    expect(findFolder(tree, 'Parent/Child')?.fileCount).toBe(0)
  })
})

describe('ancestorFolderPaths', () => {
  it('returns only folder ancestors for a selected file', () => {
    expect([...ancestorFolderPaths('A/B/C.md')]).toEqual(['A', 'A/B'])
  })
})

describe('folderPathsFromFiles', () => {
  it('returns unique folder paths for a create-location picker', () => {
    expect(folderPathsFromFiles([
      'Projects/alpha.md',
      'Projects/Nested/beta.md',
      'Projects/Nested/Deep/gamma.md',
      'Root.md',
    ])).toEqual(['Projects', 'Projects/Nested', 'Projects/Nested/Deep'])
  })
})
