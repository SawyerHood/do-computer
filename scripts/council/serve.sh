#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=~/.local/share/pnpm/bin:~/.nvm/versions/node/v24.18.0/bin:$PATH
mkdir -p .council/data
export PORT=47210 DC_BASE_URL=http://127.0.0.1:47210 DC_DATA_DIR="$PWD/.council/data" OPENROUTER_API_KEY='' DC_CHROME_PATH=none DC_ALLOWED_EMAILS=owner@example.com
cd apps/web
exec nice -n 19 node server.node.mjs
