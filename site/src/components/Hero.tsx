import { Link } from 'react-router-dom'
import workspaceCapture from '../assets/md-ops-workspace.webp'

const productFacts = [
  ['Storage', 'Your Markdown folders'],
  ['Network', 'Loopback only by default'],
  ['Writes', 'Disabled until explicitly enabled'],
]

export default function Hero() {
  const showWorkspace = () => {
    const workspace = document.getElementById('workspace')
    if (!workspace) return

    const top = workspace.getBoundingClientRect().top + window.scrollY - 84
    window.scrollTo(0, top)
  }

  return (
    <section className="landing-hero" id="top">
      <div className="landing-grid" aria-hidden="true" />
      <div className="container landing-hero-inner">
        <div className="landing-hero-copy">
          <p className="landing-kicker">
            <span className="landing-kicker-mark" aria-hidden="true">MD</span>
            Local-first · MIT licensed · single operator
          </p>
          <h1 className="landing-title">
            Your notes are already a system.
            <span>Give them an operating surface.</span>
          </h1>
          <p className="landing-lead">
            MD Ops gives one trusted operator a browser workspace, a loopback HTTP API, and stdio
            MCP tools for selected Markdown folders. It starts read-only and has no built-in login.
          </p>
          <div className="landing-actions">
            <button className="btn btn-primary" type="button" onClick={showWorkspace}>
              See the workspace
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </button>
            <Link className="btn btn-ghost" to="/docs/quickstart">
              Read the quick start
            </Link>
          </div>
          <p className="landing-runtime-note">
            MD Ops does not provide a model or agent runtime. MCP output may be sent to the model
            and services you configure; their data handling is outside the MD Ops boundary.
          </p>
        </div>

        <div className="landing-status" aria-label="MD Ops default posture">
          <div className="landing-status-head">
            <span className="status-pulse" aria-hidden="true" />
            Default posture
          </div>
          <dl>
            {productFacts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <figure className="product-stage" id="workspace">
          <div className="product-stage-meta">
            <span className="status-pulse" aria-hidden="true" />
            <span>Loopback demo · synthetic vault</span>
            <span className="stage-readonly">read-only</span>
          </div>
          <img
            src={workspaceCapture}
            alt="MD Ops displaying the synthetic Welcome.md example vault in focused Read view"
            width="1440"
            height="760"
            fetchPriority="high"
          />
          <figcaption>
            Product capture using only the bundled synthetic example content.
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
