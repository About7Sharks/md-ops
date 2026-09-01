import { CodeBlock, Callout } from '../../components/DocBlocks'

const agentPrompt = `You are working with the MD Ops repository — a local-first Markdown operations workspace.

Setup:
1. Clone the repository and run npm run setup:ci.
2. Run npm run verify — every test suite must report 0 failures before anything else.
3. Run ./scripts/audit-public-tree.sh.
4. Start the dev server with MD_OPS_ROOTS pointing at packages/api/example-vault.
5. Verify with curl against /healthz, /readyz, and /api/tree.
6. For the full stack, use the docker compose demo.

Rules:
- Never commit .env files, tokens, or real vaults.
- Keep the default loopback binding. Never expose the server.
- Do not push branches or open PRs unless asked.`

const linkedReply = `I updated [Launch checklist](http://127.0.0.1:3098/?root=demo&path=Projects%2FLaunch+checklist.md&view=read) and verified the saved content.`

export default function AgentsDoc() {
  return (
    <>
      <h1>Using MD Ops with AI agents</h1>
      <p className="doc-lead">
        Agents use the same configured roots as the browser and API. These steps reduce accidental
        or stale writes; they do not authenticate the agent or control how its model/runtime
        handles note content.
      </p>

      <h2>Read workflow</h2>
      <ol>
        <li>
          List the roots first (<code className="inline-code">md_ops_list_roots</code>) so you
          know what is in scope.
        </li>
        <li>
          Inspect the tree (<code className="inline-code">md_ops_list_files</code>) or search (
          <code className="inline-code">md_ops_search</code>) to find the file you need.
        </li>
        <li>
          Read the current file (<code className="inline-code">md_ops_read_file</code>) and{' '}
          <strong>keep its ETag</strong>.
        </li>
        <li>
          If a mutation is coming, <strong>state the target logical path</strong> before doing
          anything. The path is the contract.
        </li>
      </ol>

      <h2>Return a note link in the message</h2>
      <p>
        <code className="inline-code">md_ops_read_file</code>,{' '}
        <code className="inline-code">md_ops_write_file</code>, and each{' '}
        <code className="inline-code">md_ops_retrieve</code> result include a browser{' '}
        <code className="inline-code">url</code>. Use that returned value as the destination of a
        named Markdown link in the agent's reply:
      </p>
      <CodeBlock code={linkedReply} label="agent reply" />
      <ul>
        <li>The human sees a note title instead of a host filesystem location.</li>
        <li>The link opens the exact logical root and relative path in MD Ops Read view.</li>
        <li>Do not replace the returned service address with a guessed hostname.</li>
      </ul>
      <Callout tone="note">
        <strong>A deep link is navigation, not access control.</strong> It works only for readers
        who can reach the configured MD Ops service. It does not authenticate or authorize them.
      </Callout>

      <h2>Mutation workflow</h2>
      <ol>
        <li>
          Confirm mutations are enabled. Check{' '}
          <code className="inline-code">MD_OPS_ALLOW_MUTATIONS=true</code> and the write tool's
          registration before writing anything.
        </li>
        <li>Write to a narrow target path. Do not write to many paths at once.</li>
        <li>
          Send the confirmation signal (<code className="inline-code">confirm_write: true</code>)
          explicitly.
        </li>
        <li>
          Pass the ETag from the last read, or use create-only semantics for a new file. A stale
          conditional request fails instead of overwriting newer content.
        </li>
        <li>Read back and verify the result. It must match what you intended.</li>
      </ol>

      <h2>Copy-paste setup prompt</h2>
      <p>
        From the repository README. Paste this into a new agent session. It tells the agent
        about the repository and its safety rules:
      </p>
      <CodeBlock code={agentPrompt} />

      <h2>Ground rules</h2>
      <ul>
        <li>Never commit <code className="inline-code">.env</code> files, tokens, or real vaults.</li>
        <li>Keep the default loopback binding; never expose the server.</li>
        <li>Do not push branches or open PRs unless asked.</li>
      </ul>

      <Callout tone="warn">
        <strong>State before you mutate.</strong> A common agent failure is writing to the wrong
        path. Announce the target path and the ETag before writing. This makes mistakes easier to
        review and catch.
      </Callout>
    </>
  )
}
