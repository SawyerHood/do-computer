#!/usr/bin/env bash
# Gather a round's pictures for the council: Do Computer's shots from <shots>
# (apps/web/e2e/council-shots.ts) as do-computer-*, and the reference apps' from .council/refs,
# into .council/rounds/<round>/images.
#   scripts/council/round.sh r3 /tmp/do-computer-shots/council
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
dir="$repo/.council/rounds/$1/images"
rm -rf "$dir"
mkdir -p "$dir"
for f in "$2"/*.png; do cp "$f" "$dir/do-computer-$(basename "$f")"; done
cp "$repo/.council/refs/"* "$dir/"
ls "$dir"
