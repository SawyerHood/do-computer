#!/usr/bin/env bash
# A whole round: build the web app, take the pictures, gather them with the reference shots, and
# ask the judges. Writes .council/rounds/<round>/ (images, <judge>.json, started.txt, shot.log).
#   scripts/council/run.sh r3 codex claude gemini
# PLAYWRIGHT_CHROMIUM_PATH names the browser; DC_COUNCIL_PORT the port the server is given.
set -uo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
round=$1
shift
dir="$repo/.council/rounds/$round"
shots="${TMPDIR:-/tmp}/do-computer-council-$round"
mkdir -p "$dir"
date -u +%FT%TZ >"$dir/started.txt"
(
  cd "$repo/apps/web" &&
    nice -n 19 pnpm build:node >"$dir/build.log" 2>&1 &&
    DC_COUNCIL_OUT="$shots" nice -n 19 pnpm exec playwright test --config e2e/council-shots.config.ts \
      >"$dir/shot.log" 2>&1
) || { echo "build or pictures failed: see $dir/build.log, $dir/shot.log"; exit 1; }
cp "$shots/chat.json" "$dir/" 2>/dev/null
"$repo/scripts/council/round.sh" "$round" "$shots" >/dev/null
date -u +%FT%TZ >"$dir/shot.txt"
[ $# -eq 0 ] || "$repo/scripts/council/judge.sh" "$dir" "$@"
