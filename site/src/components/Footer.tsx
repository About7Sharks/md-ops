import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-topline">
        <div>
          <span className="footer-wordmark">MD Ops</span>
          <p>Local-first Markdown operations for one trusted operator.</p>
        </div>
        <div className="footer-nav" aria-label="Footer navigation">
          <a href="https://github.com/About7Sharks/md-ops">GitHub</a>
          <Link to="/docs/quickstart">Quick start</Link>
          <Link to="/docs/security">Security</Link>
          <Link to="/docs/mcp">MCP</Link>
          <Link to="/how-to">How it works</Link>
        </div>
      </div>
      <div className="container footer-legal">
        <p>MIT licensed · Open source · Local-first.</p>
        <p>© {new Date().getFullYear()} MD Ops contributors.</p>
      </div>
    </footer>
  )
}
