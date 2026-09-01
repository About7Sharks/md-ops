import { Link } from 'react-router-dom'
import { Callout } from '../../components/DocBlocks'

const envVars: Array<[string, string, string]> = [
  ['MD_OPS_BIND_ADDRESS', '127.0.0.1', 'Interface the API and browser UI bind to. Keep the loopback default.'],
  ['MD_OPS_PORT', '3098', 'HTTP port for the API and browser UI.'],
  ['MD_OPS_TRUSTED_HOSTS', 'localhost,127.0.0.1,::1', 'Exact accepted hostnames. Add a reviewed reverse-proxy hostname; never use a wildcard.'],
  ['MD_OPS_IMAGE', 'md-ops:0.1.0', 'Docker image tag the Compose stack uses.'],
  ['MD_OPS_VAULT_PATH', './packages/api/example-vault', 'Filesystem path of the Markdown root the container mounts.'],
  ['MD_OPS_VAULT_READ_ONLY', 'true', 'Filesystem-level write gate for the mounted Markdown root.'],
  ['MD_OPS_ROOT_ID', 'demo', 'Logical id of the root. Logical paths such as demo/Notes/... use it.'],
  ['MD_OPS_ROOT_LABEL', 'Demo vault', 'Human-readable label. The browser and API responses show it.'],
  ['MD_OPS_UID', '1000', 'Numeric user id the container runs as.'],
  ['MD_OPS_GID', '1000', 'Numeric group id the container runs as.'],
  ['MD_OPS_ALLOW_MUTATIONS', 'false', 'Master switch for write access. The service stays read-only unless you set this to true.'],
]

export default function ConfigureDoc() {
  return (
    <>
      <h1>Configuration</h1>
      <p className="doc-lead">
        The demo vault is for testing. To use MD Ops with your own Markdown, point it at a
        narrow dedicated directory. Decide when to enable mutations, if ever.
      </p>

      <h2>Environment variables</h2>
      <p>
        The Compose stack reads everything from <code className="inline-code">.env</code>, copied
        from <code className="inline-code">.env.example</code>:
      </p>
      <div className="table-wrap">
        <table className="doc-table">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Default</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {envVars.map(([name, def, desc]) => (
              <tr key={name}>
                <td>
                  <code>{name}</code>
                </td>
                <td>
                  <code>{def}</code>
                </td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Point at a real Markdown root</h2>
      <ol>
        <li>
          Create a <strong>narrow, dedicated directory</strong> for MD Ops — never your home
          directory and never the filesystem root.
        </li>
        <li>
          Set <code className="inline-code">MD_OPS_VAULT_PATH</code> to that directory.
        </li>
        <li>
          Start the stack. The API rejects missing, nested, overlapping, or unreadable roots at
          startup. It will not silently serve the wrong thing.
        </li>
      </ol>
      <p>
        MD Ops addresses everything with <strong>logical paths</strong> in the form{' '}
        <code className="inline-code">{'<root-id>/<relative-path>'}</code>. The browser and API
        responses expose root IDs and labels. They never expose physical paths. You see the
        vault as a logical workspace, not a filesystem dump.
      </p>

      <h2>Trusted hosts and reverse proxies</h2>
      <p>
        MD Ops rejects requests whose hostname is not in <code className="inline-code">MD_OPS_TRUSTED_HOSTS</code>.
        This is a DNS-rebinding defense. The default accepts only loopback names. If you intentionally place an
        authenticated reverse proxy in front of MD Ops, add only that proxy's exact external hostname and keep the
        backend bound to loopback.
      </p>

      <h2>Enable mutations</h2>
      <p>
        MD Ops is read-only by default. Set <code className="inline-code">MD_OPS_ALLOW_MUTATIONS=true</code>{' '}
        and <code className="inline-code">MD_OPS_VAULT_READ_ONLY=false</code> only after you have a
        tested backup and only when you trust the clients that talk to it. It is a
        single-operator tool.
      </p>
      <p>
        Even with mutations enabled, every mutating call must also send{' '}
        <code className="inline-code">X-Confirm-Write: 1</code>. That header is an{' '}
        <strong>intent signal, not authentication</strong>. Any caller that can reach the API can
        send it. Use it only inside the supported trusted boundary.
      </p>

      <h2>Back up before you trust it</h2>
      <ul>
        <li>Deletes are permanent. There is no recoverable delete.</li>
        <li>Back up the vault directory before the first mutation use. Back up on a schedule.</li>
        <li>Keep the read-only default for anything you only review.</li>
      </ul>

      <Callout tone="warn">
        <strong>One operator, one machine.</strong> Do not expose an instance with mutations
        enabled to a network you do not fully trust. See the{' '}
        <Link to="/docs/security">Security model</Link>.
      </Callout>
    </>
  )
}
