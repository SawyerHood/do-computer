# What a Dood can do

- **Chat.** Choosing a Dood opens its main chat, one conversation that carries on. Anything
  else goes in a side chat, from the button on the Dood's strip: its own conversation, which
  picks up from the main chat, open beside it on a wide screen. A reply keeps being written when
  you close the tab, and is there when you come back. Every chat, a Slack thread included, is
  told where the Dood's other chats stand and what was finished in them, and it can search and
  read what was said there.
- **Be someone.** It names itself in its first conversation, picks its color, and keeps a
  personality, a profile of you and its own notes. They are capped, visible and editable in
  its settings. They are kept with the Dood and on no computer.
- **Look at pictures.** A picture attached or pasted into the message box is shown to the Dood
  along with your words, if its model takes pictures; the box says so when it does not. The
  browser scales a copy down for that, and the original goes to the library as a file.
- **Keep going.** A Dood's turn ends when it replies without using a tool, and some models
  send a progress update that way in the middle of a task, which would end the work there. So
  the Dood has a `progress` tool to say such things with: you read them in the chat as its
  words, and it carries on. When a run still ends on what could be such an update, a small
  model is asked whether the Dood meant to go on. If so, it is set going again, a few times in
  a row at most. A question to you is never treated that way.
- **Show its work, briefly.** Beside a chat, on a wide screen, each thing you asked for is one
  entry: a short title and a sentence on what came of it, with the commands, files and searches
  behind it inside for whoever wants them. A small model writes these in the background when a
  run ends and every few steps while one is going, so the Dood spends no attention on it.
  Without a model key they are worked out from the run itself.
- **Be a creature.** You see your Dood as a small creature that hatches from an egg when you
  first meet it. Its shape and face are grown from a roll of the dice, so no two Doods look
  alike, and it acts out what the Dood is doing: listening while you type, thinking, working
  at a command or a file or a search, speaking as its answer arrives, and dozing when nothing
  has happened for a while. `pnpm --filter @do-computer/mascot demo` builds a page for
  trying every state and look.
- **Be looked after, a little.** A box turns up beside the creature and waits until it is
  opened; the next turns up six hours after that, so there is one waiting at most. Inside is
  one of two hundred things to wear, from common to legendary, which it then wears wherever it
  is shown. It can be given a treat as often as you like, only because it likes them. None of
  it changes what the Dood can do.
- **Think with the model you choose.** Each Dood can be set to any OpenRouter model that can
  call tools (about 400), from a searchable list on its page, and Settings holds the default your
  new Doods start on.
