import { Link, NavLink } from 'react-router-dom'

export default function Nav() {
  return (
    <header className="nav">
      <div className="nav-inner container">
        <Link className="brand" to="/" aria-label="MD Ops home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 4h10l4 4v12H5z" />
              <path d="M15 4v5h4M8 13h8M8 17h6" />
            </svg>
          </span>
          <span className="brand-name">MD&nbsp;Ops</span>
          <span className="brand-status">open source</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <NavLink to="/" end>Vision</NavLink>
          <NavLink to="/docs">Docs</NavLink>
          <NavLink to="/how-to">How it works</NavLink>
        </nav>
        <Link className="btn btn-ghost btn-sm nav-cta" to="/docs/quickstart">
          Quick start
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      </div>
    </header>
  )
}
