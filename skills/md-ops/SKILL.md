---
name: md-ops
description: Use when an agent must inspect or edit Markdown through an MD Ops service. Read first, use logical paths, and require explicit mutation confirmation.
license: MIT
metadata:
  tags: [markdown, documentation, operations, safe-editing]
---

# MD Ops

## Scope

MD Ops exposes configured Markdown roots through logical paths. A logical path has the form `<root-id>/<relative-path>`. It never requires an agent to know a physical filesystem path.

## Read workflow

1. List roots before selecting a root.
2. Inspect the file tree or search results.
3. Read the current file before proposing an edit.
4. Keep the returned ETag when a client supports conditional writes.
5. State the target logical path and expected change before mutation.

## Mutation workflow

1. Confirm that mutations are enabled for this service.
2. Write only a narrow target file.
3. Send the service write-confirmation signal.
4. Use the last ETag for an update; use create-only behavior for a new file.
5. Read the saved file back and verify the exact intended result.

## Do not

- Guess root IDs or physical paths.
- Mount, browse, or request a user home directory.
- Read secret files, credentials, private keys, or environment files.
- Delete files or folders unless the user explicitly asks and has reviewed the target.
- Treat the write confirmation header as authentication.

## Security boundary

MD Ops is intended for trusted, private use. Do not expose an unauthenticated service to an untrusted network. Do not place service URLs, tokens, customer names, or private Markdown examples in skills or source control.
