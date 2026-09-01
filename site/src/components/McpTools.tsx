import { Link } from 'react-router-dom'

const tools = [
  ['md_ops_list_files', 'Navigate one allowlisted root'],
  ['md_ops_search', 'Find literal matches without ingestion'],
  ['md_ops_retrieve', 'Request a short QMD-ranked shortlist'],
  ['md_ops_read_file', 'Read content with an ETag and browser link'],
]

const flow = [
  ['Agent runtime', 'Your chosen model and privacy policy'],
  ['MCP stdio', 'Narrow Markdown tools; writes off by default'],
  ['Loopback API', 'Exact host allowlist and mutation guard'],
  ['Markdown roots', 'Only the directories you configured'],
]

export default function McpTools() {
  return (
    <section className="landing-section agent-section" id="mcp">
      <div className="container">
        <div className="agent-heading">
          <div>
            <p className="landing-section-index">03 / Agent interface</p>
            <h2>Scoped Markdown tools for agents.</h2>
          </div>
          <p>
            Through MD Ops, an agent can request only the roots you configure. Other tools granted
            to the agent—and the model/runtime's handling of output—are outside this boundary.
          </p>
        </div>

        <div className="agent-layout">
          <div className="agent-flow" aria-label="MD Ops agent data path">
            {flow.map(([title, detail], index) => (
              <div className="agent-flow-node" key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{title}</strong>
                <p>{detail}</p>
              </div>
            ))}
          </div>

          <div className="agent-tools">
            <div className="agent-tools-head">
              <span>Read surface</span>
              <code>MD_OPS_MCP_WRITE_ENABLED=false</code>
            </div>
            {tools.map(([name, detail]) => (
              <div className="agent-tool-row" key={name}>
                <code>{name}</code>
                <span>{detail}</span>
              </div>
            ))}
            <p className="agent-tool-note">
              The optional file-write tool requires a writable mount, API mutations, MCP
              registration, and explicit confirmation. MCP has no delete or folder-mutation tool.
            </p>
          </div>
        </div>

        <div className="message-handoff">
          <div className="message-handoff-copy">
            <p className="landing-section-index">Human-readable handoff</p>
            <h3>Send the note, not the machine path.</h3>
            <p>
              Reads, writes, and retrieval results include an MD Ops browser URL. The agent can
              render that URL as a named Markdown link in its reply, so the human opens the exact
              note in Read view instead of receiving a path such as{' '}
              <code>/vault/Projects/Launch checklist.md</code>.
            </p>
            <p className="message-handoff-boundary">
              The link contains a service address, logical root, and relative note path—not the
              physical filesystem location. It works only for a reader who can reach that MD Ops
              service; the link itself is not authentication.
            </p>
            <Link className="landing-text-link" to="/docs/links">
              See the deep-link workflow <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="message-thread" aria-label="Example human and agent message exchange">
            <div className="message-bubble message-bubble-human">
              <span>Human</span>
              <p>Update the launch checklist and send me the result.</p>
            </div>
            <div className="message-bubble message-bubble-agent">
              <span>Agent</span>
              <p>
                Updated <Link to="/docs/links">Launch checklist ↗</Link> and verified the saved
                content.
              </p>
              <code>demo · Projects/Launch checklist.md · Read view</code>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
