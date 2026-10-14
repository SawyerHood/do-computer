# Voice calls: plan

**Status:** written 2026-10-14, and step 1 was built the same day: calls on the web, in the
Dood's panel, paid for by a ChatGPT (Codex) subscription or an OpenAI API key. Section 11 says
what was built and where it differs from what is written here. Section 10 is the spike that
showed a subscription can pay. Section 8 has the owner's answers and the choices still open,
and section 9 what was read, what was run and what never was. `HANDOFF.md` section 5 item 91
is the record, and `docs/reference/calls.md` is how it works for whoever runs a deployment.

The owner asked for what OpenAI's Dots has: a button that calls your Dood and starts a real-time
voice conversation with it. This plan says what Dots does, how it is most likely built, what Do
Computer has today, and the order to build it in. A mock-up goes with it:
`prototypes/voice-calls/` (`node prototypes/voice-calls/build.mjs`, then open `index.html`).

## 1. What Dots does

Dots launched at OpenAI's DevDay on 2026-09-29: always-on agents with a cloud computer each,
reached through ChatGPT, Slack, Teams, or a call. From OpenAI's own pages
(`learn.chatgpt.com/docs/dots/channels` and `/docs/dots/tasks-and-memory`):

- **Starting one.** "To call your dot, open its conversation and select the phone button. In the
  desktop app, you can also select Call in its profile." It works in the mobile app, the desktop
  app and a desktop browser. "Mobile web is not supported."
- **What it is for.** "Talk through a request, clarify a decision, or ask for a progress update."
- **Text at the same time.** "You can type messages while you're talking, and your dot can also
  message you with progress or a question." Their picture of it has the chat in full, and the
  call as a small dark card over its corner: the dot's face, its name, a timer, a mute button
  and a red hang-up button.
- **Hanging up.** "Ending a call ends the voice conversation; work you've assigned can continue."
- **One direction.** "Calls initiated by your dot are planned for after launch."
- **What the call knows.** "Calls use selected conversation context", which "can differ from what
  a background task sees". The call is not the whole agent; it is given a part of the chat.
- **Same dot.** A call is one more way in to the same agent and the same memory.

On a phone the call is a full screen (face, name, timer, then Speaker, End and Mute) that
minimizes, and it shows in the Dynamic Island.

What people said in the first two weeks, from OpenAI's forum and reviews:

- The voice is the owner's ChatGPT voice. The most-read request about calls is a separate voice
  for a dot ("having distinct voices would help give each experience its own identity").
- On an iPhone the call dropped when the screen locked, until a setting buried in the app was
  found. A request asks for the call to stay visible as a floating badge on other pages.
- "You don't actually call your Dot with the phone app. Instead, it launches a reskinned version
  of a live voice chat." It is ChatGPT's voice mode with a dot's face on it.
- In the keynote, dots repeatedly failed to give a spoken update when asked for one.

CopilotKit's open-source copy, OpenDots, has the same feature and its code can be read
(`src/server/voice.ts`, `src/client/useVoice.ts`). It opens an OpenAI Realtime session over
WebRTC with the server holding the key, gives the voice model one tool, `ask_compute`, which
runs a turn of the real agent in the same conversation, caps a call at 15 minutes and six such
turns, and when the call ends asks the agent to write "a short call receipt" from the words.

## 2. How it is built

Two models, not one. A small, fast speech model holds the conversation: it hears, answers within
a few hundred milliseconds, and can be interrupted. It is not the agent. When something needs
the agent (a tool, the computer, real thought) the speech model hands the request to the agent
and keeps talking while the agent works, then says what came back.

OpenAI sells this in two forms. Both were read in their documentation, neither was run.

|                          | **GPT-Live** (`gpt-live-1`, 2026-09-10)                                                             | **Realtime** (`gpt-realtime-2.1`)                                |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Price                    | $0.05 a minute, by the second                                                                       | By token: audio $32 in, $64 out per million (the mini: $10, $20) |
| Handing work on          | Built in: "delegation". With _client delegation_ the app runs its own agent and returns what to say | A function tool the app defines, as OpenDots does                |
| Talking over each other  | Full duplex                                                                                         | Turn detection, with interruption                                |
| Context to start with    | Instructions, and up to 128 earlier messages or 8,192 tokens                                        | Instructions, and conversation items                             |
| Browser                  | WebRTC; the server swaps the browser's offer for an answer and keeps the key                        | The same                                                         |
| A server beside the call | A "sideband" WebSocket onto the same session                                                        | The same                                                         |
| Longest session          | Not stated                                                                                          | 60 minutes                                                       |

