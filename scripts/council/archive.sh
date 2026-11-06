#!/usr/bin/env bash
# Preserve all records, and convenient final/refs/table.md entry points.
set -euo pipefail
cd "$(dirname "$0")/../.."
round=${1:?final round, e.g. r12}
out=${2:?absolute archive directory}
[[ "$out" = /* ]] || { echo 'Archive directory must be absolute' >&2; exit 1; }
python3 scripts/council/integrity.py .council/rounds
mkdir -p "$out/final" "$out/refs" "$out/checks"
cp -a .council/rounds "$out/"
cp .council/rounds/"$round"/images/do-computer-*.png "$out/final/"
for j in codex claude gemini; do
  cp .council/rounds/"$round"/"$j".{json,raw.txt} "$out/final/"
done
cp .council/refs/*.png "$out/refs/"
cp scripts/council/references.md "$out/refs/sources.md"
cp .council/table.md "$out/table.md"
python3 scripts/council/timing.py .council/rounds > "$out/timing.md"
python3 scripts/council/status.py .council/rounds/"$round" > "$out/final/status.txt"
cp .council/benchmark.json "$out/benchmark.json"
for f in .council/*check*.log .council/*tests*.log .council/contrast*.json; do
  [ ! -f "$f" ] || cp "$f" "$out/checks/"
done
printf 'Final artifacts: %s\n' "$out"
