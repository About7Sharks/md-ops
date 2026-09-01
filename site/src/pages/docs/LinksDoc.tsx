import { Link } from 'react-router-dom'
import { CodeBlock, Callout } from '../../components/DocBlocks'

const linkFormat = `http://<service-address>/?root=<root-id>&path=<relative/path>&view=read

http://127.0.0.1:3098/?root=demo&path=Notes/First note.md&view=read`

const beforeAfter = `# an old agent reply: a file path
The note is at /user-notes/ideas.md

# an MD Ops agent reply: a named Markdown link
I updated [First note](http://127.0.0.1:3098/?root=demo&path=Notes%2FFirst+note.md&view=read).`

const tailscaleCommand = `# add the exact generated hostname to .env, then restart MD Ops
# MD_OPS_TRUSTED_HOSTS=localhost,127.0.0.1,::1,<machine-name>.<tailnet>.ts.net
docker compose up -d

# run this on the machine that runs MD Ops
tailscale serve --bg 3098`

const tailnetLink = `https://<machine-name>.<tailnet>.ts.net/?root=demo&path=Notes/First note.md&view=read`

export default function LinksDoc() {
  return (
    <>
      <h1>Links, not file paths</h1>
      <p className="doc-lead">
        Agents read and write your vault through MD Ops. Each response includes a link to the
        file. The agent pastes the link into the chat. You click the link. The file opens in
        the browser. You never need the physical file path.
      </p>

      <h2>Links in AI chats</h2>
      <p>
        The MCP read and write tools return a <code className="inline-code">url</code> field, and
        retrieval results include one per note. The MCP client constructs each browser deep link
        from its configured service address and the API's logical path.
      </p>
      <p>
        The agent pastes the link directly into the chat. You click it. The file opens in the
        MD Ops UI. The agent does not need the physical file path.
      </p>
      <p>These MCP results return the link:</p>
      <ul>
        <li>
          <code className="inline-code">md_ops_read_file</code> (MCP)
        </li>
        <li>
          <code className="inline-code">md_ops_write_file</code> (MCP)
        </li>
        <li>
          Each result from <code className="inline-code">md_ops_retrieve</code>
        </li>
      </ul>

      <h2>The link format</h2>
      <p>
        The link carries three pieces of information: the service address, the logical root
        ID, and the relative path of the file. It never exposes a physical filesystem path.
      </p>
      <CodeBlock code={linkFormat} label="the deep link format" />
      <p>
        The UI reads the root, the path, and the view from the URL when it loads. The{' '}
        <code className="inline-code">view=read</code> parameter opens the file in Read view.
      </p>
      <p>This is the intended handoff. Agents share a named link. The MD Ops link does not contain{' '}
        a physical path such as <code className="inline-code">/user-notes/...</code>.
      </p>
      <p>An agent reply changes from a file path to a link:</p>
      <CodeBlock code={beforeAfter} label="a file path versus a link" />

      <h2>Tailscale access</h2>
      <p>
        MD Ops binds to <code className="inline-code">127.0.0.1</code> by default, so it is not
        directly reachable from the LAN or public internet. This limits network exposure; it does
        not provide user authentication.
      </p>
      <p>
        One private access option is Tailscale Serve. Before starting it, add the exact generated
        tailnet hostname to <code className="inline-code">MD_OPS_TRUSTED_HOSTS</code> and restart
        MD Ops. Then run these commands on the machine that runs MD Ops:
      </p>
      <CodeBlock code={tailscaleCommand} label="from the machine that runs MD Ops" />
      <p>
        Tailscale Serve creates a private HTTPS address. It looks like{' '}
        <code className="inline-code">
          {'https://<machine-name>.<tailnet>.ts.net/'}
        </code>
        . Access depends on your tailnet membership and policy. Verify both before exposing MD Ops
        through it.
      </p>
      <p>After Tailscale Serve, the deep links use the new address:</p>
      <CodeBlock code={tailnetLink} label="the deep link on the tailnet" />
      <p>
        An agent working on your phone or laptop can now return a link. It is reachable on devices
        and by identities permitted by your reviewed tailnet policy.
      </p>
      <p>
        Remote access expands the MD Ops trust boundary. MD Ops still has no login or per-user
        authorization, so every permitted tailnet user and client must be trusted.
      </p>
      <Callout tone="warn">
        <strong>Do not expose MD Ops to the public internet.</strong> MD Ops has no login and
        no multi-user authentication. Use this only on a single-operator tailnet with reviewed
        access rules, never enable Tailscale Funnel, and see the{' '}
        <Link to="/docs/security">Security model</Link>.
      </Callout>
      <p>
        When you set the API or MCP service URL for Tailscale access, use the{' '}
        <code className="inline-code">https://...ts.net/</code> address. Do not use{' '}
        <code className="inline-code">http://127.0.0.1:3098/</code>. Then the links agents
        produce are reachable from other devices.
      </p>
    </>
  )
}