Dots is very likely GPT-Live with delegation: the model came out nineteen days before Dots, a
review calls the feature "GPT Live Voice calling", and "calls use selected conversation context"
is what an 8,192-token start would look like. That is my inference; OpenAI does not say.

**Recommended: GPT-Live with client delegation.** It fits Do Computer better than it fits Dots,
because a Dood's brain is whatever model its owner chose. The speech model is only the voice;
the Dood keeps its own model, tools, computers, approvals and memory. A Dood on Claude or Muse
can be called just the same. The flat price is also easier to put a limit on. Realtime is the
fallback if the account cannot use `gpt-live-1`.

Other ways, not recommended:

- **A chain of what we have.** Transcribe, give the text to the Dood, read the answer out.
  OpenRouter has both ends (`/audio/transcriptions`, which dictation already uses, and
  `/audio/speech`), so it needs no new key. But the wait before each answer is the Dood's whole
  turn, there is no interrupting, and it is a voice message, not a call.
- **Google's Gemini Live, or speech models on Cloudflare.** Possible behind the same seam
  later. Neither has the hand-off built in.
- **OpenRouter.** It has no real-time speech.

## 3. What Do Computer has today

- **Dictation only.** A clip is recorded, sent whole to `POST /api/transcribe`, and comes back as
  text (`apps/web/src/server/transcribe.ts`, `apps/web/src/lib/use-dictation.ts`,
  `apps/mobile/src/chat/dictation.tsx`). No speech out, no WebRTC, no streaming audio anywhere.
- **A level meter** that reads loudness from a microphone track
  (`apps/web/src/components/chat/waveform.tsx`).
- **A creature that already talks.** `packages/mascot` has `listening`, `speaking`, `thinking`
  and `working` states and a mouth; `orb.feed("token", 0..1)` opens the mouth by that much. The
  web's `feedMascot` does not pass an amount yet (`apps/web/src/lib/mascot.ts`).
- **No OpenAI key in the environment.** The only model key read from it is `OPENROUTER_API_KEY`.
  But a workspace can save an OpenAI API key under Model sign-ins, and so can the deployment
  under Global models (`packages/agent/src/model-access.ts`, `credentialChain`: workspace first,
  then deployment). A credential is never sent to a browser.
- **The desktop app can already use the microphone.** Its window allows `media`, and the Mac
  build has the audio-input entitlement. The sentence macOS shows is about dictation
  (`apps/desktop/electron-builder.yml`).
- **The phone app cannot do WebRTC.** It has `expo-audio` and no `react-native-webrtc`, so calls
  there need a native module and a new build.
- **Sockets carry text only.** An actor's WebSocket drops binary frames on both runtimes
  (`packages/runtime/src/index.ts`), with 1 MiB a message on Cloudflare. Sound cannot sensibly
  go through our server, and with WebRTC it does not have to.
- **Writing into the main chat from outside a turn** has a pattern: a keyed `write` of an entry
  of the app's own kind, with what the model should read of it, as sub-agents report
  (`packages/agent/src/subagents.ts`) and side chats mark their branch point (`dc.branch`).
- **Browser tests already run with a pretend microphone** (`apps/web/playwright.config.ts`).

## 4. The design

### 4.1 A call, end to end

1. The person presses Call. The browser asks for the microphone the first time, opens an
   `RTCPeerConnection` with the microphone track and a data channel, and posts its offer to
   `POST /api/agents/<id>/calls`.
2. The server checks the person may call (4.5), takes the OpenAI key from Model sign-ins, and
   starts a GPT-Live session with that offer. The session is given:
   - **instructions**: the Dood's name and character, its notes about its owner, and the rules of
     a call (short spoken sentences; hand on anything that needs a tool or a fact it was not
     given; never say work was done that was not);
   - **input**: the end of the main chat, as many whole messages as fit in 8,192 tokens, with
     tool output left out;
   - **the voice** chosen for this Dood (4.4).
     It answers with the SDP answer and a call id. The key stays on the server.
