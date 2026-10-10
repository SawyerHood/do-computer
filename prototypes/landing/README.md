# The landing page: a mock-up

What a signed-out visitor to do.computer could be shown, drawn before any of it was built, when
the address opened on the sign-in form. It is not part of the app and nothing here is imported by
it. Nothing in it signs anyone in.

The owner chose the character select, in Jersey 25, and it was built the same day (HANDOFF.md,
section 5, item 48). Where the app differs: `/signup` and `/welcome` are not closed to a visitor
while sign-up is shut, since the first account and anyone invited still need them; the creatures
are the app's own `AgentAvatar`, so the egg at the end shows no cracks before it hatches; and
the line about hosting says "We run it for you, right here", since a page of the repository
cannot name one deployment.

```sh
node prototypes/landing/build.mjs     # writes index.html here; open it from the file system
```

`index.html` is not kept in git: with the pictures of the app in it, it is over two megabytes.
It needs the network once, for three.js and its fonts. The creatures, what they wear, the box and
the sky are the app's own, read from `packages/mascot/src` when it is built; the rest is
`src/style.css` and `src/app.js`. The line along the bottom switches between the looks and
the three states of each, and says what is showing; it is not part of the design. Each has an
address, a look and a state: `#a-open`, `#b-soon`, `#c-login` and so on.

The pictures of the app in `shots/` are real. They were taken on 2026-10-10 from the built Node
server with a real model: an agent called Pip was asked for a three-day trip to Lisbon in a
document, and then for a plan every Monday at nine. They are the chat, the document in the
library and the automations page, each in the dark and the light theme, at a desk's width and at
a phone's.

**The looks.** The owner chose the character select, which is what the page opens on. The other
three are kept behind it in the strip as they were when it was chosen. All of them say "your open
source personal assistant", show the app in a window whose tabs change the picture, and link to
GitHub.

- **Character select** (`#c-open`). A console's character select. One creature is large on a
  pedestal, with its name, the job it stands for and what it is doing. Beside it: "Your open
  source personal assistant.", and eight to choose from in two rows of four, the last an egg.
  (The owner first asked for no more than eight on the screen, then for eight to choose from.)
  "Press start" is the way in. The creatures are not called "little guys" anywhere in this look.
  Its headlines were first set in Pixelify Sans, which the owner found hard to read. The strip
  has a "Font" switch for this look, to compare in place: Jersey 25 (what it opens in now),
  DotGothic16, VT323, and Pixelify Sans as it was. In all but the last the small labels are in
  Geist Mono, the app's own, and not in Silkscreen.
  On a phone the headline comes first, then the one chosen, then the eight and the button, all
  on the first screen; and where the app is shown, the window gives way to the phone, with the
  window's tabs kept over it.
- **Earlier: sky island** (`#a-open`). The first run's sky at dusk, one creature on the island,
  nine more along the edge of what comes next.
- **Earlier: the app first** (`#b-open`). Light, the headline centred, the app's window with five
  creatures sitting on top of it.
- **Earlier: daylight** (`#d-open`). The sky at midday, everything centred, the app's window
  coming up from under the island.

**Under the top**, in every look: the app in its window (in A and C, where the top has none), six
things it does with a creature acting each out, "Type a name" (a creature grown from whatever is
typed; not in C, where the roster is that), open source with the three lines that run it,
"Feed it. Dress it up" with the app's own box opening, and an egg at the end that hatches when
pressed three times while sign-up is open.

**The three states.**

- `open`: sign-up is open (`DC_SIGNUP=open`). The buttons are there.
- `soon`: it is not (`DC_SIGNUP=invite`, the default). Nowhere on the page leads to making an
  account: "Coming soon" takes the buttons' place, with one small line under it, "Already have
  access? Sign in". The bar keeps only GitHub, and the egg at the end only rocks.
- `login`: the sign-in page while sign-up is shut, which is today's without "Create an account".

The repository is private as this is written, so the GitHub links would lead nowhere until it is
made public.
