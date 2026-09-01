#!/usr/bin/env bash
# Build and verify the public Compose image in safe and writable modes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly_project="mdops-verify-readonly-$$"
writable_project="mdops-verify-writable-$$"
standalone_container="mdops-verify-image-health-$$"
temporary_directory="$(mktemp -d)"
image="md-ops:0.1.0"

compose() {
  local project="$1"
  local port="$2"
  local vault="$3"
  local vault_read_only="$4"
  local allow_mutations="$5"
  shift 5
  MD_OPS_IMAGE="$image" \
  MD_OPS_PORT="$port" \
  MD_OPS_VAULT_PATH="$vault" \
  MD_OPS_VAULT_READ_ONLY="$vault_read_only" \
  MD_OPS_ALLOW_MUTATIONS="$allow_mutations" \
    docker compose --env-file /dev/null --project-name "$project" "$@"
}

cleanup() {
  docker rm --force "$standalone_container" >/dev/null 2>&1 || true
  compose "$readonly_project" 0 "$repo_root/packages/api/example-vault" true false down --volumes --remove-orphans >/dev/null 2>&1 || true
  compose "$writable_project" 0 "$temporary_directory/vault" false true down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
}
trap cleanup EXIT

wait_for_ready() {
  local url="$1"
  local output="$2"
  local project="$3"
  local port="$4"
  local vault="$5"
  local vault_read_only="$6"
  local allow_mutations="$7"
  for _ in $(seq 1 60); do
    if curl --fail --silent --show-error "$url" >"$output"; then
      return 0
    fi
    sleep 1
  done
  compose "$project" "$port" "$vault" "$vault_read_only" "$allow_mutations" logs >&2 || true
  return 1
}

if [[ "${1:-}" == "--skip-build" ]]; then
  shift
else
  echo "[container] build refreshed image"
  MD_OPS_IMAGE="$image" docker compose --env-file /dev/null build --pull
fi
if [[ "$#" -ne 0 ]]; then
  echo "usage: $0 [--skip-build]" >&2
  exit 2
fi

cd "$repo_root"

echo "[container] verify image-level health check"
docker run --detach --rm \
  --name "$standalone_container" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --mount "type=bind,source=$repo_root/packages/api/example-vault,target=/vaults/main,readonly" \
  --env 'MD_OPS_ROOTS=[{"id":"demo","label":"Demo vault","path":"/vaults/main","home":"Welcome.md"}]' \
  "$image" >/dev/null
standalone_health="starting"
for _ in $(seq 1 60); do
  standalone_health="$(docker inspect "$standalone_container" --format '{{.State.Health.Status}}')"
  if [[ "$standalone_health" == "healthy" ]]; then
    break
  fi
  if [[ "$standalone_health" == "unhealthy" ]]; then
    docker logs "$standalone_container" >&2 || true
    exit 1
  fi
  sleep 1
done
test "$standalone_health" = "healthy"
echo "image_health=$standalone_health"
docker rm --force "$standalone_container" >/dev/null

echo "[container] verify read-only defaults"
compose "$readonly_project" 0 "$repo_root/packages/api/example-vault" true false up -d --no-build
readonly_address="$(compose "$readonly_project" 0 "$repo_root/packages/api/example-vault" true false port md-ops 3098)"
readonly_url="http://${readonly_address}"
wait_for_ready "$readonly_url/readyz" "$temporary_directory/readonly-ready.json" \
  "$readonly_project" 0 "$repo_root/packages/api/example-vault" true false
node -e '
  const fs = require("fs");
  const status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (status.ready !== true || status.writes !== "disabled" || status.ui !== "bundled") {
    throw new Error(`unexpected read-only readiness: ${JSON.stringify(status)}`);
  }
' "$temporary_directory/readonly-ready.json"
readonly_container="$(compose "$readonly_project" 0 "$repo_root/packages/api/example-vault" true false ps -q md-ops)"
readonly_mount="$(docker inspect "$readonly_container" --format '{{range .Mounts}}{{if eq .Destination "/vaults/main"}}{{.RW}}{{end}}{{end}}')"
test "$readonly_mount" = "false"
untrusted_status="$(curl --silent --output "$temporary_directory/untrusted.json" --write-out '%{http_code}' \
  -H 'Host: attacker.example' "$readonly_url/api/roots")"
test "$untrusted_status" = "421"
node -e '
  const fs = require("fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (body.error !== "untrusted host") throw new Error(`unexpected host rejection: ${JSON.stringify(body)}`);
' "$temporary_directory/untrusted.json"
echo "read_only_ready=true mount_rw=$readonly_mount untrusted_host=$untrusted_status"
compose "$readonly_project" 0 "$repo_root/packages/api/example-vault" true false down --volumes --remove-orphans

echo "[container] verify explicit writable mode against a temporary vault"
mkdir -p "$temporary_directory/vault"
cp -a "$repo_root/packages/api/example-vault/." "$temporary_directory/vault/"
# The synthetic fixture must be accessible when the host runner UID differs
# from the fixed non-root container UID. Real vault permissions are unchanged.
chmod -R a+rwX "$temporary_directory/vault"
compose "$writable_project" 0 "$temporary_directory/vault" false true up -d --no-build
writable_address="$(compose "$writable_project" 0 "$temporary_directory/vault" false true port md-ops 3098)"
writable_url="http://${writable_address}"
wait_for_ready "$writable_url/readyz" "$temporary_directory/writable-ready.json" \
  "$writable_project" 0 "$temporary_directory/vault" false true
node -e '
  const fs = require("fs");
  const status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (status.ready !== true || status.writes !== "enabled") {
    throw new Error(`unexpected writable readiness: ${JSON.stringify(status)}`);
  }
' "$temporary_directory/writable-ready.json"
writable_container="$(compose "$writable_project" 0 "$temporary_directory/vault" false true ps -q md-ops)"
writable_mount="$(docker inspect "$writable_container" --format '{{range .Mounts}}{{if eq .Destination "/vaults/main"}}{{.RW}}{{end}}{{end}}')"
test "$writable_mount" = "true"
printf '# Container verification\n' >"$temporary_directory/request.md"
curl --fail --silent --show-error --request PUT \
  -H 'X-Confirm-Write: 1' \
  -H 'If-None-Match: *' \
  -H 'Content-Type: text/markdown' \
  --data-binary "@$temporary_directory/request.md" \
  "$writable_url/api/file?path=demo/Projects/Container-verification.md" \
  >"$temporary_directory/write-response.json"
cmp "$temporary_directory/request.md" "$temporary_directory/vault/Projects/Container-verification.md"
echo "writable_ready=true mount_rw=$writable_mount verified_write=true"
