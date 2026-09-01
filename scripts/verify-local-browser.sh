#!/usr/bin/env bash
# Run the deterministic Chrome verifier against a local API and synthetic vault.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${MD_OPS_BROWSER_PORT:-39098}"
artifact_directory="${MD_OPS_BROWSER_ARTIFACT_DIR:-$repo_root/artifacts/local-browser}"
server_log="$artifact_directory/api.log"
server_pid=""
temporary_vault=""

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  cat <<'EOF'
Usage: npm run verify:browser:local -- [interaction options]

This command owns --url, --note, --output, and --report. Use the interaction,
viewport, timing, or Chrome options listed below.
EOF
  npm run --silent verify:browser -- --help
  exit 0
fi
for argument in "$@"; do
  case "$argument" in
    --url|--url=*|--note|--note=*|--output|--output=*|--report|--report=*)
      echo "verify:browser:local owns $argument; use npm run verify:browser for a custom target" >&2
      exit 2
      ;;
  esac
done

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid"
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ -n "$temporary_vault" ]]; then
    rm -rf "$temporary_vault"
  fi
}
trap cleanup EXIT

if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1024 || port > 65535 )); then
  echo "MD_OPS_BROWSER_PORT must be an unused port from 1024 through 65535" >&2
  exit 2
fi
if node -e "const n=require('node:net').connect({host:'127.0.0.1',port:$port});n.once('connect',()=>process.exit(0));n.once('error',()=>process.exit(1))"; then
  echo "MD_OPS_BROWSER_PORT is already in use: $port" >&2
  exit 1
fi

mkdir -p "$artifact_directory"
cd "$repo_root"
./scripts/prepare-ui-bundle.sh

temporary_vault="$(mktemp -d)"
cp -R "$repo_root/packages/api/example-vault/." "$temporary_vault/"
roots_json="$(node -e 'process.stdout.write(JSON.stringify([{ id: "demo", label: "Demo vault", path: process.argv[1], home: "Welcome.md" }]))' "$temporary_vault")"
(
  cd "$repo_root/packages/api"
  exec env HOST=127.0.0.1 PORT="$port" MD_OPS_ALLOW_MUTATIONS=true MD_OPS_ROOTS="$roots_json" \
    ../../scripts/with-bun.sh bun run src/index.ts
) >"$server_log" 2>&1 &
server_pid=$!

ready_url="http://127.0.0.1:$port/readyz"
for _ in {1..100}; do
  if curl --fail --silent "$ready_url" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Local API exited before it became ready. See $server_log" >&2
    exit 1
  fi
  sleep 0.1
done
if ! curl --fail --silent "$ready_url" >/dev/null; then
  echo "Local API did not become ready. See $server_log" >&2
  exit 1
fi

npm --prefix packages/ui run verify:mobile -- \
  --url "http://127.0.0.1:$port/" \
  --note demo/Welcome.md \
  --output "$artifact_directory/mobile.png" \
  --report "$artifact_directory/mobile.json" \
  "$@"
