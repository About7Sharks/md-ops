import { Link } from 'react-router-dom'
import { CodeBlock, Callout } from '../../components/DocBlocks'

const setupScript = `# from the md-ops repository root
cp .env.example .env
docker compose build
docker compose up -d`

const verifyScript = `# confirm the stack is up
docker compose ps

# readiness probe — reports writes: enabled|disabled and ui: bundled
curl --fail "http://\${MD_OPS_BIND_ADDRESS}:\${MD_OPS_PORT}/readyz"`

const stopScript = `docker compose down`

export default function QuickstartDoc() {
  return (
    <>
      <h1>Quick start</h1>
      <p className="doc-lead">
        Run MD Ops on your machine with Docker Compose. You do not need an account or a cloud
        service. The demo mounts only the bundled example vault. It is read-only by default.
      </p>

      <h2>Requirements</h2>
      <ul>
        <li>Docker with the Compose plugin</li>
        <li>
          Nothing else. You do not need a database, a Node runtime for the demo, or an account.
        </li>
      </ul>

      <h2>1. Copy the example environment</h2>
      <p>
        The <code className="inline-code">.env.example</code> file sets safe local defaults. It
        binds to <code className="inline-code">127.0.0.1:3098</code>. It mounts the bundled demo
        vault read-only. API mutations are also disabled.
      </p>
      <CodeBlock code={setupScript} label="from the md-ops repository root" />

      <h2>2. Verify it is healthy</h2>
      <p>
        <code className="inline-code">docker compose ps</code> shows the container state. The{' '}
        <code className="inline-code">/readyz</code> endpoint reports{' '}
        <code className="inline-code">writes: enabled|disabled</code> and{' '}
        <code className="inline-code">ui: bundled</code>. A read-only demo reports{' '}
        <code className="inline-code">writes: disabled</code>.
      </p>
      <CodeBlock code={verifyScript} />

      <h2>3. Open the workspace</h2>
      <p>
        Browse to <code className="inline-code">http://127.0.0.1:3098</code>. The demo exposes
        one root labelled <code className="inline-code">Demo vault</code>. You can browse the
        tree, read files, and search. Everything is read-only until you enable mutations.
      </p>

      <h2>4. Stop the stack</h2>
      <CodeBlock code={stopScript} />

      <Callout tone="warn">
        <strong>This is a demo.</strong> It mounts only{' '}
        <code className="inline-code">packages/api/example-vault/</code> and is read-only. Before you trust MD
        Ops with real notes, point it at a narrow dedicated directory. See{' '}
        <Link to="/docs/configure">Configuration</Link>. Keep backups.
      </Callout>
    </>
  )
}
