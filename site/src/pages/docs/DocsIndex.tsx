import { Link } from 'react-router-dom'
import { Callout } from '../../components/DocBlocks'

const docIndex = [
  {
    to: '/docs/quickstart',
    title: 'Quick start',
    desc: 'Docker Compose install, first run, readiness check, and shutdown.',
  },
  {
    to: '/docs/configure',
    title: 'Configuration',
    desc: 'Point MD Ops at a real Markdown root and enable mutations.',
  },
  {
    to: '/docs/api',
    title: 'API reference',
    desc: 'Every endpoint, header, and logical path format on the loopback API.',
  },
  {
    to: '/docs/mcp',
    title: 'MCP integration',
    desc: 'Use MD Ops with Claude, Codex, and other agent runtimes over stdio.',
  },
  {
    to: '/docs/agents',
    title: 'AI agents',
    desc: 'Read and mutation workflows, plus a copy-paste setup prompt.',
  },
  {
    to: '/docs/security',
    title: 'Security model',
    desc: 'Single-operator, loopback-only, read-only by default — and what that means.',
  },
  {
    to: '/docs/links',
    title: 'Links and Tailscale',
    desc: 'Deep links agents can paste in chats, plus Tailscale Serve for remote access.',
  },
]

export default function DocsIndex() {
  return (
    <>
      <h1>Documentation</h1>
      <p className="doc-lead">
        Everything you need to run MD Ops. Point it at real vaults. Use it from the browser,
        from scripts, or from an agent.
      </p>
      <div className="doc-card-grid">
        {docIndex.map((d) => (
          <Link className="doc-card" to={d.to} key={d.to}>
            <h3>{d.title}</h3>
            <p>{d.desc}</p>
          </Link>
        ))}
        <Link className="doc-card" to="/how-to">
          <h3>How to use</h3>
          <p>Step-by-step instructions for everyday tasks: browse, read, search, create, edit, delete.</p>
        </Link>
      </div>
      <Callout tone="note">
        <strong>Read-only by default.</strong> Every surface starts read-only. Mutations require
        enabling. The quick start demo mounts only the bundled example vault. See{' '}
        <Link to="/docs/configure">Configuration</Link> before you trust MD Ops with real notes.
      </Callout>
    </>
  )
}
