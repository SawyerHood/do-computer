# Apps

[The guide to Apps](../apps.md) is for whoever uses it: what they get, and how to connect,
with pictures. It is linked from the app, beside the button. What follows is how it works.

An agent's Connectors offer **Connect apps**. One click adds a connector called Apps, which is
[Composio](https://composio.dev)'s MCP server, and sends you to Composio to sign in with an
account of your own, which is free to make. From then on the agent reaches the accounts you
connect there: Gmail, Google Calendar, Drive, Outlook, Slack, Notion, GitHub, Linear and
hundreds more. An agent can also add Apps itself when you ask for something in one of your
accounts: it asks leave as for any change to its connectors, and a Sign in button appears
beside the chat.

The deployment needs nothing for this: no key and no setting. Composio's calls are counted
against your Composio account, not the deployment.

- **Signing in to a service.** The first time a task needs one, the agent gives you a link in
  the chat. The page is Composio's and says so.
- **It asks first.** Apps starts on Ask first: finding tools and handing you a sign-in link go
  ahead, and anything else waits for your answer, with what would be run in front of you.
  Permissions can set it to Allow.
- **Whose accounts.** Those of whoever signed in to Composio for that agent. In a team, that
  is one person's accounts for everyone who uses the agent, as with any connector someone
  signs in to. Each agent is signed in separately.
- **What Composio holds.** The grants you give each service are kept by Composio, in your
  account there, and every call an agent makes in one passes through it. You see and
  disconnect them at Composio. Removing Apps from an agent takes away the server's sign-in to
  your Composio account and leaves your accounts there as they were.
