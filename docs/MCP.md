# MCP integration

MD Ops uses a stdio MCP server. The server does not listen on a network port. It sends requests only to the MD Ops HTTP API specified by `MD_OPS_API_URL`.

## Preconditions

- The API must already be running inside the same trusted security boundary.
- Build the MCP package before its first use with `npm --prefix packages/mcp run build`. The packaged start command also runs this build step.
- The API endpoint must be a complete HTTP or HTTPS URL without embedded credentials, query parameters, or fragments.
- Do not point the MCP server at a public or shared service until MD Ops has authentication, authorization, and tenant isolation.

## Tool behavior

Read tools are registered at startup. `md_ops_write_file` is registered only when `MD_OPS_MCP_WRITE_ENABLED=true`.

The MCP server is not an authorization layer. A write needs all three gates:

1. The API has `MD_OPS_ALLOW_MUTATIONS=true`.
2. The MCP process has `MD_OPS_MCP_WRITE_ENABLED=true`.
3. The tool call has `confirm_write: true`.

Use an ETag from `md_ops_read_file` when overwriting an existing file. This avoids blind replacement when another writer changed it.

`md_ops_read_file` and `md_ops_write_file` return a `url` field. It is a browser deep link to the logical file in MD Ops Read view. After creating a file, an agent can send this link directly to the user; it contains only the configured service address, logical root ID, and relative file path.

`md_ops_retrieve` is an optional read-only QMD keyword-retrieval tool. It returns results only for roots explicitly mapped to a local QMD collection by the MD Ops API. It returns at most eight canonical logical paths, short excerpts, scores, and MD Ops Read-view links. Use it to find a small ranked shortlist, then call `md_ops_read_file` for the selected note. It does not expose QMD filesystem paths or `qmd://` URIs.

## Example configuration

Copy `mcp-config.example.json` into your MCP client's local configuration and replace only the placeholder values. Keep real service URLs and access tokens in client-local environment configuration, not in this repository.

## Agent instructions

Package the `skills/` directory with the service. Agents should load `skills/md-ops/SKILL.md` for API behavior and `skills/md-ops-mcp/SKILL.md` for MCP behavior.
