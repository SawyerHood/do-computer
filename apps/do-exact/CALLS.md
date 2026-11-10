# Calls port report

Branch: `exact-calls`, based on local `exact-client`; slot 5 (API 3916, page 8771).
Reference: docs/reference/calls.md, components/call/call.tsx, lib/call.ts,
packages/client/src/call*.ts, components/chat/agent-panel.tsx, composer.tsx,
shell/agent-strip.tsx, server/calls-directory.ts and packages/agent's call routes.

## Feature checklist

“Done” describes implementation, not a claim that provider audio was tested without a key.

- **Done:** offer only where the server allows it, after hatching; one call at a time.
- **Done:** start from the empty composer, Dood panel and name menu, in the main chat.
  Drafts, pending uploads/sends and attached files keep Send rather than Call.
- **Partly verified:** microphone capture, WebRTC, oai-events data channel, remote playback
  attachment, mute and cleanup work in a real local loopback. No provider call was made.
- **Done:** starting, connecting, listening, hearing, speaking, working, mute and unmute;
  shared caller logic is reused rather than maintained as a second state machine.
- **Done:** creature reactions, real waveform levels, elapsed clock, latest words and hide/show.
- **Partly:** live transcript and handoff progress are shown, and all answers go back to the
  voice. Like React, the live card keeps the latest eight completed lines; its activity list
  is bounded to the last five handoffs instead of every pending handoff. The main chat and
  shared caller still process them all. The no-key script exercises a real handoff to the
  echo Dood, reply and goodbye.
- **Done:** persistent window-level call while navigating, back to its chat, end anywhere.
- **Done:** write-up placeholder, durable folded record, summaries and old side-chat link.
  The real scripted server test exercises records; a summary from an actual model needs a key.
- **Partly verified:** permission/device refusal, provider failure, disconnect and idle/deadline
  endings are implemented. Actual browser permission denial and an injected provider 503 are
  checked here; limits, idle ending and voice dialects have shared unit coverage. Physical
  device removal and a live provider disconnect are not end-to-end tested.
- **Partly:** reload/close releases media. Same-origin cookie keepalive can end the server call;
  cross-origin unload can leave write-up to the server deadline. Signing out after credentials
  are removed can also leave server completion to that deadline. Native props never receive
  a bearer/session/provider key; socket access uses one-use tickets.
- **Done:** Voice settings keep the existing server eligibility and voice list. Real-provider
  voice selection and its audible result are not verified without a provider sign-in.
- **Not done:** native Apple/Linux calls, animated call rings, exact per-Dood call-card hue,
  document-aware horizontal placement or React's two-column saved transcript. The web card
  stays compact on phones and outside the open Dood panel; the record has speaker-labelled text.
  The existing care/wardrobe controls remain available around the panel creature during calls.

## Implementation and merge seams

`views/call.contract` owns the views and root members. `data/call.ts` reads eligibility,
bridges only call metadata/start/lines/work/end plus socket tickets, and decodes native
snapshots without relabelling their owner. `modules/web/call.js` holds one shared caller
for the window and follows its handoff chat with a one-use-ticket WebSocket. Its browser
microphone/peer/player adapter is `call-media.ts`. `call-build.mjs` bundles the actual client
caller into `call-core.js` and compiles the media adapter. `modules/web/README.md` describes
the native props/events and cleanup boundary. There are no server or Exact-checkout changes.

Shared changes are intentionally small:

- app.contract: CallWindow use, call members/provides and one persistent root component use.
- app.ts: callSources import/spread; app.json and modules/web/index.js: register do-call.
- composer.contract: replace the old Send subtree with one CallSend use.
- panel.contract: call entry, reactive face/status wrappers; panel-mood.contract: callMood.
- shell.contract: CallMenu and CallRow uses for the name menu/sidebar.
- chat.contract: a call marker in transcriptRows, its route arm and call words in chatGrowth.
  The virtualized list cannot have an extra direct child; keep the marker approach on merge.
- chat-rows.contract: delegate CallRecord to CallHistory. data/chat-rows.ts: retain call ID and
  legacy chatId in the existing block fields. No shared shapes/styles were restructured. Keep callNameOf local:
  importing shell.contract's nameOf back into call.contract would introduce a cycle.
- README.md, COMPOSER.md and GAPS.md: replace outdated “calls absent” text and state limits.

## Reproducing the checks

Run these from this directory with the checkout configured as PORTING.md describes.
The browser runner currently expects slot 5. It starts no second server: the official
`./x agent` drive owns the empty server and page while its Playwright helper joins them.

