# Composer and other chats

Reference read: `chat/composer.tsx`, `attached-files.tsx`, `commands.tsx`, `thinks-with.tsx`,
`waveform.tsx`, `agent-threads.tsx`, `slack-threads.tsx`, `old-side-chat.tsx`,
`shell/old-side-chats.tsx`, `model-picker.tsx`, `thinking-picker.tsx`, `computer-picker.tsx`,
`lib/use-chat.ts`, `use-dictation.ts`, `pictures.ts`, `chats.ts`, drafts in `atoms.ts`, the
`/a/:agentId/c/:chatId` route and `docs/reference/models.md`.

## Inventory

- Done: compact/expanded multiline draft, Enter/Shift+Enter and IME guard, Send enablement,
  error retention, per-chat drafts, busy steering and Stop. The root's composer state lives
  in `views/composer.contract`; the chat uses one `ComposerBox`. `composer`/`send` remain.
- Done: multiple file picking, paste/drop file handlers, uploading indicator, removal,
  original-file library upload, image compression/base64 payload, max image count, model
  image-capability note, picture preview and image-only fallback on library failure.
- Partly: picture dialog has no carousel, zoom or swipe. Files over Exact's 16 MiB reader
  limit are refused visibly. Drafts are session-memory, like React's atoms, not persisted.
- Done: model search, source grouping, price/context/subscription facts, suggested marker,
  first 60 results/more count, selected model and nearest thinking, saving/error states,
  thinking notes and per-Dood PATCH. Arrow keys and Enter select; Escape returns to draft.
- Done: browser microphone recording, waveform, cancel, stop-to-draft/send controls, API
  transcription and error handling, chat-change cleanup and late-answer cancellation.
  Recording is tested with a browser fake microphone against the real server. Successful
  transcription has not been tested without a deployment's model key.
- Done: a running-command menu, output tail (32 KiB/40 lines), computer/time and Stop.
  Transcript chips/notices belong to the transcript area, not this composer.
- Done: lists of archived side chats, peer-Dood conversations, Slack and sub-agents; routes,
  main/parent links, read-only feet, status and Stop, external Slack link. There are no
  new/rename/delete UI controls in the current reference to port.
- Not in this React composer: slash menu, mention menu, computer-kind picker. Text beginning
  with `/` or `@` is normal text. `/tool` is only the test echo model's directive syntax.
- Not done: team typing broadcast, the special initial cursor that does not expand the box,
  live voice-call button, gallery gestures. These are explicit in GAPS.md.

## Merge notes

`views/chat.contract` only imports/uses ComposerBox and loses its old composer state/actions;
no transcript nodes changed. `data/chat.ts` loses only the old four-argument sendMessage
source. `followChat` and `data/api.ts` are unchanged. The root adds composer/threads/job
members and their provides, and `app.ts` spreads three source tables plus file grants.
`app.json` and the native-view dispatcher add do-dictation; `app.tamber` and the icon generator
add brain, stop and x. No shared shape/style is reshaped and no server code changes.

Use slot 2 here. `./x test web composer.test.contract threads.test.contract` runs the real
server suite. `tools/composer-shots.sh` captures Exact and holds its server; run
`node tools/composer-react-shots.mjs http://127.0.0.1:3913` and
`node tools/composer-native-check.mjs http://127.0.0.1:8768` while held, then touch
`.exact/composer-shots.done`. `CHROME` may need the installed Chromium path. The standalone
browser checks start no server. Paste/drop fixture drives use `--storage` and the CLI forms
`type composer paste --file tests/composer/composer-note.txt`,
`tap composer-drop drop tests/composer/composer-note.txt`; this checkout's authored-test
parser does not yet accept those two CLI forms.

## Verification and comparison

`./x test web` passes all 15 real-server tests (eight belong to this area). They cover
Enter/Shift+Enter/disabled Send; actual file pick/remove/send; picture compression, dialog
and removal; failed-send retry; failed-upload draft retention; steering/Stop; a lightweight
computer's honest background-command refusal; and a helper route's read-only controls/main
link/draft retention. `tools/composer-files.sh` also passes real file paste, file drop and
image paste (including the generated pasted-image name) and a phone layout check. These
native clipboard forms are not accepted by this Exact revision's authored-test parser.

While `tools/composer-shots.sh` holds its real server, `tools/composer-model-check.mjs`
passes model search, arrow/Enter selection, click selection and thinking selection, then
reads the saved agent back. It installs an obviously fake provider key only in its ephemeral
account and never sends a provider request. `tools/composer-native-check.mjs` passes browser
recording with a fake microphone, visible waveform, cancel, preserved draft, stop, actual
transcription refusal and return to idle. Neither script fakes a server response.
Successful transcription still needs a configured model key. The default test computer is a
lightweight shell and refuses background commands; displaying/stopping a *running* job
needs a connected real computer. Agent/Slack/archived-chat rows are implemented from their
protocol fields; only a sub-agent conversation is created in this real-server suite.

`./x verify` passes all 15 tests, ordinary phone/desktop light/dark checks, fixed-type checks
and all 15 reload checks. Its one counted finding is at the largest text size (53 px body):
the transcript's centred notice `Flights: You said: Find…` overflows by 42 px on each side.
It is `MessageRow`'s `notice` branch in `views/chat.contract`, not the composer or thread
foot. It needs a constrained/wrapping notice; it was left for the transcript owner rather
than changing that area's nodes. Verify also notes two pre-existing shell reload state
transitions (not counted as findings). Lean semantics are not run because `lake` is absent.

Screenshots looked at are under `.exact/shots/composer/` (gitignored):

- `exact/{wide,phone}-{rest,draft,picture}-{light,dark}.png`
- `react/{wide,phone}-{rest,draft,picture}-{light,dark}.png`
- `compare-wide.jpg`, `compare-phone.jpg` (side-by-side composer crops)
- `native/recording.png`, `native/transcribe-refused.png`
- `model/picker.png`, `model/selected.png`, `paste-image.png`

The comparison caught content-box textarea inflation and the picture filename row; both
were corrected. Compact and expanded boxes, phone wrapping, thumbnail spacing and control
placement now match closely. The existing shell/first-run differences are outside this
area, and Send still uses the shared default primary token rather than the individual Dood's
colour (the existing Type and colour gap explains why). The model popup puts model and
thinking in one searchable menu rather than two nested popups.
