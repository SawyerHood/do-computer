# Agent pages: a mock-up

Where an agent's own pages go once the sidebar lists every agent (see `prototypes/teams`).
It is not part of the app and nothing here is imported by it. Everything in it is pretend.

```sh
node prototypes/agent-pages/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The strip along the bottom switches between
the scenes and is not part of the design; each scene also has an address: `#chat`, `#collapsed`,
`#switcher`, `#library`, `#automations`, `#settings`, `#rowmenu`, `#account`, `#wsettings`, `#members`,
`#wcomputers`, `#mobile` and `#before`.

There is one sidebar and no rail. The workspace is one line at the top of it: the switcher and
who is online. Under that line are the agents, each with its chats. Your name at the foot opens a
menu (`#account`) with the workspace's settings, the theme and logging out. Members and computers
are sections of those settings, and there is no home page.

What belongs to one agent is in a strip above its chat: its name, then Chat, Library and
Automations as tabs, and a Settings button. Settings is a window over whichever tab is showing; it
gathers identity, memory, model and computer, skills, connectors, permissions and usage behind a
list of sections. The workspace's settings are the same kind of window, with a different icon.

The sidebar folds away from the button at its top and comes back from the button at the start of
the agent's strip (`#collapsed`). While it is hidden the strip also says which chat this is, and
the agent's name opens a menu of the other agents and this one's recent chats (`#switcher`).

Changing tab moves nothing: the sidebar, the strip, the agent's column on the right and all the
widths stay put. On the Library tab the sidebar's list is that agent's files in place of the
agents and their chats, with an arrow back; the workspace above it and your name below it stay.
Under the agent on the right is what suits the tab: what it did in the chat, what is coming up,
or what changed lately in the library.

`#mobile` is four stills of a phone: the agent's strip across the top, the drawer that stands in
for the sidebar, and settings as a full-screen sheet. `#before` is the rail as it is today, for
comparison. `src/head.js` and most of `src/style.css` are copied from the teams mock-up.
