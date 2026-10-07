# Main and side chats: a mock-up

What the sidebar could be if choosing an agent meant talking to it. It is not part of the app and
nothing here is imported by it. Everything in it is pretend.

```sh
node prototypes/main-and-side-chats/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The icons, the pretend people and agents and
most of the styles are read from `prototypes/agent-pages/src` when it is built. The two lines along
the bottom switch between the scenes and say what each one shows; they are not part of the design.
Each scene also has an address: `#today`, `#a`, `#a-menu`, `#a-side`, `#a-full`, `#b`, `#b-side`,
`#c`, `#c-side` and `#mobile`.

The idea common to A, B and C: an agent has one **main chat**, a conversation that carries on from
day to day, and choosing the agent opens it. Anything else is a **side chat**: its own
conversation with the same agent and the same memory. The three differ in where an agent's side
chats are listed.

- **A, agents only** (the one recommended). The sidebar lists agents and nothing else, each with a
  line about the latest from it. Side chats are behind one button on the agent's strip, and one
  opens beside the main chat, in the place the agent's panel has. It can be given the whole middle.
- **B, under the open agent.** The sidebar still lists side chats, but only for the agent that is
  open, with no arrows to fold. The agent's own row is its main chat.
- **C, in the agent's panel.** The sidebar as in A; side chats are a section under the creature.

The owner chose A, and it was built in the web app the same day (HANDOFF.md, section 5, item 17).

`#today` is the sidebar as it was, for comparison. `#mobile` is A as four stills of a phone.
