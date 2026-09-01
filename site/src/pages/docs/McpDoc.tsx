import { CodeBlock, Callout } from '../../components/DocBlocks'

const installScript = `# from the md-ops repository root
npm ci --workspace=@md-ops/mcp
npm --prefix packages/mcp run build

# point the MCP server at the running API, then start it
export MD_OPS_API_URL=http://127.0.0.1:3098
npm --prefix packages/mcp run start`

const claudeConfig = `{
  "mcpServers": {
    "md-ops": {
      "command": "npm",
      "args": ["--prefix", "<md-ops-install>/packages/mcp", "run", "start"],
      "env": {
        "MD_OPS_API_URL": "http://127.0.0.1:3098",
        "MD_OPS_MCP_WRITE_ENABLED": "false"
      }
    }
  }
}`

const tools: Array<[string, string, string]> = [
  ['md_ops_list_roots', 'always', 'List the allowlisted Markdown roots the server may access.'],
  ['md_ops_list_files', 'always', 'List files and folders inside a root, one level at a time.'],
  ['md_ops_search', 'always', 'Lexical keyword search across the allowlisted roots.'],
  ['md_ops_read_file', 'always', 'Read a file along with its ETag, so edits stay conflict-safe.'],
  [
    'md_ops_retrieve',
    'optional',
    'Read-only QMD keyword retrieval, max 8 results, only for explicitly mapped roots.',
  ],
  [
    'md_ops_write_file',
    'MD_OPS_MCP_WRITE_ENABLED=true',
    'Write files — gated by the write triple described below.',
  ],
]

export default function McpDoc() {
  return (
    <>
      <h1>MCP integration</h1>
      <p className="doc-lead">
        MD Ops exposes selected Markdown operations over <strong>stdio</strong>. The API still
        applies its configured root allowlist and mutation controls. Any runtime that can start
        the MCP process can invoke its registered tools.
      </p>

      <h2>How it connects</h2>
      <ul>
        <li>Transport is stdio: the MCP server is a child process of your agent runtime.</li>
        <li>
          Point it at the API with <code className="inline-code">MD_OPS_API_URL</code>, e.g.{' '}
          <code className="inline-code">http://127.0.0.1:3098</code>.
        </li>
        <li>
          Through MD Ops tools, an agent can request only the roots you configure. Shell, browser,
          filesystem, memory, and other tools granted to the same runtime are outside MD Ops'
          control.
        </li>
      </ul>

      <h2>Tools</h2>
      <div className="table-wrap">
        <table className="doc-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Registered</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {tools.map(([name, reg, desc]) => (
              <tr key={name}>
                <td>
                  <code>{name}</code>
                </td>
                <td>
                  <code>{reg}</code>
                </td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Write gating: all three must be true</h2>
      <p>
        <code className="inline-code">md_ops_write_file</code> only exists when{' '}
        <code className="inline-code">MD_OPS_MCP_WRITE_ENABLED=true</code>, and even then a write
        only goes through when every gate is open:
      </p>
      <ol>
        <li>
          The API runs with <code className="inline-code">MD_OPS_ALLOW_MUTATIONS=true</code>.
        </li>
        <li>
          The MCP server runs with{' '}
          <code className="inline-code">MD_OPS_MCP_WRITE_ENABLED=true</code>.
        </li>
        <li>
          The tool call passes <code className="inline-code">confirm_write: true</code>.
        </li>
      </ol>
      <Callout tone="warn">
        <strong>One missing gate refuses the write.</strong> These controls reduce accidental
        writes; they are not authentication and do not replace tested backups.
      </Callout>

      <h2>ETags and deep links</h2>
      <ul>
        <li>
          Reads and writes return a <code className="inline-code">url</code> field. It is a
          browser <strong>deep link</strong> straight to the file.
        </li>
        <li>
          Keep the ETag from a read and pass it back on writes so the API can reject stale edits.
        </li>
        <li>
          The MCP server refuses URLs that embed credentials, fragments, or query strings.
        </li>
      </ul>

      <h2>Install and run</h2>
      <CodeBlock code={installScript} label="from the md-ops repository root" />

      <h2>Claude Desktop</h2>
      <p>
        Add the server to your <code className="inline-code">claude_desktop_config.json</code>.
        Replace <code className="inline-code">&lt;md-ops-install&gt;</code> with the absolute
        repository path. The API URL points at your running MD Ops service.
      </p>
      <CodeBlock code={claudeConfig} label="claude_desktop_config.json" />

      <Callout tone="note">
        <strong>Read tools are registered by default.</strong> Their output can be sent to the
        model/runtime you configure, so review that system's data-use policy before mounting user
        notes. Only the optional file-write tool requires additional registration.
      </Callout>
    </>
  )
}
