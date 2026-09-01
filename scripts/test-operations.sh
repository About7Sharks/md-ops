#!/usr/bin/env bash
# Fast regression checks for repository operations scripts and command discovery.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT
cd "$repo_root"

printf '[operations] standalone UI lockfile\n'
./scripts/verify-ui-lockfile.sh

printf '[operations] Bun discovery outside the login PATH\n'
bun_version="$(PATH=/usr/bin:/bin ./scripts/with-bun.sh bun --version)"
required_bun_version="$(node -p "require('./packages/api/package.json').engines.bun")"
[[ "$bun_version" == "$required_bun_version" ]]
mkdir -p "$temporary_directory/minimal-path" "$temporary_directory/test-user-home/.bun/bin"
ln -s "$(command -v bash)" "$temporary_directory/minimal-path/bash"
# Seed the simulated home with the pinned Bun resolved outside the login PATH
# (the same binary the version check above validates), so this exercises the
# wrapper's discovery fallbacks rather than whichever Bun the login PATH carries.
pinned_bun="$(PATH=/usr/bin:/bin ./scripts/with-bun.sh bash -c 'command -v bun')"
ln -s "$pinned_bun" "$temporary_directory/test-user-home/.bun/bin/bun"
bun_without_getent="$(HOME="$temporary_directory/test-user-home" PATH="$temporary_directory/minimal-path" /bin/bash ./scripts/with-bun.sh bun --version)"
[[ "$bun_without_getent" == "$required_bun_version" ]]

printf '[operations] root browser-verifier help\n'
help_text="$(npm run --silent verify:browser -- --help)"
for option in --url --note --output --report --open-files --open-toolbar-menu --open-graph --enable-writing --append-text --open-changes --open-create --desktop --settle-ms --chrome; do
  grep -q -- "$option" <<<"$help_text" || { echo "missing verifier help option: $option" >&2; exit 1; }
done
if ./scripts/verify-local-browser.sh --url https://example.invalid >"$temporary_directory/local-browser.out" 2>&1; then
  echo 'local browser verifier accepted a caller-controlled URL' >&2
  exit 1
fi
grep -q 'owns --url' "$temporary_directory/local-browser.out"

printf '[operations] deployment checkout seeding and local SSH configuration\n'
mkdir -p "$temporary_directory/remotes"
git init --bare --quiet "$temporary_directory/remotes/origin:backup.git"
git init --bare --quiet "$temporary_directory/remote-push.git"
git init --quiet "$temporary_directory/source"
git -C "$temporary_directory/source" config user.name 'MD Ops Test'
git -C "$temporary_directory/source" config user.email 'md-ops-test@example.invalid'
printf 'seed\n' >"$temporary_directory/source/README.md"
git -C "$temporary_directory/source" add README.md
git -C "$temporary_directory/source" commit --quiet -m seed
git -C "$temporary_directory/source" branch -M main
git -C "$temporary_directory/remotes/origin:backup.git" symbolic-ref HEAD refs/heads/main
git -C "$temporary_directory/source" remote add origin ../remotes/origin:backup.git
git -C "$temporary_directory/source" push --quiet -u origin main
git -C "$temporary_directory/source" remote set-url --add --push origin ../remotes/origin:backup.git
git -C "$temporary_directory/source" remote set-url --add --push origin ../remote-push.git
# A harmless command proves that repository-local SSH transport data is copied.
git -C "$temporary_directory/source" config --local core.sshCommand 'ssh -F /dev/null'
mkdir -p "$temporary_directory/deploy-parent"
./scripts/create-deploy-checkout.sh "$temporary_directory/deploy-parent/deploy" "$temporary_directory/source" origin >/dev/null
deploy="$temporary_directory/deploy-parent/deploy"
[[ "$(git -C "$deploy" remote get-url origin)" == "$temporary_directory/remotes/origin:backup.git" ]]
mapfile -t deployed_push_urls < <(git -C "$deploy" remote get-url --push --all origin)
[[ "${deployed_push_urls[*]}" == "$temporary_directory/remotes/origin:backup.git $temporary_directory/remote-push.git" ]]
[[ "$(git -C "$deploy" config --local --get core.sshCommand)" == 'ssh -F /dev/null' ]]
[[ "$(git -C "$deploy" rev-parse HEAD)" == "$(git -C "$temporary_directory/source" rev-parse HEAD)" ]]

printf '[operations] clean public snapshot and one-commit history audit\n'
public_snapshot="$temporary_directory/public-snapshot"
MD_OPS_EXPORT_SKIP_VERIFY=1 ./scripts/export-public-snapshot.sh "$public_snapshot" >/dev/null
[[ "$(git -C "$public_snapshot" rev-list --count --all)" == '0' ]]
[[ -f "$public_snapshot/PUBLIC_SOURCE_MANIFEST.sha256" ]]
[[ ! -e "$public_snapshot/scripts/deploy-live.sh" ]]
git -C "$public_snapshot" config user.name 'MD Ops Release Test'
git -C "$public_snapshot" config user.email 'md-ops-release@example.invalid'
git -C "$public_snapshot" commit --quiet -m 'Initial public snapshot'
[[ "$(git -C "$public_snapshot" rev-list --count --all)" == '1' ]]
(
  cd "$public_snapshot"
  ./scripts/audit-public-tree.sh >/dev/null
  python3 scripts/audit-public-history.py >/dev/null
)

printf 'Operations regression checks passed.\n'
