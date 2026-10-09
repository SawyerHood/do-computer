# Background commands: a mock-up

What a command left running in the background could look like in Do Computer, drawn before any of
it was built. It is not part of the app and nothing here is imported by it. Everything in it is
pretend. The plan it draws is `PLAN-background-commands.md`, section 5.

The owner approved it as drawn, and it was built the next day (HANDOFF.md, section 5, item 26).
Where the app differs: the sidebar says what an agent is waiting on only for the agent on screen,
and a side chat has the commands in it and no count above its message box.

```sh
node prototypes/background-commands/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The icons, the pretend people and agents and
most of the styles are read from `prototypes/agent-pages/src` and
`prototypes/main-and-side-chats/src` when it is built. The two lines along the bottom switch
between the scenes and say what each one shows; they are not part of the design. Each scene also
has an address: `#running`, `#list`, `#output`, `#finished`, `#failed`, `#slow`, `#moved` and
`#phone`. The clocks go, a running command prints a line every few seconds, and Stop works.

The app has no rows for tool calls, so the plan's "row for the call" is drawn with what the app
does have: a command is shown as a sub-agent is.

**While it runs.**

- `#running`: Pip started a build in the background and ended its turn. The command is in the chat
  where Pip started it, in Pip's panel under "Running in the background", and counted above the
  message box. Pip reads as waiting, in the panel and in the sidebar.
- `#list`: the count above the message box opened, with two commands running. Each has its
  command, its computer, how long, the last line it printed, and Stop. The panel has the same rows.
- `#output`: one command opened. It unfolds where it is in the chat and shows the end of what it
  has printed, added to while it runs.

**When it ends.**

- `#finished`: word that it finished comes into the chat as word from a sub-agent does, with the
  end of the output folded away, and Pip answers it.
- `#failed`: the same for one that failed, opened to show what went wrong.

**A command that takes too long.**

- `#slow`: a command Pip is waiting on, as it is today: one line says what Pip is doing.
- `#moved`: the same command after a minute, moved to the background by itself.

**On a phone.**

- `#phone`: the chat only. No panel and no list; a command is opened, and stopped, in the chat.
