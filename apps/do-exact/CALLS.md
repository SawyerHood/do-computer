# Calls port checklist

Reference: docs/reference/calls.md, components/call/call.tsx, lib/call.ts,
packages/client/src/call*.ts, components/chat/agent-panel.tsx, composer.tsx,
shell/agent-strip.tsx, server/calls-directory.ts and packages/agent's call routes.

- Offer only where the server allows it, after hatching; one call at a time.
- Start from the empty composer, Dood panel, and name menu, in the main chat.
- Ask for the microphone, connect with WebRTC and the oai-events data channel;
  play the remote stream; release microphone, peer, meters and sockets on exit.
- Starting, connecting, listening, hearing, speaking, working, mute and unmute.
- Creature reactions, waveform levels, elapsed clock, latest words and hide/show.
- Live transcript and pending handoffs; handoff progress and answers sent to voice.
- Persistent window-level call while navigating, back to its chat, end anywhere.
- Write-up placeholder, durable folded record, summaries, old side-chat link.
- Permission/device refusal, provider failure, disconnect, idle/deadline endings.
- Reload/close cleanup. Server credentials never enter the browser native view.
- Voice settings use the existing server eligibility and voice list.

The final report records coverage and limitations against this list.

## Implementation and checks

`views/call.contract` is the view and its root members. `data/call.ts` reads eligibility,
bridges only the five call operations and socket tickets, and decodes the native snapshot.
`modules/web/call.js` holds one shared caller for the window and follows its handoff chat
with a one-use-ticket WebSocket. The microphone/peer/player adapter is call-media.ts.
`call-build.mjs` bundles the actual packages/client caller into call-core.js and compiles the
media adapter. Run `bun modules/web/call-build.mjs --check` after package changes.

- `./x test web call.test.contract`: no offering without a sign-in. Also run with DC_CALLS=off
  and DC_CALLS=on; without a call provider both still offer nothing.
- `DC_CALLS=on DC_CALLS_SCRIPT=1 ./x test web tests/calls/scripted.test.contract`: the real
  server's scripted voice hands on a question, says the echo Dood's answer and goodbye; mute,
  navigation, ending and its folded record. This test lives outside the default suite because
  it needs that explicit server mode; production eligibility must not change for the tests.
- `node tools/call-browser-run.mjs`: the official ./x drive owns slot 5's server and host;
  a browser joins it to compare React and Exact at 1280×800/390×844, light/dark. It checks
  panel controls, a floating call and records, then a real local WebRTC loopback with Chrome's
  fake microphone, data channel, remote stream attachment, mute, levels and teardown. It also
  sets the real browser microphone permission to denied, then grants it and injects a 503
  at the provider boundary to check the failure card and microphone release. This last test
  overrides only calls metadata to force the non-scripted browser path; no OpenAI call is
  made. CALL_MEDIA_ONLY=1 skips taking the comparison shots.
- The shared client's call, call-events and call-said unit suites cover limits, idle hangup,
  transcript assembly and voice dialects; the server calls-directory suite covers permission,
  provider precedence and quotas. They are reused without changes.

See GAPS.md, Calls, before claiming provider audio or cross-origin unload is fully tested.
