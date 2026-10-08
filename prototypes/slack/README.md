# Slack: a mock-up

What an agent in Slack could look like in Do Computer, drawn before any of it was built. It is not
part of the app and nothing here is imported by it. Everything in it is pretend.

The owner approved it as drawn, and it was built the same day (HANDOFF.md, section 5, item 22).
Where the app differs: the line beside a message from someone outside reads "not in this
workspace", and the request for an OK has the app's usual buttons without "Always allow".

```sh
node prototypes/slack/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The icons, the pretend people and agents and
most of the styles are read from `prototypes/agent-pages/src` and
`prototypes/main-and-side-chats/src` when it is built. The two lines along the bottom switch
between the scenes and say what each one shows; they are not part of the design. Each scene also
has an address: `#setup`, `#in-slack`, `#slack`, `#panel`, `#thread`, `#guest`, `#connector` and
`#ask`.

There are two separate things in it, which share one Slack app.

**The agent as a bot in Slack.**

- `#setup` and `#in-slack`: a Slack section in the agent's settings. Three steps to add it, then
  what it is once it is there. One Slack app for each agent, so the bot has the agent's name.
- `#slack`: the other end, in Slack, drawn plainly. Mention the bot and it answers in the thread.
- `#panel`: each Slack thread is a conversation of the agent's, listed in its panel under "From
  Slack", as conversations from other agents are. Not in the sidebar.
- `#thread`: a thread opened. It is read here and written in from Slack, so it has no message box.
- `#guest`: someone who is in the Slack workspace and not in this one. The agent answers them, and
  using a connector or one of the team's own computers for them waits for an OK in the app.

**Slack as a connector.**

- `#connector`: Slack's own MCP server among the agent's connectors, signed in to as a person.
- `#ask`: the agent searching Slack and posting from an ordinary chat, as whoever signed in.
