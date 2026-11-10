#!/usr/bin/env bash
# Puts pictures side by side in one, to look at them together, shrunk to at most 1900 px across:
#   tools/side.sh out.png a.png b.png …
set -euo pipefail
out="$1"; shift
inputs=(); for f in "$@"; do inputs+=(-i "$f"); done
pads=""; refs=""
for i in $(seq 0 $(($# - 1))); do pads+="[$i]pad=iw+12:ih:0:0:gray[p$i];"; refs+="[p$i]"; done
ffmpeg -loglevel error -y "${inputs[@]}" -filter_complex "${pads}${refs}hstack=inputs=$#,scale='min(1900,iw)':-1" "$out"
