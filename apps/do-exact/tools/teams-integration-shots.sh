#!/usr/bin/env bash
# The merged sidebar, settings frame and a second account accepting a team invitation.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-.exact/shots/teams/integrated}"
mkdir -p "$out"
ops=('tap sign-toggle' 'type sign-name Ada' 'type sign-email teams-merged-owner@example.com' 'type sign-password "correct horse"' 'tap sign-submit' 'clock data' 'tap new-dood' 'clock data' 'clock settle' 'tap hello-face' 'clock data' 'tap pages-dood' 'tap go-profile-dood' 'clock data' 'clock settle' 'type profile-name Pico' 'tap dood-save' 'clock data' 'tap new-team' 'clock settle' 'type team-name Studio' 'tap team-create-submit' 'clock data' 'tap "Close new team"' 'clock settle' 'tap "New Dood in Studio"' 'clock data' 'clock settle' 'tap hello-face' 'clock data' 'reload' 'clock data' 'clock settle')
shots() {
  local screen=$1
  ops+=('resize 1280x800' 'prefer prefers-color-scheme light' 'clock settle' "screenshot $out/wide-$screen-light.png" 'prefer prefers-color-scheme dark' "screenshot $out/wide-$screen-dark.png" 'resize 390x844')
  if [[ "$screen" == sidebar ]]; then ops+=('back'); fi
  ops+=('clock settle' "screenshot $out/phone-$screen-dark.png" 'prefer prefers-color-scheme light' "screenshot $out/phone-$screen-light.png" 'prefer root-font-size 53' 'clock settle' 'check both' "screenshot $out/phone-$screen-largest.png" 'prefer root-font-size 16' 'resize 1280x800' 'clock settle')
}
shots sidebar
ops+=('tap "Studio: workspace menu"' 'tap People' 'clock data' 'clock settle')
shots people
ops+=('tap team-invite-open-people' 'clock settle' 'type team-invite-who teams-merged-member@example.com' 'type team-invite-note "Come make things"' 'tap team-invite-submit' 'clock data' 'tap "View invitation"' 'clock data' 'clock settle' 'tap team-invite-switch-account' 'clock data' 'tap team-invite-sign-up' 'type sign-name Grace' 'type sign-email teams-merged-member@example.com' 'type sign-password "correct horse"' 'tap sign-submit' 'clock data' 'clock settle')
shots invitation
ops+=('tap team-accept' 'clock data' 'clock settle' 'reload' 'clock data' 'clock settle' 'tap "Studio: workspace menu"' 'tap People' 'clock data' 'clock settle')
shots accepted
ops+=('tap close-people' 'clock data' 'clock settle' 'resize 390x844' 'tap pill-wardrobe-dood' 'clock data' 'clock settle' 'prefer root-font-size 53' 'clock settle' 'check both' "screenshot $out/phone-wardrobe-largest.png")
exec ./x agent web --size 1280x800 "${ops[@]}"
