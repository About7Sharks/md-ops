import { Link } from 'react-router-dom'

const boundaries = [
  ['Network', 'Binds to 127.0.0.1 by default and rejects untrusted Host values.'],
  ['Filesystem', 'Sees only configured roots; the Compose mount is read-only by default.'],
  ['Mutation', 'API and MCP write capabilities use separate explicit gates.'],
  ['Concurrency', 'Conditional updates use ETags so stale writes fail visibly.'],
]

export default function Security() {
  return (
    <section className="landing-section boundary-section" id="security">
      <div className="container">
        <div className="boundary-layout">
          <div className="boundary-copy">
            <p className="landing-section-index">04 / Trust boundary</p>
            <h2>The boundary is part of the product.</h2>
            <p>
              MD Ops is designed for one trusted operator using trusted local clients. It has no
              built-in login, authorization, tenant isolation, or public-hosting mode.
            </p>
            <div className="boundary-warning">
              <strong>Keep the supplied loopback-only, read-only defaults.</strong>
              <span>Do not expose the service directly to the public internet.</span>
            </div>
          </div>

          <dl className="boundary-ledger">
            {boundaries.map(([term, detail], index) => (
              <div key={term}>
                <dt><span>{String(index + 1).padStart(2, '0')}</span>{term}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="boundary-close">
          <div>
            <span>Ready to evaluate it?</span>
            <strong>Start with one allowlisted folder.</strong>
          </div>
          <div className="boundary-close-actions">
            <Link className="btn btn-primary" to="/docs/quickstart">Quick start</Link>
            <Link className="btn btn-ghost" to="/docs/security">Read the security model</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
