#!/usr/bin/env bash
# Roll demo.movehome.org back to a pinned build. Alias flip only — nothing is rebuilt,
# so recovery is one command and takes one alias write (~43 s measured).
#
#   scripts/demo/rollback-demo.sh              # re-point the alias at the committed pin
#   scripts/demo/rollback-demo.sh dpl_abcd1234 # flip to a specific previous build
#
# Vercel CLI 56 rejects the old --yes flag on `alias set`; --non-interactive replaces it.
# Requires an authenticated Vercel CLI on the move-home team.
set -euo pipefail

ALIAS=demo.movehome.org
SCOPE=move-home
PIN=$(dirname "$0")/../../docs/ops/expo-demo-pin.json
target=${1:-}

if [ -z "$target" ]; then
  target=$(jq -r '.deployment_id // empty' "$PIN")
  [ -n "$target" ] || { echo "no deployment_id in $PIN" >&2; exit 1; }
fi

echo "flipping $ALIAS -> $target"
vercel alias set "$target" "$ALIAS" --scope "$SCOPE" --non-interactive
curl -fsS --max-time 10 "https://$ALIAS/api/health"
