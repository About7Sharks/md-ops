#!/usr/bin/env bash
# Seed a deployment checkout from an existing trusted clone, then restore its remote.
# This avoids a bootstrap clone over SSH while preserving repository-local SSH settings.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/create-deploy-checkout.sh <target-directory> [source-checkout] [remote]

Creates target-directory from source-checkout (default: this repository), copies
repository-local Git transport settings, restores the selected remote URL, and
verifies that the remote is reachable. The target must not already exist.
EOF
}

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  usage
  exit 0
fi
if (( $# < 1 || $# > 3 )); then
  usage >&2
  exit 2
fi

target="$1"
source_checkout="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
remote="${3:-origin}"

if [[ ! "$remote" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "remote must contain only letters, numbers, dot, underscore, or hyphen" >&2
  exit 2
fi
if [[ -e "$target" ]]; then
  echo "target already exists: $target" >&2
  exit 1
fi
if ! git -C "$source_checkout" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "source checkout is not a Git worktree: $source_checkout" >&2
  exit 1
fi

source_checkout="$(cd "$source_checkout" && pwd)"

absolute_transport_url() {
  local url="$1"
  local before_colon
  case "$url" in
    /*|~*|*://* ) printf '%s\n' "$url" ;;
    *:* )
      # Git uses SCP syntax only when the colon occurs before any slash.
      before_colon="${url%%:*}"
      if [[ "$before_colon" != */* ]]; then
        printf '%s\n' "$url"
      else
        node -e 'process.stdout.write(require("node:path").resolve(process.argv[1], process.argv[2]))' "$source_checkout" "$url"
      fi
      ;;
    * ) node -e 'process.stdout.write(require("node:path").resolve(process.argv[1], process.argv[2]))' "$source_checkout" "$url" ;;
  esac
}

# A relative local remote is relative to the source checkout. Convert it before
# moving the configuration to a target that can have a different parent.
source_fetch_urls=()
source_push_urls=()
while IFS= read -r url; do source_fetch_urls+=("$url"); done < <(git -C "$source_checkout" remote get-url --all "$remote")
while IFS= read -r url; do source_push_urls+=("$url"); done < <(git -C "$source_checkout" remote get-url --push --all "$remote")
if (( ${#source_fetch_urls[@]} == 0 || ${#source_push_urls[@]} == 0 )); then
  echo "source checkout has no usable remote named $remote" >&2
  exit 1
fi
fetch_urls=()
push_urls=()
for url in "${source_fetch_urls[@]}"; do fetch_urls+=("$(absolute_transport_url "$url")"); done
for url in "${source_push_urls[@]}"; do push_urls+=("$(absolute_transport_url "$url")"); done

git clone --local --no-hardlinks --origin "$remote" "$source_checkout" "$target"
git -C "$target" config --local --unset-all "remote.$remote.url" || true
git -C "$target" config --local --unset-all "remote.$remote.pushurl" || true
for url in "${fetch_urls[@]}"; do git -C "$target" config --local --add "remote.$remote.url" "$url"; done
for url in "${push_urls[@]}"; do git -C "$target" config --local --add "remote.$remote.pushurl" "$url"; done

copy_local_setting() {
  local key="$1"
  local value
  if value="$(git -C "$source_checkout" config --local --get "$key")"; then
    git -C "$target" config --local "$key" "$value"
  fi
}

# These settings can select an SSH identity, variant, proxy, or remote helper.
# They stay in .git/config and are never added to the source tree.
copy_local_setting core.sshCommand
copy_local_setting ssh.variant
copy_local_setting "remote.$remote.proxy"
copy_local_setting "remote.$remote.proxyAuthMethod"
copy_local_setting "remote.$remote.uploadpack"
copy_local_setting "remote.$remote.receivepack"

if ! git -C "$target" ls-remote --exit-code "$remote" HEAD >/dev/null; then
  echo "checkout was created, but remote verification failed: $target" >&2
  echo "Review its repository-local Git transport settings before deployment." >&2
  exit 1
fi

printf 'Deployment checkout created and remote verified: %s\n' "$target"
