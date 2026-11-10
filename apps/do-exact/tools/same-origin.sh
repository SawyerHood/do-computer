#!/usr/bin/env bash
# The app served by Do Computer's own server (DC_EXACT_APP), at its origin: the authored test
# tests/same-origin.test.contract driven there, then tools/same-origin.mjs beside the React app.
# Needs the server built (pnpm --filter @do-computer/web build:node). Takes this checkout's ports.
set -euo pipefail
cd "$(dirname "$0")/.."
slot="${DCX_SLOT:-$(cat .slot 2>/dev/null || echo 0)}"
./x web-build >/dev/null
DC_EXACT_APP="$PWD/target/web-dist" ./x test web --url "http://127.0.0.1:$((3911 + slot))/x/" tests/same-origin.test.contract
export PATH="$HOME/.bun-1.4.2/bin:$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
if [ -z "${CHROME:-}" ]; then
  CHROME="$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$CHROME" ] && export CHROME
fi
DCX_SLOT="$slot" flock "/tmp/do-exact-ports-$slot.lock" node tools/same-origin.mjs
