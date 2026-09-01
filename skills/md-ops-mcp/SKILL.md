---
name: md-ops-mcp
description: Use when an agent connects to an MD Ops MCP server. Start read-only and enable write tools only with explicit configuration and confirmation.
license: MIT
metadata:
  tags: [mcp, markdown, documentation, safe-editing]
---

# MD Ops MCP

## Configuration

The MCP process requires `MD_OPS_API_URL`. Supply it through the host agent's secret or environment configuration, not through a committed MCP config file. The URL must point to a trusted MD Ops API.

The server exposes read tools by default:

- `md_ops_list_roots`
- `md_ops_list_files`
- `md_ops_search` — deterministic lexical search
- `md_ops_retrieve` — QMD-ranked keyword retrieval, only where the API has an explicit root-to-collection mapping
- `md_ops_read_file`

It exposes `md_ops_write_file` only when both conditions hold:

1. `MD_OPS_MCP_WRITE_ENABLED=true` is set before process start.
2. The tool call sets `confirm_write=true`.

## Agent procedure

1. Call `md_ops_list_roots`.
2. Use a root ID returned by the service.
3. For a broad or conceptual vault question, call `md_ops_retrieve` with a short query and a limit of 3–5. It returns only a bounded ranked shortlist. Use `md_ops_search` for exact terms, filenames, or deterministic line matches.
4. Read only the selected file with `md_ops_read_file` before changing it.
5. For a write, explain the specific logical path and intended change in the agent response, then call `md_ops_write_file` with explicit confirmation.
6. Read the file back after a successful write.
7. Send the returned `url` to the user when the file is a requested deliverable. It opens MD Ops in read view and exposes no physical filesystem path.

## Do not

- Enable write tools in a shared or untrusted agent host.
- Put URLs, authorization tokens, or real vault paths into a skill, prompt, or repository.
- Delete through the MCP. MD Ops MCP v0.1 deliberately has no delete tool.
