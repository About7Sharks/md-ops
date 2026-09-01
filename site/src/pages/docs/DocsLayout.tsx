import { Outlet } from 'react-router-dom'
import DocsSidebar from '../../components/DocsSidebar'

export default function DocsLayout() {
  return (
    <main className="docs-layout container">
      <DocsSidebar />
      <div className="doc-content">
        <Outlet />
      </div>
    </main>
  )
}
