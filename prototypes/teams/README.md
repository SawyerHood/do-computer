# Teams: a mock-up

A click-through of what shared workspaces could look like: a personal workspace and team ones,
agents that belong to a team, chats several people take part in, and who is where right now.
It is not part of the app and nothing here is imported by it. Everything in it is pretend,
including the people.

```sh
node prototypes/teams/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The strip along the bottom switches between
the scenes and is not part of the design; each scene also has an address: `#chat`, `#subs`, `#switch`,
`#home`, `#members`, `#invite`, `#new` and `#join`.

`#chat` plays a short scripted conversation: a teammate types, the agent answers them, a second
teammate arrives from another chat and their message waits its turn. Typing in the box works too.

The side column lists the team's agents, each with its chats folded under it, one line a chat.
That column is how an agent is picked, so the rail has no agent switcher.

`#subs` is a still of the same chat with sub-agents in it, as drawn in `prototypes/subagents`:
they are in the chat and in the agent's panel, and a teammate can be watching one. The side column
does not list them. The end of a chat's row is a spinner while there is work going on in it, with
how many sub-agents, and otherwise when it was last used; never both.
