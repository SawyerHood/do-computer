# Panel sections: a mock-up

What the Dood's panel beside the chat could do when it has a lot in it (something pinned, a
command running, threads from other Doods and from Slack, files, and what it did). Today each
section has a share of the height and its own scroll area, and the last ones fall off the bottom.
It is drawn before any of it was built. It is not part of the app and nothing here is imported by
it. Everything in it is pretend.

Direction A was built on 2026-10-13 (HANDOFF.md, section 5, item 85). Where the app differs: the
caret and the count are the app's own; a folded list of threads says "Answered", "Answering" or
how many are waiting for an OK, which are the states a thread has; What it did here shows its
latest five with a "Show more", borrowed from C; the bar scrolls back to the face when pressed;
and "Face tucks away" is not a setting.

```sh
node prototypes/panel-sections/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for the Geist typeface. The creatures are stills from
`prototypes/ios-app/src/creatures.json`. The bar along the top switches between the scenes; it is
not part of the design. Only the panel is drawn, with notes beside it. Each scene has an address.

- `#today`: the panel as the app lays it out now (`apps/web/src/components/chat/agent-panel.tsx`),
  in a window 800px tall.
- `#a`: folding sections. A heading folds its section; folded, it still says how many, and whether
  something is running or waiting. The panel scrolls as one and the face tucks into a bar.
- `#b`: tabs under the face (Pinned, Work, Messages, Files), one group at a time.
- `#c`: short lists. Nothing folds; a list shows its newest few and a "Show 3 more".

"A Slack message comes in" adds a thread that is waiting for an answer, to see how each one says
so. "Tall window" draws the panel 1150px tall. In A, "Face tucks away" turns the bar off, so the
face stays and only the sections scroll.

`pack.mjs` wraps the built page so it can be shown in a T3 Code thread without typing it into
the call: it writes `payload.svg` and a small `loader.html` that unpacks it.
