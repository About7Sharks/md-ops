import { CodeBlock, Callout } from '../components/DocBlocks'

const startScript = `# from the md-ops repository root
cp .env.example .env
docker compose build
docker compose up -d

# open http://127.0.0.1:3098 in your browser`

const rootsScript = `curl --fail "http://127.0.0.1:3098/api/roots"`

const readScript = `# read with headers so you can see the ETag
curl -i "http://127.0.0.1:3098/api/file?path=demo/Welcome.md"`

const searchScript = `curl "http://127.0.0.1:3098/api/search?root=demo&q=meeting"`

const createScript = `# requires MD_OPS_ALLOW_MUTATIONS=true and MD_OPS_VAULT_READ_ONLY=false
curl -X PUT "http://127.0.0.1:3098/api/file?path=demo/Projects/new-note.md" \\
  -H "X-Confirm-Write: 1" \\
  -H 'Content-Type: text/markdown' \\
  --data-binary @new-note.md`

const editScript = `# 1. read the file and keep the ETag from the response
curl -i "http://127.0.0.1:3098/api/file?path=demo/Projects/new-note.md"

# 2. write only if nothing changed since you read it
curl -X PUT "http://127.0.0.1:3098/api/file?path=demo/Projects/new-note.md" \\
  -H "X-Confirm-Write: 1" \\
  -H 'If-Match: "etag-from-read"' \\
  --data-binary @new-note.md

# stale? the API answers 409 Conflict and nothing is written`

const deleteScript = `# permanent — there is no undo, back up first
curl -X DELETE "http://127.0.0.1:3098/api/file?path=demo/Projects/new-note.md" \\
  -H "X-Confirm-Write: 1"`

const graphScript = `curl "http://127.0.0.1:3098/api/system-graph"`

export default function HowToPage() {
  return (
    <main className="howto container">
      <div className="doc-content">
        <h1>How to use MD Ops</h1>
        <p className="doc-lead">
          Step-by-step browser and HTTP API instructions for browse, read, search, create, edit,
          and delete tasks. MCP v0.1 supports reads and guarded file writes; it does not expose
          delete or folder-mutation tools.
        </p>

        <h2>1. Start the workspace</h2>
        <p>
          From the repository root, copy the example environment, build, and start the stack.
          The demo mounts only the bundled example vault. It is read-only by default.
        </p>
        <CodeBlock code={startScript} />

        <h2>2. Browse your roots</h2>
        <p>
          Open <code className="inline-code">http://127.0.0.1:3098</code> in a browser, or list
          the allowlisted roots over the API — an agent can do the same with{' '}
          <code className="inline-code">md_ops_list_roots</code>.
        </p>
        <CodeBlock code={rootsScript} />

        <h2>3. Read a file</h2>
        <p>
          Files use a logical path in the form{' '}
          <code className="inline-code">{'<root-id>/<relative-path>'}</code>. Note the ETag in
          the response. You will need it for conflict-aware edits.
        </p>
        <CodeBlock code={readScript} />

        <h2>4. Search your notes</h2>
        <p>
          Lexical keyword search is deterministic: the same query and vault always return the
          same results.
        </p>
        <CodeBlock code={searchScript} />

        <h2>5. Create a note</h2>
        <p>
          Creating a file is a mutation. The server must run with a writable vault mount and{' '}
          <code className="inline-code">MD_OPS_ALLOW_MUTATIONS=true</code>. Every write must
          carry the <code className="inline-code">X-Confirm-Write: 1</code> confirmation header.
        </p>
        <CodeBlock code={createScript} />

        <h2>6. Edit without conflicts</h2>
        <p>
          Read the file first and keep its ETag. Write back with{' '}
          <code className="inline-code">If-Match</code> set to that ETag. If someone else (or
          another agent) changed the file in between, the API answers{' '}
          <code className="inline-code">409 Conflict</code>. Nothing is overwritten.
          Re-read and retry.
        </p>
        <CodeBlock code={editScript} />

        <h2>7. Delete a file</h2>
        <p>
          Deletes are permanent. There is no recoverable delete. Confirm the path. Back up
          first. Then send the request with the confirmation header. Delete is available through
          the browser and HTTP API, not through MCP.
        </p>
        <CodeBlock code={deleteScript} />

        <h2>8. See the system graph</h2>
        <p>
          The system graph shows how your logical roots, folders, and files connect. The
          browser UI renders it. The API returns it as raw data.
        </p>
        <CodeBlock code={graphScript} />

        <Callout tone="warn">
          <strong>Remember the supported boundary.</strong> Browser and API mutations require a
          writable mount, <code className="inline-code">MD_OPS_ALLOW_MUTATIONS=true</code>, and{' '}
          <code className="inline-code">X-Confirm-Write: 1</code>. The optional MCP file-write tool
          has an additional registration gate and cannot delete files. These are intent and
          exposure controls, not authentication or a substitute for backups.
        </Callout>
      </div>
    </main>
  )
}
