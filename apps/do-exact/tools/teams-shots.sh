#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-.exact/shots/teams/exact}"
mkdir -p "$out"
ops=("tap sign-toggle" 'type sign-name Ada' 'type sign-email teams-shots@example.com' 'type sign-password "correct horse"' 'tap sign-submit' 'clock data' 'tap new-team' 'clock settle' 'type team-name Studio' 'tap team-color-plum')
shots() {
  local screen=$1
  ops+=("resize 1280x800" 'prefer prefers-color-scheme light' 'clock settle' "screenshot $out/wide-$screen-light.png" 'prefer prefers-color-scheme dark' "screenshot $out/wide-$screen-dark.png" 'resize 390x844' 'clock settle' "screenshot $out/phone-$screen-dark.png" 'prefer prefers-color-scheme light' "screenshot $out/phone-$screen-light.png" 'resize 1280x800' 'clock settle')
}
shots create
ops+=('tap team-create-submit' 'clock data' 'tap team-created-go' 'clock settle' 'clock data')
shots workspace
ops+=('tap workspace-home-people' 'clock settle' 'clock data')
shots people
ops+=('tap team-invite-open-people' 'clock settle')
shots invite
ops+=('type team-invite-who grace@example.com' 'type team-invite-note "Come make things"' 'tap team-invite-submit' 'clock data' 'tap "View invitation"' 'clock settle' 'clock data' 'tap team-invite-switch-account' 'clock data')
shots preview
exec ./x agent web --size 1280x800 "${ops[@]}" 'check both'
