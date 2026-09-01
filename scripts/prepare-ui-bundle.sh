#!/usr/bin/env bash
# Build the UI bundle and place it where the API serves it (packages/api/ui).
# The API's /readyz success case and its tests require this bundle.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "[prepare-ui-bundle] building packages/ui ..."
npm --prefix packages/ui run build

echo "[prepare-ui-bundle] copying dist -> packages/api/ui ..."
rm -rf packages/api/ui
mkdir -p packages/api/ui
cp -r packages/ui/dist/* packages/api/ui/

echo "[prepare-ui-bundle] done. ui/index.html + assets staged for the API."
