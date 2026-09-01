#!/usr/bin/env bash
# Verify the standalone UI lockfile without letting npm use the repository workspace.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

cp "$repo_root/packages/ui/package.json" "$repo_root/packages/ui/package-lock.json" "$temporary_directory/"

# `npm ci` already fails when package.json and package-lock.json disagree.
# Do not regenerate the lockfile here: npm releases can rewrite harmless lockfile
# metadata (for example peer flags), which made verification depend on the
# contributor's exact npm patch version.
(
  cd "$temporary_directory"
  npm ci --ignore-scripts --workspaces=false >/dev/null
)

printf 'Standalone UI lockfile passed npm ci.\n'
