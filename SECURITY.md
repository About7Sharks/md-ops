# Security policy

MD Ops is MIT-licensed open source. The security boundary is unchanged: it remains a single-operator, local-first application (see [Supported boundary](#supported-boundary)).

## Supported boundary

MD Ops is a **single-operator, local-first** application. The supplied container publishes only to the configured loopback address. It is safe to evaluate with the synthetic demo vault and safe to use for private, backed-up Markdown data when every client is trusted.

It is not a multi-user service. It has no built-in identity, authorization, recovery trash, durable audit log, or production backup system. Do not expose it to the public internet or share it behind an unauthenticated reverse proxy.

## Safe defaults

- The container runs as a non-root numeric user.
- The application image filesystem and default vault bind mount are read-only.
- Requests with an untrusted `Host` are rejected to reduce DNS-rebinding risk.
- Linux capabilities are dropped and privilege escalation is disabled.
- Only one explicit vault bind mount is configured.
- Mutations are disabled unless `MD_OPS_ALLOW_MUTATIONS=true`.
- The MCP server disables mutation tools unless `MD_OPS_MCP_WRITE_ENABLED=true`.
- Configuration files and test artifacts are ignored by Git.

## Before enabling mutations

1. Use a narrow vault directory. Do not mount a home directory or a filesystem root.
2. Make and test a backup restore.
3. Confirm that every browser user and MCP client is trusted.
4. Set both `MD_OPS_ALLOW_MUTATIONS=true` and `MD_OPS_VAULT_READ_ONLY=false`.
5. Keep the service private. If remote access is required, add an authenticated ingress, add only its exact hostname to `MD_OPS_TRUSTED_HOSTS`, and conduct a security review first.

## Supported versions

MD Ops is pre-1.0 (`0.1.0`) and developed on a single `main` branch. Only the latest revision of `main` receives security fixes; there are no backport branches or tagged release lines.

## Reporting a vulnerability

Do not open a public issue with exploit details or credentials. Use **Security → Report a vulnerability** in the public GitHub repository. Private vulnerability reporting must be enabled before the repository is published. Include the affected commit or version, reproduction steps, impact, and a safe proof of concept.

If that private reporting control is unavailable, open only a minimal issue asking the maintainer to establish a private channel. Do not include exploit details in the issue.

## Response expectations

This is a single-maintainer project; vulnerability reports are handled on a best-effort basis and acknowledgement may not be immediate. Please keep details private until a fix is available.
