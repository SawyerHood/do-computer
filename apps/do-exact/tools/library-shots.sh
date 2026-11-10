#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .exact/shots/library-exact
rm -f .exact/library-react.done
./x agent web --storage library-shots --reset-storage --size 1280x800 \
  'tap sign-toggle' 'type sign-name Ada' 'type sign-email library-shots@example.com' 'type sign-password "correct horse"' 'tap sign-submit' 'clock data' \
  'tap new-dood' 'clock data' 'clock settle' 'clock data' 'tap pages-dood' 'tap go-library-dood' 'clock data' \
  'tap library-upload-button' 'pick library-upload fixtures/library/report.md' 'clock data' \
  'tap library-upload-button' 'pick library-upload fixtures/library/index.html' 'clock data' \
  'tap library-upload-button' 'pick library-upload fixtures/library/picture.png' 'clock data' \
  'screenshot .exact/shots/library-exact/wide-home-light.png' 'prefer color-scheme dark' 'screenshot .exact/shots/library-exact/wide-home-dark.png' \
  'tap "Open report.md"' 'clock data' 'clock settle' 'clock data' \
  'screenshot .exact/shots/library-exact/wide-document-dark.png' 'prefer color-scheme light' 'screenshot .exact/shots/library-exact/wide-document-light.png' \
  'tap library-share' 'tap library-share-create' 'clock data' 'screenshot .exact/shots/library-exact/wide-sharing-light.png' 'tap library-share-close' \
  'resize 390x844' 'screenshot .exact/shots/library-exact/phone-document-light.png' 'prefer color-scheme dark' 'screenshot .exact/shots/library-exact/phone-document-dark.png' \
  'tap library-home' 'clock data' 'screenshot .exact/shots/library-exact/phone-home-dark.png' 'prefer color-scheme light' 'screenshot .exact/shots/library-exact/phone-home-light.png' \
  'clock +60000 real until .exact/library-react.done' check
