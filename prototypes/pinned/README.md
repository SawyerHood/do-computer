# Pinned things: a mock-up

What it could look like if a person or a Dood could pin something from the library (a board the
Dood keeps up to date, a plan) to that Dood, so that it stays in reach and can be popped out and
watched. It is drawn before any of it was built. It is not part of the app and nothing here is
imported by it. Everything in it is pretend.

Direction A was built on 2026-10-13, opening beside the chat (HANDOFF.md, section 5, item 71).
Where the app differs: a pin's small picture is the top of the real page at half size, with no
buttons on it beyond a way to unpin; the time is a clock time, and "Just changed" stands in for
the mark while a Dood is at work on it; there is no "+" on the shelf, since pinning starts from
the file. A window of its own, the phone's chips and ticking a step on a page were not built.

```sh
node prototypes/pinned/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for the Geist typeface. The creatures are stills from
`prototypes/ios-app/src/creatures.json`. The bar along the top switches between the scenes and
says what each one shows; it is not part of the design. Each scene also has an address.

**Where pins sit** (three answers to the same question):

- `#a`: under the Dood's face, in its panel on the right. A Pinned shelf between the face and
  "What it did here": the first pin is the page itself drawn small, the rest are rows.
- `#b`: under the Dood's row in the left sidebar, for every Dood that has pins, whichever one is
  open.
- `#c`: a tab of the Dood's own, next to Chat, Library and Automations.

**Popped out:**

- `#open`: beside the chat, in the document panel the app already has, with a pin button and a
  button to pop it out further.
- `#window`: a window of its own that stays over other windows, in the desktop app.

**Also:**

- `#pin`: pinning something yourself, from a file's card in the chat or an open document's bar.
- `#phone`: chips under the Dood's name, and a sheet over the chat.

"Juniper updates the board" plays the Dood changing the file: its status, the pin's mark and the
page itself change in whichever scene is showing. Steps on the board can be ticked, the chat's
Unpin works, and what is changed in one scene shows in the others.

`pack.mjs` wraps the built page so it can be shown in a T3 Code thread without typing it into
the call: it writes `payload.svg` and a small `loader.html` that unpacks it.
