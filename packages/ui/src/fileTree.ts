export type FileTreeNode = {
  type: 'folder' | 'file'
  name: string
  path: string
  children: FileTreeNode[]
  fileCount: number
}

const treeSort = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function buildFileTree(paths: string[], folderPaths: string[] = []): FileTreeNode[] {
  const root: FileTreeNode = { type: 'folder', name: '', path: '', children: [], fileCount: 0 }
  const folders = new Map<string, FileTreeNode>([['', root]])

  const ensureFolder = (folderPath: string): FileTreeNode | null => {
    const parts = folderPath.split('/').filter(Boolean)
    if (!parts.length) return root
    let parent = root
    let currentPath = ''
    for (const name of parts) {
      const path = currentPath ? `${currentPath}/${name}` : name
      let folder = folders.get(path)
      if (!folder) {
        folder = { type: 'folder', name, path, children: [], fileCount: 0 }
        folders.set(path, folder)
        parent.children.push(folder)
      }
      parent = folder
      currentPath = path
    }
    return parent
  }

  for (const folderPath of folderPaths) ensureFolder(folderPath)

  for (const relPath of paths) {
    const parts = relPath.split('/').filter(Boolean)
    if (!parts.length) continue

    const folderPath = parts.slice(0, -1).join('/')
    const parent = ensureFolder(folderPath) ?? root
    parent.children.push({ type: 'file', name: parts[parts.length - 1], path: relPath, children: [], fileCount: 1 })
    for (let index = 1; index < parts.length; index += 1) {
      const folder = folders.get(parts.slice(0, index).join('/'))
      if (folder) folder.fileCount += 1
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return treeSort.compare(a.name, b.name)
    })
    nodes.forEach((node) => sortNodes(node.children))
  }
  sortNodes(root.children)
  return root.children
}

export function ancestorFolderPaths(relPath: string | null): Set<string> {
  if (!relPath) return new Set()
  const parts = relPath.split('/').filter(Boolean)
  const ancestors = new Set<string>()
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.add(parts.slice(0, index).join('/'))
  }
  return ancestors
}

export function folderPathsFromFiles(paths: string[]): string[] {
  const folders = new Set<string>()
  for (const relPath of paths) {
    const parts = relPath.split('/').filter(Boolean)
    for (let index = 1; index < parts.length; index += 1) {
      folders.add(parts.slice(0, index).join('/'))
    }
  }
  return [...folders].sort((a, b) => treeSort.compare(a, b))
}
