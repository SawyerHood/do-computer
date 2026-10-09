# Using a screen and a browser: a mock-up

What it could look like in Do Computer when an agent uses the screen of a paired computer, or a
browser on it, drawn before any of it was built. It is not part of the app and nothing here is
imported by it. Everything in it is pretend: the desktop, the page, and what Pip does on them.

```sh
node prototypes/computer-use/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The icons, the pretend people and agents and
most of the styles are read from `prototypes/agent-pages/src` and
`prototypes/main-and-side-chats/src` when it is built. The two lines along the bottom switch
between the scenes and say what each one shows; they are not part of the design. Each scene also
has an address: `#screen`, `#browser`, `#large`, `#ended`, `#yours`, `#paused`, `#allow` and
`#phone`. The pretend screens go by themselves, and begin again when their steps run out. Pause,
Stop, the window and the switches work. "Pointer" in the strip changes how the agent's pointer is
drawn: an arrow with its name, or an arrow with the creature beside it.

**In the chat.**

- `#screen`: Pip is using the MacBook's screen. A little window is in the chat where Pip began:
  the screen as it is now, Pip's pointer on it, and one line for what it is doing. Pip's panel has
  the same in small under "On MacBook now".
- `#browser`: the same window for a browser of Pip's own on the MacBook. Only the page is shown;
  its address is beside the computer's name.
- `#large`: the window opened, with the steps so far beside the screen. It is for watching only.
- `#ended`: the window folds to one line. "What it did" has the picture Pip took at each step.

**On the computer.**

- `#yours`: what the person at the MacBook sees. Pip has a pointer of its own, in its colour and
  with its name; theirs stays theirs. A bar says who is using the computer, with Pause and Stop.
- `#paused`: paused from the bar, from the window in the chat, or with Esc.

**Being allowed.**

- `#allow`: two switches for each computer, in the Do Computer app on that computer: the screen
  (off to begin with) and a browser (on). Beside it, what a chat says while the screen is off.

**On a phone.**

- `#phone`: the same window as wide as the chat, the steps unfolding under it, and how it ends.
