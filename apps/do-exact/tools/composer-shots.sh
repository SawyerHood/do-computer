#!/usr/bin/env bash
# Own slot, real server. While the final drive waits, run composer-react-shots.mjs and
# composer-native-check.mjs against the printed server/page ports, then touch the done file.
set -euo pipefail
cd "$(dirname "$0")/.."
out=.exact/shots/composer/exact
mkdir -p "$out"
rm -f .exact/composer-shots.done
steps=("tap sign-toggle" "type sign-name Ada" "type sign-email composer-shots@example.com" "type sign-password 'correct horse'" "tap sign-submit" "clock data" "tap new-dood" "clock data" "clock settle" "clock data")
for size in wide phone; do
  if [ "$size" = phone ]; then steps+=("resize 390x844"); fi
  steps+=("type composer ''" "tap pages-dood" "tap pages-dood" "clock settle")
  for scheme in light dark; do
    steps+=("prefer prefers-color-scheme $scheme" "clock data" "screenshot $out/$size-rest-$scheme.png")
  done
  steps+=("type composer 'Please read the attached note and help me plan the next step.'")
  for scheme in light dark; do
    steps+=("prefer prefers-color-scheme $scheme" "clock data" "screenshot $out/$size-draft-$scheme.png")
  done
  steps+=("tap attach" "pick file-picker tests/composer/picture.png" "clock data")
  for scheme in light dark; do
    steps+=("prefer prefers-color-scheme $scheme" "clock data" "screenshot $out/$size-picture-$scheme.png")
  done
  if [ "$size" = wide ]; then steps+=('tap "Remove picture.png"'); fi
done
if [ "${COMPOSER_HOLD:-1}" = 1 ]; then steps+=("clock +300000 real until .exact/composer-shots.done"); fi
./x agent web --storage "composer-shots-$(date +%s)" --size 1280x800 "${steps[@]}"
