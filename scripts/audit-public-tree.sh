#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Fail closed on private development markers and values that look like committed
# credentials. This is a first-pass release gate, not a replacement for human
# review or a secret scanner with entropy detection.
mapfile -d '' files < <(git ls-files -z --cached --others --exclude-standard)
if ((${#files[@]} == 0)); then
  printf 'No source files found to audit.\n' >&2
  exit 2
fi

private_pattern='(/home/[^/[:space:]]+|/Users/[^/[:space:]]+|\\\\Users\\\\[^\\\\[:space:]]+|10\.[[:digit:]]{1,3}\.[[:digit:]]{1,3}\.[[:digit:]]{1,3}|192\.168\.[[:digit:]]{1,3}\.[[:digit:]]{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.[[:digit:]]{1,3}\.[[:digit:]]{1,3}|[[:alnum:]-]+\.ts\.net)'
secret_pattern='((API[_-]?KEY|SECRET|TOKEN|PASSWORD)[[:space:]]*[:=][[:space:]]*["'\'' ]?[^<${[:space:]][^[:space:]"'\'']{7,})'

matches=0
for file in "${files[@]}"; do
  [[ -f "$file" ]] || continue
  case "$file" in
    node_modules/*|*/node_modules/*|*.png|*.jpg|*.jpeg|*.webp|*.gif|*.pdf|package-lock.json|scripts/audit-public-tree.sh|scripts/audit-public-history.py)
      continue
      ;;
  esac
  if grep -nEI "$private_pattern" -- "$file"; then
    printf 'Private development marker in %s\n' "$file" >&2
    matches=1
  fi
  if grep -nE "$secret_pattern" -- "$file"; then
    printf 'Credential-shaped value in %s\n' "$file" >&2
    matches=1
  fi
done

if ((matches)); then
  printf 'Public-tree audit failed. Remove or redact every finding before export.\n' >&2
  exit 1
fi

printf 'Public-tree audit passed: no configured private-development markers or credential-shaped values found.\n'