- **Use a computer**: read, write and edit files and run shell commands on a machine of its
  workspace, in a folder of its own that persists. A Dood has no computer to itself: a
  workspace has machines, and its Doods share them. The default is
  [just-bash](https://github.com/vercel-labs/just-bash), a shell interpreter with a durable
  virtual filesystem that needs no machine; it has the usual text tools and `curl` for the
  internet, but no real programs, and on Node it is the one kind that each Dood has to itself. For a
  real Linux machine, see [Computers](computers.md); where a deployment offers one, a Dood also
  starts with a skill for driving a headless browser.
- **Run schedules.** Ask for something later or regularly. Each run happens in its own chat and
  reports back to the chat you asked in; see and pause them under Automations. A task that mostly
  finds nothing to do ("tell me when the build breaks") can have a check: a shell command that
  runs first each time, with no model. The Dood is started only when the check prints
  something, or when what it prints changes, so looking often costs no tokens.
- **Hand work to sub-agents.** For a piece of work that stands on its own, the Dood can start
  a sub-agent: a copy of itself, with its memory, skills and computers, working in the
  background in a conversation of its own while the Dood stays free to talk. Several can work
  at once. When one finishes, its report arrives in the chat that started it and the Dood
  tells you what came of it. You can open a sub-agent's chat and read along, and stop it; only
  the Dood writes in it.
- **Write to other Doods.** A Dood can see the other Doods in its workspace and send one a
  message: for something that one knows or can do, or because you asked it to. The message
  opens a conversation of its own on the other Dood, which answers as itself, with its own
  memory, skills and computer. The answer arrives in the chat that asked, and your Dood tells
  you what came of it. You can open the conversation from either Dood and read it, and stop
  it; only the two Doods write in it. There is nothing to switch on, and nothing limits how
  long two Doods go back and forth.
- **Learn skills**: saved instructions it loads when a task calls for them, writes for itself, and
  can install from a GitHub folder or a `SKILL.md` URL.
- **Search the web**, when the deployment has a model key: one request to OpenRouter searches,
  reads the results and answers with sources. It works on any computer, including the default one
  with no network, and its cost shows up under Usage with everything else.
- **Use your services.** Under Connectors, add a remote [MCP](https://modelcontextprotocol.io)
  server by its address, with an access token or by signing in to the service. Its tools become
  the Dood's. Tokens stay on the server; the Dood never sees them. [Apps](apps.md) is one
  that needs no address: one button, a sign-in at Composio, and the Dood reaches your own
  accounts on Gmail, Google Calendar, Slack, Notion, GitHub and hundreds of other services.
- **Write you documents.** A workspace has one Library, which all its Doods share. On each of
  its machines the folder `~/library` is that library: what a Dood writes there, by hand or
  with a program, appears in the app in the same folders, and so do the files you upload and the
  edits you make, on every machine. A Markdown document is read and edited in the app. An
  HTML document is shown as the page it is, and the styles, scripts and images beside it load.
  The files are kept outside any computer, so they are there when a machine is asleep or gone,
  and a new machine gets them. Earlier contents of a file are kept as versions, and a
  deleted file can be brought back. A file the Dood sends appears in the chat, and opens beside
  it.
- **Show you things, and share them.** Where a chart, a table or a diagram says more than
  prose, the Dood draws one into the chat: a small page of its own, in the app's colors, kept in
  the Library under `visuals/`. Anything in the Library can be shared with a link of its own,
  by the Dood or from its Share button: a page is shown as the page, a folder with an
  `index.html` as the website it is, a Markdown document as a document to read, a picture as
  the picture, any other folder as a list of its files, and anything else as a download. The
  link opens for the people in the workspace, signed in, until someone chooses "Anyone with the
  link"; a Dood has to ask before making one public. A link shows the files as they are, so
  it changes when they do. Pages a Dood wrote run apart from the app and from your account.
- **Keep something in view.** Anything in the Library can be pinned to a Dood, by the Dood or
  with the pin on a file's card in the chat and on the bar of an open document. What is pinned
  stays beside the Dood's chat, under its face: the first is drawn small as what it is and
  follows the file as it changes, the rest are listed by name, and each opens beside the chat
  at a press. It is for a board or a tracker the Dood keeps up to date, or a plan the two of
  you work from. A Dood's pins are its own, and everyone who shares the Dood sees them.
- **Work on your own machines.** On a Mac or Linux box, run the command shown under Computers. It
  prints a link; confirm it, say whose the computer is, and choose which Doods get it. Those
  Doods can then run commands and read and write files there, and everything they do is logged
  in `~/.durable-computer/audit.log` on that machine. Add `--read-only` to allow reading only.
  A computer is paired once and connected to as many Doods as you like, in any of your
  workspaces: Computers lists each one with its Doods, to add and remove. A Dood that was not
  given a computer can see that it is there and ask for it. Whoever it belongs to gets a
  notification and a request in the app, and the Dood is told the answer in the chat it asked
  from.
- **Use a browser on your computer.** On a computer you paired, a Dood can run short scripts in
  a browser, with [dev-browser](https://github.com/SawyerHood/dev-browser), which the daemon
  fetches the first time. It uses your own Chrome when that is open and lets itself be used
  (tick "Allow remote debugging for this browser instance" at `chrome://inspect/#remote-debugging`,
  or start Chrome with a debugging port), and is then signed in wherever you are. Chrome asks
  you once whether to allow it, the first time a Dood uses it, and not again until Chrome or
  the daemon is started again. Otherwise it
  keeps a browser of its own, with its own sign-ins, which nobody sees but in the chat. Start
  the daemon with `--no-browser` to allow neither.
- **Use your screen.** In the [desktop app](desktop.md), under This Computer, you can let
  Doods use the computer's screen, through [Cua Driver](https://github.com/trycua/cua). They
  work in one window at a time, behind whatever you have in front: they are shown that window
  and click and type in it without your mouse or keyboard, so you can carry on with your own
  work. What cannot be done that way (a drag on a Mac, most things on Linux) a Dood does with
  the window brought forward for a moment, or on the whole screen with the mouse and keyboard.
  It is off until you switch it on there, and a Dood cannot switch it on. While one is at
  work a bar says who it is and has Pause and Stop, and its pointer is drawn in its colour,
  with its name, where what it is clicking can be seen; while it has the whole screen there is
  a glow round it and Esc pauses too. A daemon run by hand has no screen for Doods.
- **Watch either.** While a Dood uses a screen or a browser, the chat has a small window of
  it, as it is, with the Dood's pointer and what it is doing. It can be opened large, paused
  and stopped from there. Afterwards the window folds to one line, with the picture taken at
  each step behind it. Nothing is shown of a screen that no Dood is using.

You can talk instead of typing: the microphone button records, and the server transcribes with
the same OpenRouter key (`DC_TRANSCRIPTION_MODEL`, default `openai/whisper-large-v3`).
