import { useLayoutEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Nav from './components/Nav'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import HowToPage from './pages/HowToPage'
import DocsLayout from './pages/docs/DocsLayout'
import DocsIndex from './pages/docs/DocsIndex'
import QuickstartDoc from './pages/docs/QuickstartDoc'
import ConfigureDoc from './pages/docs/ConfigureDoc'
import ApiDoc from './pages/docs/ApiDoc'
import McpDoc from './pages/docs/McpDoc'
import AgentsDoc from './pages/docs/AgentsDoc'
import SecurityDoc from './pages/docs/SecurityDoc'
import LinksDoc from './pages/docs/LinksDoc'

const pageTitles: Record<string, string> = {
  '/': 'MD Ops — Local-first Markdown operations',
  '/docs': 'Documentation — MD Ops',
  '/docs/quickstart': 'Quick start — MD Ops',
  '/docs/configure': 'Configuration — MD Ops',
  '/docs/api': 'API reference — MD Ops',
  '/docs/mcp': 'MCP integration — MD Ops',
  '/docs/agents': 'AI agents — MD Ops',
  '/docs/links': 'Links and Tailscale — MD Ops',
  '/docs/security': 'Security model — MD Ops',
  '/how-to': 'How to use MD Ops',
}

function SkipLink() {
  const skipToContent = () => {
    const main = document.querySelector<HTMLElement>('main')
    if (!main) return
    main.tabIndex = -1
    main.focus()
  }

  return (
    <button className="skip-link" type="button" onClick={skipToContent}>
      Skip to main content
    </button>
  )
}

function RouteEffects() {
  const { pathname } = useLocation()

  useLayoutEffect(() => {
    document.title = pageTitles[pathname] ?? pageTitles['/']
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

export default function App() {
  return (
    <div className="site">
      <RouteEffects />
      <SkipLink />
      <Nav />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<DocsIndex />} />
          <Route path="quickstart" element={<QuickstartDoc />} />
          <Route path="configure" element={<ConfigureDoc />} />
          <Route path="api" element={<ApiDoc />} />
          <Route path="mcp" element={<McpDoc />} />
          <Route path="agents" element={<AgentsDoc />} />
          <Route path="links" element={<LinksDoc />} />
          <Route path="security" element={<SecurityDoc />} />
        </Route>
        <Route path="/how-to" element={<HowToPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer />
    </div>
  )
}
