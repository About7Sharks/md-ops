#!/usr/bin/env bash
# Export the current source bytes into a new, history-free Git repository.
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
destination="${1:-}"

if [[ -z "$destination" ]]; then
  printf 'Usage: %s /path/to/new-public-repository\n' "$0" >&2
  exit 2
fi

destination="$(realpath -m "$destination")"
case "$destination/" in
  "$repo_root/"*)
    printf 'Destination must be outside the private source repository.\n' >&2
    exit 2
    ;;
esac

if [[ -e "$destination" ]] && [[ -n "$(find "$destination" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  printf 'Destination exists and is not empty: %s\n' "$destination" >&2
  exit 2
fi

cd "$repo_root"

if [[ "${MD_OPS_EXPORT_SKIP_VERIFY:-0}" != "1" ]]; then
  npm run verify
fi
./scripts/audit-public-tree.sh
git diff --check

mkdir -p "$destination"
mapfile -d '' files < <(git ls-files -z --cached --others --exclude-standard)
if ((${#files[@]} == 0)); then
  printf 'No source files found to export.\n' >&2
  exit 2
fi

copied=0
for file in "${files[@]}"; do
  [[ -f "$file" ]] || continue
  install -D -m "$(stat -c '%a' "$file")" -- "$file" "$destination/$file"
  copied=$((copied + 1))
done

git -C "$destination" init --quiet --initial-branch=main
git -C "$destination" add --all
git -C "$destination" diff --cached --check
(
  cd "$destination"
  ./scripts/audit-public-tree.sh
  git ls-files -z \
    | grep -zvxF 'PUBLIC_SOURCE_MANIFEST.sha256' \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum > PUBLIC_SOURCE_MANIFEST.sha256
)
git -C "$destination" add PUBLIC_SOURCE_MANIFEST.sha256
git -C "$destination" diff --cached --check

printf 'Public snapshot staged without commits or remotes.\n'
printf 'destination=%s\n' "$destination"
printf 'files=%d\n' "$copied"
printf 'manifest=%s\n' "$destination/PUBLIC_SOURCE_MANIFEST.sha256"