- `./x test web call.test.contract`: no offering after hatching without a provider sign-in,
  including an explicitly opened wide panel and name menu. Also run with DC_CALLS=off and
  DC_CALLS=on; without a call provider both still offer nothing.
- `DC_CALLS=on DC_CALLS_SCRIPT=1 ./x test web tests/calls/scripted.test.contract`: real
  scripted voice hands on a question, says the echo Dood's answer and goodbye; mute,
  navigation, ending and its folded record. This lives outside the default suite because
  it needs that explicit server mode; production eligibility is not changed for tests.
- `node tools/call-browser-run.mjs`: React/Exact comparison at 1280×800 and 390×844 in
  light/dark; panel controls, floating card and records; long phone names; draft, pending
  upload and attached-file guards. The local file path produces a trusted picker event;
  Exact deliberately ignores synthetic FileList changes.
- The same browser runner negotiates a real local WebRTC loopback with Chrome's fake
  microphone, data-channel event, remote stream attachment, positive measured microphone
  level, track mute/unmute and teardown. It sets actual browser microphone permission to
  denied, then uses a separate granted context and injected HTTP 503 to check the failure
  card and microphone release. Only metadata is overridden to reach that non-scripted
  browser path; no OpenAI/provider request is made. CALL_MEDIA_ONLY=1 skips comparisons
  and guards; CALL_GUARDS_ONLY=1 skips comparisons but keeps guards/media/error checks.
- `bun tools/call-data-check.ts`: the actual bridge preserves a late snapshot's old owner,
  so Contract hides it after sign-out; stale sessions and unknown RPC verbs are refused.
- `bun modules/web/call-build.mjs --check`: both committed generated outputs are fresh.
- Shared client suites: `call.test.ts`, `call-events.test.ts`, `call-said.test.ts`.
  Server suite: `src/server/calls-directory.test.ts`. These are reused unchanged.

## Verification results

The final frozen-source run (runtime commit `3808987`) is clean: 70 tests passed, zero
failed, zero findings, exit 0; the device run took 755,782 ms. Client unit suites passed
26 tests, and calls-directory passed 10. The final batch also passed the scripted lifecycle,
DC_CALLS=off and DC_CALLS=on provider-absent eligibility tests, owner/RPC checks, all four
React/Exact browser comparison pairs, long-name and attachment guards, local WebRTC, actual
permission denial and injected provider failure. Generated bundles and git diff checks pass.
An early baseline attempt became stale when new native files changed mid-run and is not
counted as evidence.

The full check's machine-readable report is `.exact/calls-verify.json`, copied with its
properties output and notes to `.exact/shots/calls/verify-final*.{json,txt}`. Its Contract runner
runs, but Lean semantics is unavailable because `lake` is not installed; do not describe it
as a Lean proof. There is one existing, uncounted Tamber platform-select note. Non-counted
reload notes describe existing transient boxes, settings and list states in the wider app.

Active-call `check both` probes are separate from default verification, which has no provider.
The final wide Dood-panel probe has no findings in either theme. The compact floating card
intentionally overlays the upper chat as React's does: a short transcript behind it produces
two covered/overlap findings per theme at 1280×800 and one covered finding per theme at
390×844. Opening the wide Dood panel removes that overlay. These are documented, not hidden
behind acceptance entries. The first probes also found low-contrast dark labels; those labels
now use ink rather than primary, and the final probes have no contrast findings.

## Screenshots inspected

All are under `.exact/shots/calls/` in this worktree:

- exact-1280-light.png, exact-1280-dark.png, exact-390-light.png, exact-390-dark.png
- react-1280-light.png, react-1280-dark.png, react-390-light.png, react-390-dark.png
- exact-card-1280-light.png, exact-card-1280-dark.png, exact-card-390-light.png,
  exact-card-390-dark.png
- exact-record-1280-light.png, exact-record-1280-dark.png, exact-record-390-light.png,
  exact-record-390-dark.png
- exact-long-name-390.png, exact-long-record-390.png, permission-denied.png,
  provider-refused.png

The captures are sequential on the same chat: React also shows the record from the preceding
Exact call. These gitignored evidence files stay in this worktree and are not cherry-picked.
Screenshots show structure and state, not real-provider audio quality. GAPS.md's Calls
section records the media/unload and visual differences. A configured provider deployment
still needs real speech, interruption, voice selection, network/device failure and billing/
quota integration checks. No provider credentials were requested or fabricated.
