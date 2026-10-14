# Voice calls: a mock-up

What it could look like to call a Dood: press Call, talk out loud, and it answers in a voice of
its own while it keeps working. It is drawn before any of it was built, to go with
`PLAN-voice-calls.md` at the root. It is not part of the app and nothing here is imported by it.
Everything in it is pretend: the call is a script, and the page makes no sound and does not
listen.

Layout A was built on 2026-10-14 (HANDOFF.md, section 5, item 91). Where the app differs: the
panel's call has no buttons to shrink it to the card or to fill the window, and the card is
where the call goes by itself when the panel is not on screen, under the strip and not in the
bottom corner; a hand-off is an ordinary message marked "Said on a call", in a side chat that
is the call's own where the call is held in the main chat, and the card names the step the Dood
is on and opens that side chat; the record's lines are ticked; the voice setting is a row of names beside the Dood's look, with nothing to
play; there are two lists of voices, one for each way of paying. B and C, the phone's screens
and a Dood calling its owner were not built.

```sh
node prototypes/voice-calls/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and the Geist typeface. The bar along the top switches
between the scenes and says what each one shows; it is not part of the design. Each scene has an
address. **▶ Play the call** runs one call from the first ring, in whichever layout is open, and
the layouts can be switched while it runs.

**Calling**

- `#start`: the app as it is, with the two new ways in: a Call button under the Dood's name in
  its panel, and a phone in the strip above the chat. Pressing Call shows the browser asking for
  the microphone the first time.

**On a call** (three answers to where the call lives on a wide screen):

- `#a`: in the Dood's panel. Its face is the call: the creature talks, rings show who is
  speaking, the words sit under it, with Mute, End and a switch for the words.
- `#b`: a small card over the chat, which is how OpenAI's Dots does it. The panel stays.
- `#c`: the call takes the whole sheet, and the chat steps aside.

In all three the chat holds the call as one live card: what was said, and what the Dood did
while it was on the line.

**Also**

- `#away`: another Dood's chat while the call goes on. It shrinks to a card in the corner, and
  the Dood's row in the sidebar says it is on a call.
- `#after`: the chat once the call is over: one record with what came of it, the words folded
  inside.
- `#phone`: the call filling a phone's screen; swiped down above the chat; and, for later, the
  Dood calling its owner.
- `#voice`: the Dood's settings, where its voice is chosen. The voice names and the price are
  pretend.

The creature on a call is drawn live by the app's own code (`packages/mascot/src/orb-core.js`,
its `speaking`, `listening`, `thinking` and `working` states, fed a word at a time). Where WebGL
is not to be had the page shows stills instead: `node creatures.mjs` draws them into
`src/stills.json`. The small creatures are stills from `prototypes/ios-app/src/creatures.json`.
Only one of a Dood moves on a screen at a time, so the card in `#b` carries a still.

`pack.mjs` wraps the built page so it can be shown in a T3 Code thread without typing it into
the call: it writes `payload.svg` and a small `loader.html` that unpacks it.

## The spike

`spike/codex-call.mjs` is not a mock-up: it places one real voice call, paid for by a ChatGPT
(Codex) subscription, from our own code. It is what section 10 of the plan reports, kept so the
route can be tried again. It ran twice on 2026-10-14 and both calls heard, answered, remembered
the earlier chat and handed a request on. Read its first lines before running it: it uses the
Codex client's sign-in on the machine it runs on, and a call counts against that subscription.
`--dry` does everything but the call.
