import { CodeBlock, Callout, Endpoint } from '../../components/DocBlocks'

const etagScript = `# 1. read the current file and keep the ETag from the response headers
curl -i "http://127.0.0.1:3098/api/file?path=demo/Welcome.md"

# 2. write only if the file has not changed since you read it
curl -X PUT "http://127.0.0.1:3098/api/file?path=demo/Welcome.md" \\
  -H "X-Confirm-Write: 1" \\
  -H 'If-Match: "etag-from-read"' \\
  --data-binary @welcome.md

# stale? the API answers 409 Conflict and nothing is written`

export default function ApiDoc() {
  return (
    <>
      <h1>API reference</h1>
      <p className="doc-lead">
        A small REST API on <code className="inline-code">127.0.0.1:3098</code>. Everything uses
        a logical path in the form{' '}
        <code className="inline-code">{'<root-id>/<relative-path>'}</code>. Responses carry root
        IDs and labels, never physical paths.
      </p>

      <h2>Health</h2>
      <Endpoint method="GET" path="/health" desc="Liveness — the server is up." />
      <Endpoint method="GET" path="/healthz" desc="Health probe for orchestrators." />
      <Endpoint
        method="GET"
        path="/readyz"
        desc="Readiness — reports writes: enabled|disabled and ui: bundled."
      />

      <h2>Reading</h2>
      <p>Read endpoints are always available and never require confirmation headers.</p>
      <Endpoint method="GET" path="/api/roots" desc="List the allowlisted root IDs and labels." />
      <Endpoint
        method="GET"
        path="/api/tree?root=&lt;id&gt;"
        desc="List files, markdownFiles, and folders inside a root."
      />
      <Endpoint
        method="GET"
        path="/api/search?root=&lt;id&gt;&amp;q=&lt;text&gt;"
        desc="Deterministic lexical keyword search across a root."
      />
      <Endpoint
        method="GET"
        path="/api/retrieve?root=&lt;id&gt;&amp;q=&lt;text&gt;&amp;limit=1..8"
        desc="Optional QMD keyword retrieval — only for explicitly mapped roots."
      />
      <Endpoint
        method="GET/HEAD"
        path="/api/file?path=&lt;logical-path&gt;"
        desc="Read a file's contents with ETag and Last-Modified headers."
      />

      <h2>Mutating</h2>
      <p>
        Every mutating endpoint requires <strong>both</strong>{' '}
        <code className="inline-code">MD_OPS_ALLOW_MUTATIONS=true</code> on the server and an{' '}
        <code className="inline-code">X-Confirm-Write: 1</code> header on the request.
      </p>
      <Endpoint
        method="PUT"
        path="/api/file?path=&lt;logical-path&gt;"
        desc="Create or update a file. It honors If-Match / If-None-Match conditional headers."
      />
      <Endpoint
        method="DELETE"
        path="/api/file?path=&lt;logical-path&gt;"
        desc="Permanently delete a file. There is no recoverable delete."
      />
      <Endpoint method="PUT" path="/api/folder" desc="Create a folder." />
      <Endpoint method="PATCH" path="/api/folder" desc="Move a folder." />
      <Endpoint method="DELETE" path="/api/folder" desc="Delete a folder." />

      <h2>Graph</h2>
      <Endpoint
        method="GET"
        path="/api/system-graph"
        desc="The logical root / folder / file graph of the workspace."
      />
      <Endpoint
        method="GET"
        path="/api/diagrams?root=&lt;id&gt;"
        desc="Mermaid diagrams extracted from a root's Markdown fenced blocks."
      />

      <h2>Conflict handling</h2>
      <p>
        Every read of a file returns an <strong>ETag</strong>. Write it back with{' '}
        <code className="inline-code">If-Match</code>. If the file changed since your read, the
        API answers <code className="inline-code">409 Conflict</code>. Nothing is
        overwritten. Re-read and retry.
      </p>
      <CodeBlock code={etagScript} />

      <Callout tone="warn">
        <strong>X-Confirm-Write confirms mutation intent; it does not identify or authorize the caller.</strong>{' '}
        Any caller that can reach the API can send it. Keep the API within the trusted
        single-operator boundary, and leave writes disabled unless needed.
      </Callout>
    </>
  )
}
