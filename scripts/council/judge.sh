#!/usr/bin/env bash
# One round of the design council: each judge named scores the screenshots in <round>/images
# (Do Computer's, do-computer-*, beside the reference apps', grok-* and muse-*), read-only, and
# writes <round>/<judge>.json. Judges: codex (GPT), claude (Opus), gemini (Gemini).
# COUNCIL_CODEX_HOST runs Codex over ssh where it is signed in; COUNCIL_CLAUDE_VIA=cursor asks
# Opus through cursor-agent where `claude` is not. Gemini is always asked through cursor-agent.
#   scripts/council/judge.sh .council/rounds/r3 codex claude gemini
set -uo pipefail
round=$(cd "$1" && pwd)
shift
here=$(cd "$(dirname "$0")" && pwd)
images="$round/images"
prompt="$(cat "$here/prompt.md")

The screenshots are in: $images"
mapfile -t files < <(ls "$images"/*.png "$images"/*.jpg 2>/dev/null | sort)

extract() {
  # The last JSON object in what a judge said.
  python3 - "$1" "$2" <<'EOF'
import json, re, sys
text = open(sys.argv[1], errors="replace").read()
starts = [m.start() for m in re.finditer(r"\{\s*\"scores\"", text)]
decoder = json.JSONDecoder()
for start in reversed(starts):
    try:
        value, _ = decoder.raw_decode(text, start)
    except json.JSONDecodeError:
        continue
    # The prompt's own template (all zeros) is not an answer.
    if not value.get("scores", {}).get("do_computer", {}).get("hierarchy"):
        continue
    json.dump(value, open(sys.argv[2], "w"), indent=2)
    sys.exit(0)
sys.exit(1)
EOF
}

run() {
  local judge=$1 raw="$round/$1.raw.txt"
  case $judge in
    codex)
      # Run where Codex is signed in: $COUNCIL_CODEX_HOST over ssh (default here).
      local host=${COUNCIL_CODEX_HOST:-} remote="/tmp/council-judge-${COUNCIL_NAME:-dc}/$(basename "$round")"
      local codex_bin=${COUNCIL_CODEX_BIN:-codex}
      local args=()
      for f in "${files[@]}"; do args+=(-i "$remote/images/$(basename "$f")"); done
      if [ -n "$host" ]; then
        ssh "$host" "rm -rf '$remote' && mkdir -p '$remote'" && scp -q -r "$images" "$host:$remote/"
        printf '%s' "$prompt" | sed "s#$images#$remote/images#" | ssh "$host" "cat > '$remote/prompt.md'"
        ssh "$host" "cd '$remote/images' && nice -n 19 $codex_bin exec -s read-only --skip-git-repo-check --ephemeral -o '$remote/last.txt' \"\$(cat '$remote/prompt.md')\" $(printf "%q " "${args[@]}") </dev/null; cat '$remote/last.txt'" >"$raw" 2>&1
      else
        local local_args=()
        for f in "${files[@]}"; do local_args+=(-i "$f"); done
        (cd "$images" && nice -n 19 codex exec -s read-only --skip-git-repo-check --ephemeral \
          -o "$round/codex.last.txt" "$prompt" "${local_args[@]}" </dev/null >"$raw" 2>&1)
        cat "$round/codex.last.txt" >>"$raw" 2>/dev/null
      fi
      ;;
    claude)
      if [ "${COUNCIL_CLAUDE_VIA:-}" = cursor ]; then
        # Opus through Cursor's agent, read-only ("ask" mode), where `claude` is not signed in.
        (cd "$images" && nice -n 19 ~/.local/bin/cursor-agent -p --mode ask --trust \
          --model "${COUNCIL_CLAUDE_MODEL:-claude-opus-5-5-high}" --output-format text \
          "$prompt

Read every image in that folder with your file reading tool before you score." </dev/null >"$raw" 2>&1)
      else
      printf '%s\n\nRead every image in that folder with the Read tool before you score.\n' "$prompt" |
        (cd "$images" && nice -n 19 claude -p --model opus --allowedTools "Read,Glob" \
          --disallowedTools "Bash,Edit,Write,WebFetch,WebSearch" >"$raw" 2>&1)
      fi
      ;;
    gemini)
      # Gemini through Cursor's agent, read-only ("ask" mode).
      (cd "$images" && nice -n 19 ~/.local/bin/cursor-agent -p --mode ask --trust \
        --model "${COUNCIL_GEMINI_MODEL:-gemini-4-argon-high}" --output-format text \
        "$prompt

Read every image in that folder with your file reading tool before you score." </dev/null >"$raw" 2>&1)
      ;;
  esac
  if extract "$raw" "$round/$judge.json"; then echo "$judge: ok"; else echo "$judge: no JSON (see $raw)"; fi
}

date -u +%FT%TZ >"$round/judged-start.txt"
for judge in "$@"; do run "$judge" & done
wait
date -u +%FT%TZ >"$round/judged-end.txt"
