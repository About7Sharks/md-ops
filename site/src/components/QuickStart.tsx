const composeScript = `# from the md-ops repository root
cp .env.example .env
docker compose up --build -d

# open http://127.0.0.1:3098`

const setupSteps = [
  ['Point at one folder', 'Set MD_OPS_VAULT_PATH to a narrow Markdown directory, not your whole home folder.'],
  ['Start read-only', 'The API mutation gate is off and the Compose bind mount is read-only by default.'],
  ['Open the workspace', 'Use the browser locally, then add MCP only if an agent needs the same controlled view.'],
]

export default function QuickStart() {
  return (
    <section className="landing-section install-section" id="quick-start">
      <div className="container install-layout">
        <div className="install-copy">
          <p className="landing-section-index">02 / Install</p>
          <h2>No platform to adopt.</h2>
          <p className="install-lead">
            Clone, choose a narrow vault path, and start the Compose stack. MD Ops runs on the
            machine that owns the files.
          </p>
          <ol className="install-steps">
            {setupSteps.map(([title, body], index) => (
              <li key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="install-terminal">
          <div className="install-terminal-head">
            <span>terminal</span>
            <span>3 commands</span>
          </div>
          <pre aria-label="Docker Compose quick start commands"><code>{composeScript}</code></pre>
          <div className="install-terminal-foot">
            <span className="status-pulse" aria-hidden="true" />
            Local endpoint · no account required
          </div>
        </div>
      </div>
    </section>
  )
}
