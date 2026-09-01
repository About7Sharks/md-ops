# Contributing

MD Ops is MIT-licensed open source. Contributions are welcome and are accepted under the MIT License — please follow the scope and hygiene rules below.

## Scope

Keep this distribution free of personal data, private infrastructure details, local absolute paths, credentials, screenshots of real vaults, and customer content. Use only the synthetic demo vault for tests and documentation.

## Development setup

Prerequisites:

- Bun `1.3.13` (pinned; the API, MCP, and UI test scripts run through `scripts/with-bun.sh`)
- Node.js `>= 22` with npm workspaces for installing dependencies

```bash
npm run setup      # install root, API, and documentation dependencies
npm test           # api + ui + mcp + operations test suites
```

## Required checks

Run these before proposing a change:

```bash
npm test
npm run verify
bash scripts/audit-public-tree.sh
```

`npm run verify` runs the operations tests, prepares the UI bundle, builds/tests all packages, and builds the documentation site. The public-tree audit fails on private development markers and credential-shaped values.

Do not add network exposure, authentication claims, or a production-ready label without a reviewed security design and test evidence.

## Commit and pull-request conventions

- Start commit subjects with a type or area prefix followed by an imperative summary — for example `feat(ui): …`, `fix(ui): …`, or an area prefix such as `api:`, `ui:`, or `docs+compose:` (see existing history).
- Keep commits targeted: stage only the files that belong to your change.
- Propose changes against `main`, and state in the description which required checks you ran and their results.
- Security-relevant changes must follow [SECURITY.md](SECURITY.md) and preserve the documented safe defaults.

## Configuration

Use `.env.example` as the template. Never commit a populated `.env` file, an access token, or a real vault path.
