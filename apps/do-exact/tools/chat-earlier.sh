#!/usr/bin/env bash
# What a test cannot do: start a chat fresh (the Dood's settings do it, with the session), then
# look at its earlier messages and the way back to the newest. It starts the server itself at
# this checkout's port, makes the chat over the API, and drives the app against it.
#   tools/chat-earlier.sh      → .exact/shots/exact/earlier-*.png
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun-1.4.2/bin:$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
slot="$(cat .slot 2>/dev/null || echo 0)"
B="http://127.0.0.1:$((3911 + slot))"
mkdir -p .exact/shots/exact
API_BASE_URL="$B" DC_CLIENT_ORIGINS="http://127.0.0.1:$((8766 + slot))" bun server.ts > .exact/chat-earlier-server.log 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "$B/api/health" >/dev/null && break; sleep 0.5; done
json() { python3 -c "import json,sys;print(json.load(sys.stdin)$1)"; }
tok=$(curl -s -D - -o /dev/null -H 'content-type: application/json' -H "origin: http://127.0.0.1:$((8766 + slot))" \
  -d '{"name":"Ada","email":"ada@example.com","password":"correct horse"}' "$B/api/auth/sign-up/email" | awk 'tolower($1)=="set-auth-token:"{print $2}' | tr -d '\r')
H="authorization: Bearer $tok"
agent=$(curl -s -H "$H" -H 'content-type: application/json' -d '{}' "$B/api/agents" | json '["agent"]["id"]')
chat=$(curl -s -H "$H" -H 'content-type: application/json' -d '{}' "$B/api/agents/$agent/chats/main" | json '["id"]')
say() {
  curl -s -H "$H" -H 'content-type: application/json' -d "{\"text\":\"$1\",\"requestId\":\"r-$1\"}" "$B/api/agents/$agent/chats/$chat/messages" >/dev/null
  for _ in $(seq 1 40); do sleep 0.4; [ "$(curl -s -H "$H" "$B/api/agents/$agent/chats/$chat" | json '["busy"]')" = False ] && break; done
}
say "The first thing I said"
curl -s -H "$H" -X POST "$B/api/agents/$agent/chats/$chat/reset" >/dev/null
for n in 1 2 3 4 5 6 7 8; do say "Message number $n"; done
./x agent web --size 1280x800 "clock data" "type sign-email ada@example.com" "type sign-password 'correct horse'" "tap sign-submit" "clock data" \
  "tap dood-$agent" "clock data" "clock settle" "clock data" "clock +1500 real" "screenshot .exact/shots/exact/earlier-0.png" \
  "tap transcript wheel 0 -4000" "clock +800 real" "screenshot .exact/shots/exact/earlier-1.png" "state atEnd" \
  "tap show-earlier" "clock data" "clock +1000 real" "screenshot .exact/shots/exact/earlier-2.png" "state hasEarlier" \
  "tap to-latest" "clock +1500 real" "state atEnd" "screenshot .exact/shots/exact/earlier-3.png" 2>&1 | grep -E "^screenshot|^(true|false)$|error|fail"
