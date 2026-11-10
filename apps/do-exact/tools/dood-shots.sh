#!/usr/bin/env bash
# Pictures of this app's Dood screens to hold against the React app's (tools/react-dood-shots.mjs):
# the first run, a Dood hatched from the +, its panel, a treat, its box and its wardrobe, at
# 1280x800 and 390x844, light and dark.
#   tools/dood-shots.sh [out dir]     (default .exact/shots/dood)
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-.exact/shots/dood}"
mkdir -p "$out"
n=0
for scheme in light dark; do
  for size in wide:1280x800 phone:390x844; do
    name="${size%%:*}"; px="${size#*:}"; tag="$name-$scheme"; n=$((n + 1))
    pre=("clock data" "prefer prefers-color-scheme $scheme" "tap sign-toggle" "type sign-name 'Ada Lovelace'" "type sign-email shots-$n-\$RANDOM@example.com" "type sign-password 'correct horse'" "tap sign-submit" "clock data")
    pre[4]="type sign-email shots-$n-$RANDOM@example.com"
    ./x agent web --size "$px" "${pre[@]}" \
      "clock +12000" "clock settle" "clock +3000" "screenshot $out/$tag-welcome-hello.png" \
      "tap welcome-hello" "clock +4000" "screenshot $out/$tag-welcome-name.png" \
      "type welcome-name Pip" "tap welcome-color-moss" "clock +600" "screenshot $out/$tag-welcome-named.png" \
      "tap welcome-named" "clock data" "clock +4000" "clock data" "screenshot $out/$tag-welcome-model.png" \
      "tap welcome-think" "clock data" "clock +12000" "screenshot $out/$tag-welcome-out.png" \
      "tap welcome-start" "clock data" "clock +400" "screenshot $out/$tag-welcome-flying.png" "clock +4000" "clock data" "screenshot $out/$tag-welcome-chat.png" \
      2>&1 | grep -E "^screenshot|error|fail|refused|no view" || true
    n=$((n + 1))
    pre[4]="type sign-email shots-$n-$RANDOM@example.com"
    if [ "$name" = wide ]; then
      more=("tap panel-toggle-dood" "clock settle" "clock data" "screenshot $out/$tag-egg.png" "clock +12000" "clock data" "clock settle" "screenshot $out/$tag-hatched.png"
        "tap give-treat" "clock +450" "screenshot $out/$tag-eating.png" "clock +1500" "clock data"
        "tap open-box" "clock settle" "clock +1000" "screenshot $out/$tag-box.png" "tap box-press" "clock data" "clock +9000" "clock settle" "screenshot $out/$tag-box-shown.png"
        "tap box-wear" "clock data" "clock settle" "clock +1500" "screenshot $out/$tag-worn.png" "tap panel-wardrobe" "clock settle" "clock data" "clock +1500" "screenshot $out/$tag-wardrobe.png")
    else
      more=("screenshot $out/$tag-egg.png" "clock +12000" "clock data" "clock settle" "screenshot $out/$tag-hatched.png" "tap pill-wardrobe-dood" "clock settle" "clock data" "clock +1500" "screenshot $out/$tag-wardrobe.png")
    fi
    # A second account, whose Dood comes from the + (the scene is not waited for).
    ./x agent web --size "$px" "${pre[@]}" "tap new-dood" "clock data" "clock settle" "clock data" "${more[@]}" \
      2>&1 | grep -E "^screenshot|error|fail|refused|no view" || true
  done
done
