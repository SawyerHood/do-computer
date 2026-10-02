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
# The echo model calls a tool when asked to, which lets this check the computer and schedules.
tool() { post "/api/agents/$AGENT/chats/$CHAT/messages" "{\"text\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"),\"requestId\":\"smoke-$RANDOM$RANDOM\"}" >/dev/null; }
wait_for() { # wait_for <python expression over the chat state d> <description>
  for _ in $(seq 1 40); do
    if get "/api/agents/$AGENT/chats/$CHAT" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($1) else 1)"; then echo "ok   $2"; return; fi
    sleep 0.5
  done
  echo "FAIL $2"; exit 1
}
TEXTS='" ".join(p.get("text","")+str(p.get("output","")) for m in d["messages"] for p in m["parts"])'
tool '/tool bash {"command":"echo durable > proof.txt && cat proof.txt && ls"}'
wait_for "not d['busy'] and 'durable' in $TEXTS and 'MEMORY.md' in $TEXTS" "agent ran a command on its computer"
SOON=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=3)).isoformat())')
tool "/tool schedule {\"action\":\"create\",\"schedule\":\"$SOON\",\"prompt\":\"Report in\",\"title\":\"Smoke schedule\"}"
wait_for "any(p.get('kind')=='schedule' for m in d['messages'] for p in m['parts'])" "scheduled task ran by itself and reported back"
check "schedule recorded its run" "$(get "/api/agents/$AGENT/schedules" | field "['schedules'][0]['lastRun']['outcome']")" "delivered"
# Pair this machine as one of the user's computers, with the real daemon, if it has been built.
DAEMON="$(dirname "$0")/../apps/daemon/dist/daemon.cjs"
if [ -f "$DAEMON" ]; then
  LAPTOP=$(mktemp -d)
  echo "on the paired machine" > "$LAPTOP/proof.txt"
  HOME="$LAPTOP" DC_DAEMON_DIR="$LAPTOP/.dc" DC_DAEMON_POLL_MS=300 node "$DAEMON" "$BASE" --name smoke-laptop > "$LAPTOP/daemon.log" 2>&1 &
  DAEMON_PID=$!
  trap 'rm -f "$JAR"; kill $DAEMON_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 20); do grep -q "confirm the code" "$LAPTOP/daemon.log" && break; sleep 0.3; done
  CODE=$(grep -o 'code [A-Z0-9]\{4\}-[A-Z0-9]\{4\}' "$LAPTOP/daemon.log" | head -1 | cut -d' ' -f2)
  check "daemon is paired from its code" "$(post /api/computers/pair/confirm "{\"code\":\"$CODE\",\"agentId\":\"$AGENT\"}" | field "['name']")" "smoke-laptop"
  for _ in $(seq 1 30); do
    ONLINE=$(get /api/computers | field "['computers'][0]['online']")
    [ "$ONLINE" = "True" ] && break
    sleep 0.5
  done
  check "paired computer is online" "$ONLINE" "True"
  tool '/tool bash {"command":"cat proof.txt","computer":"smoke-laptop"}'
  wait_for "not d['busy'] and 'on the paired machine' in $TEXTS" "agent ran a command on the paired computer"
  COMPUTER=$(get /api/computers | field "['computers'][0]['id']")
  curl -sS -m 20 -b "$JAR" -H "Origin: $BASE" -X DELETE "$BASE/api/computers/$COMPUTER" >/dev/null
  for _ in $(seq 1 30); do kill -0 $DAEMON_PID 2>/dev/null || break; sleep 0.3; done
  if kill -0 $DAEMON_PID 2>/dev/null; then echo "FAIL removed computer's daemon is still running"; exit 1; else echo "ok   removing the computer stopped its daemon"; fi
else
  echo "skip paired computer checks: build the daemon with pnpm --filter @durable-computer/daemon build"
fi
# History: what was said can be found, and a chat's past can be read back.
check "search finds what was said" "$(get "/api/agents/$AGENT/search?q=smoke%20test%20ping" | field "['hits'][0]['chatId']")" "$CHAT"
check "a chat's earlier messages can be read" "$(get "/api/agents/$AGENT/chats/$CHAT/history" | field "['messages'][0]['parts'][0]['text']")" "smoke test ping"
check "usage is counted" "$(get "/api/agents/$AGENT/usage" | field "['chats'] >= 1")" "True"
# Approvals: a tool set to ask first does not run until the user says so.
patch() { curl -sS -m 20 -b "$JAR" -H "Origin: $BASE" -H "content-type: application/json" -X PATCH "$BASE$1" -d "$2"; }
check "a rule is set" "$(patch "/api/agents/$AGENT/approvals/rules" '{"tool:bash":"ask"}' | field "['rules']['tool:bash']")" "ask"
tool '/tool bash {"command":"echo needs-an-ok"}'
for _ in $(seq 1 40); do
  PENDING=$(get "/api/agents/$AGENT/approvals" | field "['pending'][0]['detail'] if d['pending'] else ''" 2>/dev/null || true)
  [ "$PENDING" = "echo needs-an-ok" ] && break
  sleep 0.5
done
check "the agent asked before running the command" "$PENDING" "echo needs-an-ok"
REQUEST=$(get "/api/agents/$AGENT/approvals" | field "['pending'][0]['id']")
post "/api/agents/$AGENT/approvals/$REQUEST" '{"decision":"always"}' >/dev/null
check "always allowing lifts the rule" "$(get "/api/agents/$AGENT/approvals" | field "['rules']")" "{}"
wait_for "not d['busy'] and 'Approved: Run commands: echo needs-an-ok' in $TEXTS" "the answer reached the chat"
tool '/tool bash {"command":"echo needs-an-ok"}'
wait_for "not d['busy'] and any(p.get('output')=='needs-an-ok\\n' for m in d['messages'] for p in m['parts'])" "the command ran once it was allowed"
# Deleting an agent removes it and leaves the others alone.
SECOND=$(post /api/agents | field "['agent']['id']")
curl -sS -m 30 -b "$JAR" -H "Origin: $BASE" -X DELETE "$BASE/api/agents/$SECOND" >/dev/null
check "a deleted agent is gone" "$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/agents/$SECOND")" "404"
check "the first agent is untouched" "$(get /api/agents | field "['agents'][0]['id']")" "$AGENT"
check "init is not exposed" "$(post "/api/agents/$AGENT/init" '{"ownerId":"x"}' | field "['error']")" "Not found"
check "destroy is not exposed" "$(post "/api/agents/$AGENT/destroy" | field "['error']")" "Not found"
echo "all checks passed against $BASE"
