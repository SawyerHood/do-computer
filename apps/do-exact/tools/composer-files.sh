#!/usr/bin/env bash
# These native clipboard/drop forms are in the driver, not yet the authored-test parser.
set -euo pipefail
cd "$(dirname "$0")/.."
./x agent web --storage "composer-files-$(date +%s)" --size 390x844 \
  'tap sign-toggle' 'type sign-name Ada' 'type sign-email composer-files@example.com' 'type sign-password "correct horse"' 'tap sign-submit' 'clock data' \
  'tap new-dood' 'clock data' 'clock settle' 'clock data' \
  'type composer paste --file tests/composer/composer-note.txt' 'clock data' \
  'clock until state composerAttachments.length == 1 within 5000' \
  'tap "Remove composer-note.txt"' \
  'tap composer-drop drop tests/composer/composer-note.txt' 'clock data' \
  'clock until state composerAttachments.length == 1 within 5000' \
  'tap "Remove composer-note-2.txt"' \
  'type composer paste --image tests/composer/picture.png' 'clock data' \
  'clock until state composerAttachments.0.mime == "image/jpeg" within 5000' \
  'screenshot .exact/shots/composer/paste-image.png' check
