#!/usr/bin/env bash
# Puts pictures side by side in one, to look at them together: tools/side.sh out.png a.png b.png …
set -euo pipefail
out="$1"; shift
inputs=(); for f in "$@"; do inputs+=(-i "$f"); done
ffmpeg -loglevel error -y "${inputs[@]}" -filter_complex "$(for i in $(seq 0 $(($# - 1))); do printf '[%d]pad=iw+12:ih:0:0:gray[p%d];' "$i" "$i"; done)$(for i in $(seq 0 $(($# - 1))); do printf '[p%d]' "$i"; done)hstack=inputs=$#" "$out"