3. Sound goes straight between the browser and OpenAI. Our server never carries it.
4. The Dood's actor attaches to the same session over the sideband socket. From then on it hears
   of every word (as text) and of every hand-off.
5. **A hand-off** (`session.delegation.created`): the actor puts the request into the Dood's main
   chat as an ordinary message marked as spoken, so the Dood answers in a few sentences meant
   for the ear. The Dood works as it always does: its own model, its tools, its computers, its
   approvals. While it works, the actor passes short progress on ("reading the analytics") for
   the voice to say. When the turn ends, the answer goes back as what to say
   (`session.commentary.append`, 500 tokens at most; a longer answer is cut to its opening, and
   the whole of it is in the chat).
6. **"How is it going?"** is the use Dots names first and fumbled on stage. So the actor keeps
   the voice told, quietly, of what the Dood is doing whenever that changes
   (`session.thinking.append`). The voice can then answer at once, without a hand-off.
7. Typing during a call is an ordinary message to the main chat. The voice is told of it and of
   the answer.
8. Hanging up closes the session. Work the Dood was given carries on.

A Dood that is already working when it is called is not stopped: a hand-off reaches it as a
message does, by the Dood's own steer-or-queue setting.

### 4.2 What the chat keeps

One entry of a new kind, `dc.call`, in the main chat:

- **While it lasts**: a live card with the words as they are said and what the Dood did.
- **Afterwards**: how long it was and what came of it in two or three lines, written by the small
  model that already writes side chats' notes, with the words folded inside.
- **For the Dood**: the entry carries the words as text for the model, so the Dood remembers a
  call like anything else said in the chat. The sound is not kept by us, and the session is
  started with `store: false` so OpenAI does not keep a recording.

The Dood's turns during a call are ordinary turns in the main chat, with their steps.

### 4.3 Where it shows (the mock-up)

- **Ways in**: a Call button under the Dood's name in its panel, and a phone in the strip above
  the chat for when the panel is shut.
- **On a wide screen, three candidates** (mock-up `#a`, `#b`, `#c`):
  - **A, in its panel** (recommended). The panel is already the Dood's face, so the call happens
    there: the creature's mouth follows the loudness of its voice, it leans in while the owner
    speaks, and shows working while it works. The words sit under it, with Mute, End and a
    switch for the words.
  - **B, a small card** over the chat, as Dots has it.
  - **C, the whole sheet**, the chat stepping aside.
- **Somewhere else** (`#away`): the call belongs to the app, not to a page. On another Dood's
  chat, the library or settings it is a card in the corner, and the Dood's row in the sidebar
  says it is on a call. The owner's rule that only one of a Dood moves on a screen at a time
  holds: beside its own panel the card carries a still.
- **A panel that is shut, or a narrow window**: the card.
- **Phone** (`#phone`): the call fills the screen; swiped down, it rides above the chat.

### 4.4 A voice of its own

Each Dood has a voice, picked from the provider's list by its seed when it hatches, as its looks
are, and changeable in its settings (`#voice`). Two Doods do not sound like one person, which is
the thing Dots' users ask for most.

### 4.5 Who pays, and limits

