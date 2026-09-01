# MD Ops

[Website](https://mdops.z4cllc.com/) · [Documentation](https://mdops.z4cllc.com/#/docs) · [Security policy](SECURITY.md)

**Release state:** public pre-release. Runtime configuration and vault data remain separate from source.

MD Ops is a **local-first Markdown operations workspace**. It gives one trusted operator a browser UI, a small HTTP API, and a stdio MCP server for safe work inside an allowlisted set of Markdown roots.

The current source tree is kept portable. It excludes user vaults, screenshots, infrastructure notes, absolute host paths, service addresses, and credentials. Before any future public release, audit and remediate the complete Git history as a separate gate.

## What is included

- `packages/ui` — React/Vite user interface for file browsing, Markdown preview, graphing, and guarded edits.
- `packages/api` — Bun HTTP API. It exposes only logical root IDs and relative paths.
- `packages/mcp` — stdio Model Context Protocol server that uses the HTTP API. It starts read-only.
- `skills/` — portable agent instructions for HTTP and MCP operation.
- `packages/api/example-vault/` — synthetic content only.

## Security boundary

MD Ops is **not** a hosted multi-user product. The supplied deployment binds the service to the configured loopback address, accepts only configured `Host` names, and disables mutations by default. It has no user login, tenant isolation, or recoverable delete. Do not publish it to the Internet, attach it to an untrusted network, or use it with irreplaceable content.

Read [SECURITY.md](SECURITY.md) before changing the bind address or enabling writes.

## Quick start: safe demo

Prerequisites:

- Docker Engine with Compose v2
- A Unix-like host that can run the supplied container

```bash
cp .env.example .env
docker compose build
docker compose up -d
docker compose ps
```

Open the address made from `MD_OPS_BIND_ADDRESS` and `MD_OPS_PORT` in `.env`. The demo mounts only `packages/api/example-vault/`. Both the API mutation gate and the vault bind mount start read-only.

Check status without exposing root paths:

```bash
curl --fail "http://$(docker compose port md-ops 3098)/readyz"
```

Stop the demo:

```bash
docker compose down
```

## Configure a real Markdown root

1. Create a narrow dedicated directory. Do not use a home directory, filesystem root, shared drive root, or a directory containing secrets.
2. Copy `.env.example` to `.env` and set `MD_OPS_VAULT_PATH` to that directory.
3. Keep `MD_OPS_ALLOW_MUTATIONS=false` for initial review.
4. Build and start again. The API rejects missing, nested, overlapping, or unreadable roots.
5. Back up the root outside MD Ops before any mutation use.

For JSON `MD_OPS_ROOTS` configuration, each root can set an optional logical `home` Markdown path. MD Ops validates that the file exists inside the root, returns only the logical path to clients, prefers that root at startup, and opens the note in Read view. Keep physical paths and private note content in runtime configuration and the mounted vault, not in repository examples.

To enable editing on a trusted local machine, set `MD_OPS_ALLOW_MUTATIONS=true` and `MD_OPS_VAULT_READ_ONLY=false`, restart the container, and recheck `/readyz`. This changes the readiness field `writes` from `disabled` to `enabled`. Keep both safe defaults unless the mounted directory has a tested backup and every client is trusted.

`MD_OPS_TRUSTED_HOSTS` is the DNS-rebinding boundary. Its default accepts only `localhost`, `127.0.0.1`, and `::1`. If an authenticated reverse proxy is reviewed and intentionally added, list its exact public hostname; never use a wildcard.

## API contract

The browser and MCP server use logical paths only:

```text
<root-id>/<relative/path.md>
```

The service does not return physical paths. Core read endpoints are `/api/roots`, `/api/tree`, `/api/search`, `/api/file`, and `/api/system-graph`. Mutating endpoints require both `MD_OPS_ALLOW_MUTATIONS=true` and `X-Confirm-Write: 1`. Updates can use `If-Match` for ETag conflict detection.

## MCP for agents

Install MCP dependencies from the repository root:

```bash
npm ci --workspace=@md-ops/mcp
npm --prefix packages/mcp run build
```

Set `MD_OPS_API_URL` to the already trusted MD Ops service address. The MCP server has **no default service address**. It refuses URLs with embedded credentials, fragments, or query strings.

Start it in a terminal that has `MD_OPS_API_URL`:

```bash
npm --prefix packages/mcp run start
```

Use the configuration template in [`docs/mcp-config.example.json`](docs/mcp-config.example.json). The server exposes read tools by default:

- `md_ops_list_roots`
- `md_ops_list_files`
- `md_ops_search`
- `md_ops_read_file`

Set `MD_OPS_MCP_WRITE_ENABLED=true` only after the API separately reports `writes: enabled`. The write tool still requires its `confirm_write` argument to be true. Every successful `md_ops_read_file` and `md_ops_write_file` response also includes a browser Read-view deep link. Agents should send the returned `url` when they create a requested file. See [`skills/md-ops-mcp/SKILL.md`](skills/md-ops-mcp/SKILL.md).

## Agent reviews

Do not ask one review agent to inspect the complete stack. Use the bounded, reusable prompts in [`docs/AGENT_REVIEWS.md`](docs/AGENT_REVIEWS.md). Each reviewer owns one component and a small exact check set. The controller must verify every reported finding independently.

## Development and verification

Use the pinned package managers listed in each package manifest. One-command gate from the repository root:

```bash
npm run setup
npm run verify
```

`npm run setup` installs the root UI/MCP workspaces, the Bun API package, and the documentation site from their committed lockfiles.

The verification gate checks repository operations and the standalone UI lockfile, builds and stages the UI bundle for the API, runs the API, UI, and MCP tests, typechecks the API, builds the MCP server, and builds the documentation site. `scripts/with-bun.sh` resolves Bun for root and package-local npm scripts, so `bun` does not need to be on your login shell PATH.

If you prefer to run the steps individually:

```bash
npm ci
bash scripts/with-bun.sh bun install --cwd packages/api --frozen-lockfile

# all package tests and builds
npm test
npm run build

# one package, from the repository root
npm run test:api
npm run build:api
npm run test:ui
npm run build:ui
npm run test:mcp
npm run build:mcp

# the same commands also work from each package directory
(cd packages/api && npm test && npm run build)
(cd packages/ui && npm test && npm run build)
(cd packages/mcp && npm test && npm run build)

# standalone UI lockfile used by Docker
npm run lock:ui:check
# after an intentional packages/ui/package.json dependency change:
npm run lock:ui:update

./scripts/audit-public-tree.sh
docker compose build
```

### Deterministic browser verification

Do not send a private MD Ops address or vault page to a public browser service. Run the local Chrome verifier against the synthetic vault instead:

```bash
npm run verify:browser:local
```

This command builds the UI, copies the synthetic vault to a temporary directory, starts a loopback API on port `39098`, checks `demo/Welcome.md`, writes ignored PNG and JSON artifacts under `artifacts/local-browser/`, and removes the temporary API and vault. Set `MD_OPS_BROWSER_PORT` only when that port is in use. It does not read `.env`. It enables UI writing only for the disposable vault copy, and the verifier fails if any capture interaction sends a mutating request.

To inspect all verifier interactions and output options:

```bash
npm run verify:browser -- --help
```

For an API that is already running, pass its trusted URL and only the interaction flags needed for the check:

```bash
npm run verify:browser -- --url http://127.0.0.1:3098/ --note demo/Welcome.md --open-files
```

The verifier waits for fonts, network idle, and every document stylesheet. It fails instead of saving a misleading pass when CSS is missing or incomplete.

### Safe upgrades and public release

Do not update a running MD Ops installation by resetting or rebuilding its live checkout in place. Prepare a separate candidate release, run its verification and readiness checks, retain the previous release, and switch only after the candidate passes.

See [Safe upgrades](docs/UPGRADING.md) for source-checkout, container, rollback, and write-enabled installation guidance. Maintainers preparing a new public repository should also follow [Public release process](docs/PUBLIC_RELEASE.md).

A trusted local clone can seed a separate deployment checkout when repository-local transport settings are required:

```bash
scripts/create-deploy-checkout.sh /path/to/new-checkout /path/to/trusted-checkout origin
```

This helper creates and verifies a new checkout. It does not build, restart, switch, or roll back a live service.

## Open source

MD Ops is released under the [MIT License](LICENSE). You are free to use, modify, and redistribute it under the license terms.

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the scope and data-hygiene rules before proposing a change.

To report a security issue, follow the private reporting steps in [SECURITY.md](SECURITY.md) — do not open a public issue with exploit details.

Thanks for checking out MD Ops — we hope it is useful to you.
