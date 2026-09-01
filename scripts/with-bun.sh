#!/usr/bin/env bash
# Run a command with Bun on PATH. npm scripts do not always inherit ~/.bun/bin,
# so every package-local Bun test and API build uses this wrapper.
set -euo pipefail

# Already on PATH?
if command -v bun >/dev/null 2>&1; then
  exec "$@"
fi

# Real user home (this script may run under a sandboxed HOME). getent is not
# supplied by macOS, so its absence must not stop the fallback search.
real_home="$HOME"
if command -v getent >/dev/null 2>&1; then
  passwd_home="$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6 || true)"
  real_home="${passwd_home:-$real_home}"
fi

for candidate in "${BUN_INSTALL:-$real_home/.bun}/bin/bun" "$real_home/.bun/bin/bun" "$HOME/.bun/bin/bun" /usr/local/bin/bun /opt/homebrew/bin/bun; do
  if [ -x "$candidate" ]; then
    export PATH="${candidate%/*}:$PATH"
    break
  fi
done

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found. Install it: curl -fsSL https://bun.sh/install | bash" >&2
  exit 127
fi

exec "$@"
