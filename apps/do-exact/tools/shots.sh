#!/usr/bin/env bash
# Pictures of this app to hold against the React app's (tools/react-shots.mjs): the same account,
# a Dood with one exchange in its chat, at 1280x800 and 390x844, light and dark.
#   tools/shots.sh [out dir]     (default .exact/shots/exact)
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-.exact/shots/exact}"
mkdir -p "$out"
steps=()
add() { steps+=("$@"); }
# A screenshot in each scheme.
both() { add "screenshot $out/$1-light.png" "prefer prefers-color-scheme dark" "clock +300 real" "screenshot $out/$1-dark.png" "prefer prefers-color-scheme light" "clock +300 real"; }
for size in wide:1280x800 phone:390x844; do
  name="${size%%:*}"; px="${size#*:}"
  steps=()
  add "clock data"; both "$name-login"
  add "tap sign-toggle" "type sign-name Ada" "type sign-email ada@example.com" "type sign-password 'correct horse'" "tap sign-submit" "clock data"
  add "tap new-dood" "clock data" "clock settle" "clock data" "type composer 'Plan a weekend in Lisbon for two, under €900.'" "tap send" "clock data" "clock +3000 real"
  both "$name-chat"
  if [ "$name" = wide ]; then
    add "tap panel-toggle-1" "clock settle"; both "$name-panel"; add "tap panel-toggle-1" "clock settle"
    add "tap pages-1" "clock settle"; both "$name-pages-menu"
    add "tap go-library-1" "clock data" "clock settle"; both "$name-library"
  else
    add "back" "clock settle" "clock data"; both "$name-doods"
  fi
  ./x agent web --size "$px" "${steps[@]}" 2>&1 | grep -E "^screenshot|error|fail|refused|not found" || true
done
