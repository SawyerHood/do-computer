#!/usr/bin/env bash
# Pictures of the settings to hold against the React app's (tools/settings-react-shots.mjs):
# each section, at 1280x800 and 390x844, light and dark, into .exact/shots/settings-exact/.
#   tools/settings-shots.sh [out dir]
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-.exact/shots/settings-exact}"
mkdir -p "$out"
steps=()
add() { steps+=("$@"); }
both() { add "screenshot $out/$1-light.png" "prefer prefers-color-scheme dark" "clock +300 real" "screenshot $out/$1-dark.png" "prefer prefers-color-scheme light" "clock +300 real"; }
go() { add "tap $1" "clock data" "clock settle" "clock data"; }
for size in wide:1280x800 phone:390x844; do
  name="${size%%:*}"; px="${size#*:}"
  steps=()
  add "clock data"
  add "tap sign-toggle" "type sign-name Ada" "type sign-email ada@example.com" "type sign-password 'correct horse'" "tap sign-submit" "clock data"
  add "tap new-dood" "clock data" "clock settle" "clock data"
  add "tap pages-dood" "clock settle"; go go-settings-dood; both "$name-agent-list"
  if [ "$name" = wide ]; then
    go settings-go-profile-settings; both "$name-profile"
    go settings-go-memory-profile; both "$name-memory"
    go settings-go-model-memory; both "$name-model"
    go settings-go-permissions-model; both "$name-permissions"
    go settings-go-usage-permissions; both "$name-usage"
    go settings-go-model-usage; go model-workspace-models; both "$name-models"
    go settings-go-passwords-workspaceModels; both "$name-passwords"
    add "tap account"; go account-settings; both "$name-general"
    go settings-go-notifications-account; add "clock +500 real"; both "$name-notifications"
    go settings-go-doodsList-notifications; both "$name-doods"
    go settings-go-workspacesList-doodsList; both "$name-workspaces"
  else
    go settings-go-profile-settings; both "$name-profile"
    go settings-home-profile; go settings-go-memory-settings; both "$name-memory"
    go settings-home-memory; go settings-go-model-settings; both "$name-model"
    go settings-home-model; go settings-go-permissions-settings; both "$name-permissions"
    go settings-home-permissions; go settings-go-usage-settings; both "$name-usage"
    go settings-home-usage; go settings-go-model-settings; go model-workspace-models; both "$name-models"
    go settings-home-workspaceModels
  fi
  ./x agent web --size "$px" "${steps[@]}" 2>&1 | grep -E "^op|error|refused|not found" || true
done
echo "settings-shots: $out"
