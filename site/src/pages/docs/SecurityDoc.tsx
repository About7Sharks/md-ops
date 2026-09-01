import { Callout } from '../../components/DocBlocks'

export default function SecurityDoc() {
  return (
    <>
      <h1>Security model</h1>
      <p className="doc-lead">
        MD Ops supports one trusted operator using trusted local clients. It has no built-in
        authentication, authorization, tenant isolation, or multi-user controls.
      </p>

      <h2>Threat model</h2>
      <p>
        The supported deployment assumes the host, browser user, and MCP/agent runtime are trusted.
        Loopback binding limits network reachability by default; it is not user authentication.
        Markdown content is still treated as untrusted input.
      </p>

      <h2>Default exposure and write controls</h2>
      <ul>
        <li>
          <strong>Loopback binding by default.</strong> The supplied configuration binds to{' '}
          <code className="inline-code">127.0.0.1:3098</code>, which prevents direct LAN and
          public-internet access. Changing the bind address expands the network boundary.
        </li>
        <li>
          <strong>Trusted Host validation.</strong> Requests for hostnames outside{' '}
          <code className="inline-code">MD_OPS_TRUSTED_HOSTS</code> are rejected to reduce
          DNS-rebinding risk.
        </li>
        <li>
          <strong>Read-only by default.</strong> The vault bind mount is read-only and API
          mutations are disabled.
        </li>
        <li>
          <strong>Allowlisted roots only.</strong> Only the Markdown roots you configure are
          visible — to the browser, the API, and MCP.
        </li>
        <li>
          <strong>Deliberate writes.</strong> Every mutating call must also carry{' '}
          <code className="inline-code">X-Confirm-Write: 1</code>, and MCP writes need the full
          triple gate.
        </li>
        <li>
          <strong>No recoverable delete.</strong> Deletes are permanent. That is why backups
          are your responsibility.
        </li>
      </ul>

      <h2>What MD Ops is not</h2>
      <ul>
        <li>Not a multi-user SaaS — no accounts, no tenants, no shared workspaces.</li>
        <li>
          Not a public service — do not publish it to the internet and do not attach it to an
          untrusted network.
        </li>
        <li>
          Not a backup — keep your own copies of the vault, especially before enabling
          mutations.
        </li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Point MD Ops at a narrow dedicated directory, never a home directory or root.</li>
        <li>Add only reviewed reverse-proxy hostnames to <code className="inline-code">MD_OPS_TRUSTED_HOSTS</code>; never use a wildcard.</li>
        <li>Keep <code className="inline-code">MD_OPS_ALLOW_MUTATIONS=false</code> and <code className="inline-code">MD_OPS_VAULT_READ_ONLY=true</code> unless you need writes.</li>
        <li>Back up before mutation use. Back up on a schedule.</li>
      </ul>

      <Callout tone="warn">
        <strong>Not a multi-user SaaS.</strong> If you need shared, multi-user Markdown, this is
        not the tool. This is by design. The README is explicit: do not expose MD Ops to the
        public internet.
      </Callout>
    </>
  )
}
