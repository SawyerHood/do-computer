#!/usr/bin/env bash
# Every screen beside the React app's (tools/tour.mjs): builds the web app, then takes this
# checkout's slot while the server it starts serves both.
#   tools/tour.sh [screen…]
set -euo pipefail
cd "$(dirname "$0")/.."
slot="${DCX_SLOT:-$(cat .slot 2>/dev/null || echo 0)}"
./x web-build >/dev/null
export PATH="$HOME/.bun-1.4.2/bin:$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
if [ -z "${CHROME:-}" ]; then
  CHROME="$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$CHROME" ] && export CHROME
fi
DCX_SLOT="$slot" flock "/tmp/do-exact-ports-$slot.lock" node tools/tour.mjs "$@"
