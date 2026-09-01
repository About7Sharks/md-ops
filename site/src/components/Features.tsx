const surfaces = [
  {
    index: '01',
    name: 'Browser workspace',
    detail: 'Browse allowlisted roots, render Markdown, follow links, search, and inspect the note graph without hiding the files underneath.',
    meta: 'Reading · editing · preview · diagrams',
  },
  {
    index: '02',
    name: 'HTTP API',
    detail: 'Give scripts a small loopback API for roots, files, search, retrieval, and conflict-aware writes.',
    meta: '127.0.0.1 · ETags · exact host boundary',
  },
  {
    index: '03',
    name: 'MCP for agents',
    detail: 'Give an agent a narrow Markdown toolset through stdio instead of broad access to your home directory.',
    meta: 'Read tools first · independent write gate',
  },
]

const capabilities = [
  ['Files stay portable', 'Plain Markdown remains the source of truth.'],
  ['One root policy', 'The UI, API, and MCP server share the same allowlist.'],
  ['Conflict-aware edits', 'ETags make concurrent changes visible instead of silent.'],
  ['Search without ingestion', 'Lexical search and optional QMD retrieval run against your configured roots.'],
]

export default function Features() {
  return (
    <section className="landing-section interface-section" id="features">
      <div className="container">
        <div className="landing-section-heading">
          <p className="landing-section-index">01 / Architecture</p>
          <h2>A folder stays a folder.</h2>
          <p>
            MD Ops adds controlled interfaces around Markdown. It does not turn your notes into a
            proprietary database or require a migration.
          </p>
        </div>

        <div className="interface-map">
          <div className="source-node">
            <span className="source-node-label">Source of truth</span>
            <strong>Allowlisted Markdown roots</strong>
            <code>~/notes/selected-folder</code>
            <span className="source-node-state">filesystem-owned</span>
          </div>
          <div className="interface-connector" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="surface-list">
            {surfaces.map((surface) => (
              <article className="surface-row" key={surface.name}>
                <span className="surface-index">{surface.index}</span>
                <div>
                  <h3>{surface.name}</h3>
                  <p>{surface.detail}</p>
                  <span className="surface-meta">{surface.meta}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="capability-ledger" aria-label="Product principles">
          {capabilities.map(([title, detail]) => (
            <div key={title}>
              <strong>{title}</strong>
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
