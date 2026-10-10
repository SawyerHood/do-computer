# The first run of the desktop app: a mock-up

What someone could be shown the first time they open the Do Computer desktop app, drawn before any
of it is built. Today the app opens on a small form (server, two tick boxes), then the sign-in
page, then the page where a pairing code is confirmed, and leaves them in settings. Here it opens
on a scene: an egg comes down out of the sky onto a little island, asks for what the app needs,
cracks a little more with each answer, hatches, and takes them to its chat. It is not part of the
app and nothing here is imported by it. Everything in it is pretend.

The owner approved it, and it was built the same day (HANDOFF.md, section 5, item 39). Where
the app differs: the scene is a page of the server's, for a browser as well as the desktop app,
and a browser is not asked about a computer; signing in with a provider goes through the
owner's own browser when it is the desktop app that asks; the agent's hello in its chat is the
empty chat's own words and not a message; and what was the sky in `src/app.js` here is
`packages/mascot/src/sky.js`.

```sh
node prototypes/onboarding/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The icons, the pretend people and agents and
most of the styles are read from `prototypes/agent-pages/src` and
`prototypes/main-and-side-chats/src` when it is built. The two lines along the bottom switch
between the scenes and say what each one shows; they are not part of the design. Each scene also
has an address: `#sky`, `#you`, `#name`, `#computer`, `#hatch`, `#chat` and `#back`. A scene opened
from the strip is set up as if everything before it had been answered. The buttons in the card
work, so it can be clicked through from the start to the chat.

**The scene.**

- `#sky`: the app opens on the night sky and its name. The egg comes down in a column of light,
  through the clouds, and lands on a floating island above a floor of cloud. A click anywhere, or
  Skip, lands it at once. Then it speaks: one card under it, with its words written out as it says
  them.
- `#you`: "who are you?" is making an account, or signing in. The server is already chosen
  (`do.computer`); "Change" opens a field for someone who runs their own. Answering puts the first
  crack in the shell.
- `#name`: the first agent is named here, and given its colour, which the egg takes as it is
  picked. The second crack, and the sky begins to lighten.
- `#computer`: the pairing, as one question: "may I work on this computer?", with "Only read
  files" and "Not now" beside yes, and the tick box for opening the app at sign-in. There is no
  code to copy and no page to confirm it on: the window is signed in, so the app pairs itself.
- `#hatch`: the last crack and the hatch, at sunrise. Each answer was a step of the hatch, so the
  egg is the progress bar.
- `#chat`: the scene gives way to the app, the creature goes to its place in the panel, and it
  says hello first, with what it can now do on this computer. Not the settings page.
- `#back`: someone who already has an account signs in and is not asked for a name. Their own
  agent comes out of the egg, asks about this computer, and takes them back to the chat they left.

**How it is drawn (`src/app.js`).** The sky, the clouds and the island are one small three.js
scene, drawn at a third of the size and shown large with hard pixels, as the creature is: lit at
the corners, each corner on a whole pixel, and what is see-through as a pattern of holes. The egg
and the creature are the mascot's own renderer (`packages/mascot`), in a canvas of its own laid
over the island and moved with it. When the card is tall or the window short, the view pulls back
and up so that the egg stays clear of the card.

**What building it would need that is not there.**

- Two calls in the mascot: an egg that keeps a number of cracks while it waits (the mock-up
  reaches into `_egg` for this), and one drawn without its shadow while it is in the air.
- The scene would be a page of the server's, shown in the app's main window, since making an
  account, naming the agent and confirming the pairing are all the server's to do. The app's own
  part is small: saying that it is the desktop app, starting the daemon, and handing the page the
  pairing code so that the page can confirm it without being asked.
- The agent's first words in the chat are written by the app, not by a model.
- With reduced motion: no fall and no hatch, the egg already landed and the same card.
