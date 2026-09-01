import { NavLink } from 'react-router-dom'

const docLinks = [
  { to: '/docs', label: 'Overview', end: true },
  { to: '/docs/quickstart', label: 'Quick start' },
  { to: '/docs/configure', label: 'Configuration' },
  { to: '/docs/api', label: 'API reference' },
  { to: '/docs/mcp', label: 'MCP integration' },
  { to: '/docs/agents', label: 'AI agents' },
  { to: '/docs/links', label: 'Links and Tailscale' },
  { to: '/docs/security', label: 'Security model' },
]

export default function DocsSidebar() {
  return (
    <aside className="docs-sidebar">
      <p className="docs-sidebar-label">Documentation</p>
      <nav aria-label="Documentation">
        {docLinks.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            {l.label}
          </NavLink>
        ))}
        <span className="sidebar-divider" aria-hidden="true" />
        <NavLink to="/how-to">How to use</NavLink>
      </nav>
    </aside>
  )
}
