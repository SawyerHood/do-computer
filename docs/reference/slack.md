# Slack

An agent can be put in Slack as a bot under its own name, from **Slack** in its settings. Each
agent is a Slack app of its own, which you make: the settings open Slack's page for that already
filled in, and you paste back the bot token and signing secret Slack gives the app. Nothing is
set on the deployment, which only needs an address Slack can reach. The same settings give you
the agent's picture as a file, to set as the app's icon in Slack.

- **Speaking to it.** Mention the bot in a channel it has been added to, or write to it directly.
  It answers in the thread. Mention it again there and it carries on the same conversation,
  having been given what others said in between.
- **Files.** A file attached to a message for the bot is kept in the library, as one attached
  in the app is, and a picture is shown to a model that can look at one. A file the agent
  sends in the thread's chat is posted to the thread, before the words that are about it.
- **In the app.** Each Slack thread is a conversation of the agent's, listed in its panel under
  "From Slack". It is read there and written in from Slack. Someone whose address in Slack is
  an account's here has their face on their messages.
- **Everyone in the Slack workspace.** Anyone there can speak to the bot, and it works for them
  as it does for you in the app, with everything it knows and can do. The agent's Permissions
  hold there as they do anywhere.
- **On its own.** From any chat or automation the agent can go to Slack unasked: see which
  channels it has been added to, read one, and write in one or to a person, with a file from
  the library if it has one. It does this as the bot, so it reads and writes only where the bot
  has been added (`/invite @name` in a channel). "Write in Slack unasked" is one of its
  Permissions.

The bot is all an agent is in Slack: it does nothing there as a person. A connector to another
service can still be given a client ID and secret, for a service whose sign-in lets no app
register itself.
