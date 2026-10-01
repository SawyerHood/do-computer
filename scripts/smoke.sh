#!/usr/bin/env bash
# End-to-end check of a running deployment: sign up, create an agent, chat, read the stream.
# Usage: scripts/smoke.sh http://127.0.0.1:3000   (the deployment must be fresh, or use a new email)
set -euo pipefail
BASE=${1:?base url}
EMAIL=${2:-owner-$RANDOM@example.com}
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
post() { curl -sS -m 20 -b "$JAR" -c "$JAR" -H "Origin: $BASE" -H "content-type: application/json" -X POST "$BASE$1" -d "${2:-{\}}"; }
get() { curl -sS -m 20 -b "$JAR" "$BASE$1"; }
field() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$3', got '$2'"; exit 1; fi; }

check "health" "$(get /api/health | field "['ok']")" "True"
check "unauthenticated is refused" "$(get /api/agents | field "['code']")" "unauthenticated"
post /api/auth/sign-up/email "{\"name\":\"Smoke\",\"email\":\"$EMAIL\",\"password\":\"correct horse battery\"}" >/dev/null
check "signed in" "$(get /api/me | field "['user']['email']")" "$EMAIL"
AGENT=$(post /api/agents | field "['agent']['id']")
check "agent listed" "$(get /api/agents | field "['agents'][0]['id']")" "$AGENT"
CHAT=$(post "/api/agents/$AGENT/chats" | field "['id']")
post "/api/agents/$AGENT/chats/$CHAT/messages" '{"text":"smoke test ping","requestId":"smoke-1"}' >/dev/null
STREAM=$(curl -sS -m 6 -N -b "$JAR" "$BASE/api/agents/$AGENT/chats/$CHAT/events" || true)
case "$STREAM" in *'"type":"snapshot"'*) echo "ok   stream opened with a snapshot";; *) echo "FAIL no snapshot in stream"; exit 1;; esac
for _ in $(seq 1 20); do
  BUSY=$(get "/api/agents/$AGENT/chats/$CHAT" | field "['busy']")
  [ "$BUSY" = "False" ] && break
  sleep 0.5
done
check "run finished" "$BUSY" "False"
check "answered" "$(get "/api/agents/$AGENT/chats/$CHAT" | field "['messages'][-1]['role']")" "assistant"
check "titled from first message" "$(get "/api/agents/$AGENT" | field "['chats'][0]['title']")" "smoke test ping"
check "init is not exposed" "$(post "/api/agents/$AGENT/init" '{"ownerId":"x"}' | field "['error']")" "Not found"
echo "all checks passed against $BASE"
