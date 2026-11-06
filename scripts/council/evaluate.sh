#!/usr/bin/env bash
# Start a round's clock before edits; this script records capture, judging, and end time.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=~/.local/share/pnpm/bin:~/.nvm/versions/node/v24.18.0/bin:$PATH
r=${1:?round name}
dir="$PWD/.council/rounds/$r"
mkdir -p "$dir"
[ -f "$dir/start.txt" ] || date -u +%FT%TZ > "$dir/start.txt"
nice -n 19 pnpm --filter @do-computer/web build:node > "$dir/build.log" 2>&1
scripts/council/serve.sh > "$dir/server.log" 2>&1 & server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for i in {1..200}; do curl -sf http://127.0.0.1:47210/api/health >/dev/null && break; sleep .05; done
scripts/council/capture.sh > "$dir/capture.log" 2>&1
scripts/council/round.sh "$r" .council/shots > "$dir/images.log"
# The data server is no longer needed during judging.
kill "$server"; wait "$server" 2>/dev/null || true
COUNCIL_CODEX_HOST=omarchy COUNCIL_CLAUDE_VIA=cursor scripts/council/judge.sh "$dir" codex claude gemini
date -u +%FT%TZ > "$dir/end.txt"
scripts/council/table.py .council/rounds > .council/table.md
python3 scripts/council/status.py "$dir"
