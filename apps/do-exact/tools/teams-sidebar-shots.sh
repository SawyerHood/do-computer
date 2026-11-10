#!/usr/bin/env bash
# The sidebar's Dood confirmations, without changing the server's computers.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-.exact/shots/teams/sidebar}"
mkdir -p "$out"
ops=('tap sign-toggle' 'type sign-name Ada' 'type sign-email teams-sidebar-shots@example.com' 'type sign-password "correct horse"' 'tap sign-submit' 'clock data' 'tap new-dood' 'clock data' 'clock settle' 'tap new-team' 'clock settle' 'type team-name Studio' 'tap team-create-submit' 'clock data' 'tap "Close new team"' 'clock settle')
shots() {
  local screen=$1
  ops+=("resize 1280x800" 'prefer prefers-color-scheme light' 'clock settle' "screenshot $out/wide-$screen-light.png" 'prefer prefers-color-scheme dark' "screenshot $out/wide-$screen-dark.png" 'resize 390x844' 'clock settle' "screenshot $out/phone-$screen-dark.png" 'prefer prefers-color-scheme light' "screenshot $out/phone-$screen-light.png" 'resize 1280x800' 'clock settle')
}
ops+=("tap \"New Dood's pages and actions\"")
ops+=('tap "Rename New Dood"' 'clock settle' 'type sidebar-rename-input Pico')
shots rename
ops+=('tap sidebar-rename-save' 'clock data' 'clock settle' "tap \"Pico's pages and actions\"" 'tap "Move to a workspace"' 'clock settle')
shots move
ops+=('type sidebar-move-target key Escape' 'clock settle' "tap \"Pico's pages and actions\"" 'tap "Delete Pico"' 'clock settle')
shots delete
exec ./x agent web --size 1280x800 "${ops[@]}" 'check both'