- **Whose sign-in pays** (the owner's rule, 2026-10-14): the nearest one. The person's own, then
  the workspace's, then the server's. The owner wants every key and subscription in the app to
  work this way, not only calls. Today a sign-in belongs to a workspace or to the server; a
  person's own is a level that does not exist yet (section 8).
- **Which kind**, at each level: a ChatGPT subscription signed in as **OpenAI Codex** first, since
  it costs nothing more than the plan (section 10), then an OpenAI API key. With neither
  anywhere, there is no Call button. The newer **Sign in with ChatGPT** cannot place a call
  (section 10), so it does not count here.
- **What a call costs.** On a subscription: nothing beyond the plan, counted against its limits
  in a way OpenAI does not state. On an API key: $0.05 a minute for the voice, so a ten-minute
  call is $0.50. Either way the Dood's own model is paid for the work it is handed, as if it
  had been typed.
- **Limits** come from the environment, as the owner asked, with defaults that are mine:
  `DC_CALL_MINUTES` (30, the longest call), `DC_CALL_MONTHLY_MINUTES` (60, for each person, where
  the server's sign-in pays), and a hang-up after 2 minutes of silence. One call at a time for a
  person.
- **A switch**, `DC_CALLS`: `off`, `admins` or `on`, as `DC_SECRETS` has. The owner chose
  `admins` for now.
- **Said plainly in the app and the docs**: on a call the owner's voice goes to OpenAI, whichever
  model the Dood thinks with.

### 4.6 Where the code goes

- **Protocol** (`packages/protocol`): the call's state, its events on the agent socket, the
  `call` part of a chat message, the voice on a Dood's identity.
- **Agent** (`packages/agent`): `calls.ts`, holding a `VoiceEngine` seam with two engines
  (`openai-live`, and a scripted one for tests, as the echo model is for chat); the routes
  `POST calls`, `POST calls/<id>/end`; the sideband and the bridge of 4.1; the `dc.call` entry
  and its projection (`project.ts`); limits.
- **Web** (`apps/web`): `use-call.ts` (microphone, peer connection, playback, loudness of both
  sides), the call held above the router so it outlives a page, the panel and the card, the
  call's part in the transcript, the voice setting, `feedMascot` taking an amount.
- **Runtimes**: an outbound WebSocket from the actor on Cloudflare and on Node, the packed
  desktop build included. While a call lasts its Durable Object stays awake, which costs next to
  nothing for minutes at a time.
- **Desktop**: the microphone sentence, which needs a release.
- **Docs**: a guide page, and the self-hosting page (the key, `DC_CALLS`).

If the sideband cannot be held from a Durable Object, the fallback is the browser passing
hand-offs and words to the server over the data channel it already has, as OpenDots does. It is
simpler and trusts the browser more. (That is what was built: section 11.)

## 5. Steps

0. **The spike.** Done, for both ways of paying (section 10): a call over WebRTC, the chat
   given as context, a hand-off answered, from the browser alone and with a server's own line.
1. **Calls on the web and in the desktop app.** Built (section 11). Sections 4.1 to 4.5: the
   routes and the bridge, the entry in the chat, layout A with the card elsewhere, a voice for
   each Dood, limits and the switch, the reference page.
2. **Polish.** An approval asked for during a call (the voice says one is waiting and the card
   shows in the chat; nothing is approved by voice); the desktop companion carrying the call
   when the window is hidden; a key to mute; C as a way to enlarge A.
3. **The phone app.** `react-native-webrtc`, sound in the background, the full screen and the
   bar. It needs a paid build.
4. **A Dood calls its owner.** A `call` tool: it rings in the app and as a notification, with
   why it is calling, and Answer starts the same call. Quiet hours. Dots does not have this yet.
5. **A phone number.** GPT-Live takes phone calls through a carrier (SIP). A Dood could have a
   number to ring from any phone. Each number costs money.

## 6. What could go wrong

- **The voice makes things up** instead of handing on, or says something was done that was not.
  The instructions forbid it and the chat shows what was really done, but it is the known
  weakness of this design and it shows in Dots.
- **Two minds.** The voice is not the Dood's model, and it knows only what it is given. It may
  not sound like the Dood, or may not know something the Dood knows. Handing on is the cure, at
  the price of a wait.
- **Waits.** A hand-off takes as long as the Dood's turn. The voice fills it with progress.
- **Cost on a public deployment.** A call left open is $3 an hour. Hence the limits and
  `admins`.
- **The sideband on Workers** is unproven here.
- **Safari and phone browsers.** Not checkable on this machine. Dots itself does not support
  mobile web.
- **Sound reaching OpenAI** from a Dood whose owner chose another provider on purpose.

## 7. What this plan leaves out

Video and screen sharing on a call. More than one person on a call. Calls in Slack or Teams.
Recording the sound. A wake word. Speech models run by ourselves.

## 8. The owner's choices

Answered on 2026-10-14, in the owner's words where quoted:

- **Build it**: "Yeah lets build it!", once the question of section 10 was answered.
- **Whose sign-in pays**: "either the server, so via API key or workspaces bring the key";
  "whichever the lowest level one is. So ... user, then workspaces, then server"; "all of our
  keys should work like this in subscriptions".
- **The subscription**: "if that's good, then we should use the codex sub, ideally".
- **Limits**: "maybe the caps are set as like an environment variable or something".
- **Who may call to begin with**: "we can do admins only for now".

Answered the same day, after the spike: "Yeah, layout A seems right. And then I agree on your
take on two and then I think Codex is fine for now." So:

- **Where the call lives on a wide screen**: A, in the Dood's panel, with the card elsewhere.
- **A person's own sign-in** is its own change, after calls: calls start on the workspace's
  sign-in and then the server's.
- **Relying on the Codex sign-in** is fine for now.

Still open, each built as it was proposed:

1. **A voice for each Dood**, picked by which Dood it is: yes or no.
2. **The words kept in the chat**, folded: yes or no.
3. **The phone app**: now (a paid build) or later.
4. **A Dood calling its owner**: a later step, or not wanted.

## 9. What was read, and what was never run

Read directly: OpenAI's two Dots pages named above, where the picture of the call card and the
profile's Call button were photographed; OpenDots' code and its recording of a call; a
screenshot of the phone's call screen posted on X on 2026-09-30.

Read through a summarizing fetch, not word for word: OpenAI's API guides for GPT-Live and
Realtime (`/api/docs/guides/live`, `live-delegation`, `live-conversations`,
`voice-server-controls`, `realtime-conversations`) and its pricing page. The event names and
limits in sections 2 and 4 come from those summaries and should be checked against the pages in
the spike.

Run, on 2026-10-14: the calls of section 10, from a headless browser on the owner's Linux
machine with a synthesized voice as the microphone; and, once the app was built, a call through
the app itself on each way of paying (section 11).

Never run: a deployed Worker; a Durable Object holding an outbound socket for a call, which
what was built does not need; anything on a phone, in Safari or in the desktop app. Nothing
here could hear a call: what was said is known from what the provider wrote down of it, and
that sound came back from how loud it was. That Dots is built on GPT-Live is an inference.

## 10. The spike: a call on a ChatGPT (Codex) subscription

The owner asked whether the Codex subscription could be used for calls, as pi uses it for text.

**It can, with the sign-in the app calls OpenAI Codex.** A script placed a real call with the
Codex sign-in on the owner's machine, from our own code and not through Codex's client
(`prototypes/voice-calls/spike/codex-call.mjs`). In one 45-second call:

- it heard a spoken sentence and answered aloud at once ("I can hear you clearly.");
- it knew what the chat had said before the call ("What is my favorite color?" "Teal.");
- asked about the owner's files, it handed the request on; the script answered as the Dood
  would, and it said that answer aloud, with "Let me check that for you..." while it waited;
- the server's own line onto the call worked beside the browser's;
- from asking for the call to a session ready to talk took about a second.

**How**, as OpenAI's open-source Codex client does it (`codex-rs/codex-api`, `codex-rs/core`):

- `POST https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas`
  with the sign-in's access token, its account id (`ChatGPT-Account-ID`), `openai-alpha:
quicksilver=v2` and a JSON body `{ sdp, session }`. The answer is the SDP, with the call's id
  in `Location`.
- `session` is `{ model: "gpt-live-1-codex", instructions, audio: { output: { voice } },
delegation: { type: "client" }, initial_items }`. `initial_items` are earlier messages: up to
  128, 8,192 tokens.
- The browser's offer must carry a data channel named `oai-events` as well as the microphone.
  Without it the call is made and never connects.
- The server's line is `wss://api.openai.com/v1/live/<call id>` with the same headers.
- Events, on the data channel and on the server's line alike: `session.started`,
  `input_transcript.added`, `output_transcript.added`, `turn.created`, `turn.delta`, `turn.done`
  (a whole turn, with who said it), `delegation.created` (with the request as text),
  `delegation.context.appended`, `session.usage.updated`, `session.closed`. The server's line
  also gets the sound of both sides, ten messages a second (by their format about 130 KB a
  second), which it has no use for.
- A hand-off is answered with `delegation.context.append`: the delegation's id, a `channel` of
  `commentary` (progress) or `speakable` (the answer), and the text, 500 bytes at most.
- `session.close` ends it. A session lasts two hours at most.
- Nine voices: juniper, maple, spruce, ember, vale, breeze, arbor, sol, cove. A voice that is
  not among them is refused with "Voice session access denied", which reads like a refusal of
  the caller and is not.

**Which sign-ins work**, each tried the same day:

| Sign-in, as Model sign-ins names it                                  | Text | Calls                                                                                                                      |
| -------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI Codex** (Codex's own login; pi marks it legacy)             | yes  | **yes**, as above                                                                                                          |
| **OpenAI**, signed in with ChatGPT (the official way for other apps) | yes  | no: both call routes answer 401 `no_matching_rule`; the public Realtime route starts a session and then fails every answer |
| **OpenAI API key**                                                   | yes  | **yes**, on the public route, with other names for the same events (below)                                                 |

**Its footing.** The route is Codex's own and is documented for nobody else. Our calls on it
stand where pi's Codex sign-in already stands for text: it works because OpenAI lets it. It
stopped working for everyone, Codex's own client included, for about two days in August 2026
(openai/codex issue 40140). The official Sign in with ChatGPT covers text only today, and an
open issue asks OpenAI whether calls are meant to work with it (53003, unanswered). So the
engine is built behind a seam, with the API key as the documented way, and a call that fails on
a subscription says so plainly.

**Not learned**: how a call counts against a plan's limits (the usage event carries the seconds
and an empty limit); whether a workspace's stored Codex sign-in behaves as the Codex client's
own did (it is the same kind of token, from the same OAuth client).

**Three more things tried before building**, each with one real call:

- **The browser alone can carry a call.** Over its data channel it was sent every event but the
  sound, answered a hand-off with `delegation.context.append`, and hung up with `session.close`.
  No server's line was needed.
- **An OpenAI API key works on the public route**, and not on Codex's (which answers it
  "Your account does not have access to Quicksilver v2 sessions"). The public route is
  `POST https://api.openai.com/v1/live/sessions` with `{ session, transport: { type: "webrtc",
sdp } }`, answered with `{ session: { id }, transport: { sdp } }`. The session is the same
  but for `model: "gpt-live-1"` and `input` in place of `initial_items`. Its events are
  `session.started`, `session.input_transcript.delta` and `session.output_transcript.delta`
  (words only, with no end of a turn), `session.delegation.created` (an id, and not the
  request in words), `session.usage.updated`, `session.closed`. A hand-off is answered with
  `session.commentary.append` (said) or `session.thinking.append` (not said), each with an
  `event_id`, the `delegation_id` and `content` as a string.
- **The voices are different.** The public route takes marin, cedar, quartz, ripple, vesper,
  willow, stone, gleam, meridian, beacon, delta and cinder, and refuses the nine of Codex's
  route with the same "Voice session access denied".
- **The route takes a call that names its sender honestly**: `originator: do-computer` and a
  user agent of the app's own, where the first spike had borrowed pi's.

## 11. What was built, and where it differs

Step 1, on 2026-10-14. The record is `HANDOFF.md` section 5 item 91.

- **The browser carries the call; the server holds no line onto it.** Section 4.1 has the
  Dood's actor attach to the session. What was built instead: the server starts the call and
  keeps what the browser tells it was said; the browser hears a hand-off, sends it to the chat
  as a message, watches the chat for the Dood's answer, and gives that to the voice. It needs
  nothing new of either runtime, and nothing carries the sound of both sides to the server.
  What it gives up: the limit on a call's length is kept by the browser. The server's count
  stops at the limit, and it does not cut the sound off.
- **A hand-off is an ordinary message** with a note beside it (`<meta kind="call">`), marked
  "Said on a call" in the chat. The Dood's steer-or-queue setting applies to it as to any.
- **The voice is not told how work is going that it did not hand on**, nor what is typed
  during a call (4.1, points 6 and 7). While the Dood works on a hand-off, the voice is told
  its steps.
- **No server-side hang-up, no whole-window layout (C), no button to shrink the panel's call
  to the card.** The card is where the call goes by itself when the panel is not on screen.
- **A voice is picked by the Dood's id**, not kept from when it hatched, and the two ways of
  paying have their own lists, so a Dood can sound different after a change of sign-in.
- **The limits' names**: `DC_CALLS`, `DC_CALL_MINUTES`, `DC_CALL_MONTHLY_MINUTES`.
- **One pull request**, not two.

**Run for real through the built server**, on the owner's Linux machine, with a recorded voice
as the microphone and Claude Haiku as the Dood, once on an OpenAI key (a workspace's) and once
on the Codex client's sign-in (put in as the server's). Each time the voice answered a spoken
sentence, said "Teal" from the chat held before the call, handed "look in my project folder" to
the Dood, which ran commands and answered in the chat, and said that answer in its own words.
The record had the length, two lines of summary and the words. The second call's 53 seconds
were counted against the month.
