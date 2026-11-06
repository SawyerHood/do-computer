#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=~/.local/share/pnpm/bin:~/.nvm/versions/node/v24.18.0/bin:$PATH
export PLAYWRIGHT_CHROMIUM_PATH=${PLAYWRIGHT_CHROMIUM_PATH:-$(find ~/.cache/ms-playwright/chromium_headless_shell-1248 -name chrome-headless-shell -type f | head -1)}
nice -n 19 node scripts/council/desktop-build.mjs
cd apps/web
nice -n 19 pnpm exec playwright test --config e2e/council-shots.config.ts
