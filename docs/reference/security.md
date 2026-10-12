# Security and trust

Agents act without asking first. That is the default on purpose, and it means a prompt injection
in something an agent reads can use whatever that agent can reach, including its connectors and a
paired computer. What limits the damage:

- **A few things ask first from the start**, because they cost money or give the agent more
  reach: adding a machine to the workspace, adding or changing a connector, changing its own
  model and settings, and making another agent. Each can be set to Allow under Permissions.
  Removing a machine asks every time, and an agent can only remove one it added. Only a
  conversation with a person can do any of these: a sub-agent or a scheduled run cannot.
- **Secrets are typed into a form, not into the chat.** When an agent needs an API key or a
  password it asks with its `request_secret` tool. A form appears above the message box, and what
  is typed is written to a dotenv file on the agent's computer (or kept as a connector's access
  token) without passing through the conversation: the agent is told which names were saved and
  nothing else. The file is on a computer the agent works on, so this keeps a secret out of
  transcripts, search and the model's context, not out of reach of a command the agent runs.

- **Permissions.** For each thing the agent can do, each connector and each of your computers,
  choose Allow, Ask first or Never. With Ask first the agent stops, a request with the exact
  command or arguments appears above the composer and as a notification, and nothing happens until
  you answer. A rule on one of your computers covers everything done there, reading included.
  A rule is about what happens, not which tool does it: "Create and change files" also governs
  commands, which can change files.
- **A workspace's machine is not yours.** The built-in shell has no real programs and reaches
  only the public internet. A remote one is a separate machine at a provider.
- **Agents on one machine are not walled off from each other.** Each has its own folder, and any
  of them can read and change the others' files and stop their programs. What an agent
  remembers is not on a machine, so another agent cannot change it there. Give an agent whose
  permissions you have limited a machine that only it can use.
- **Secrets stay on the server.** Connector tokens and sign-in grants are never in the model's
  context or on the agent's computer. With [Apps](apps.md), what you grant each service is kept
  by Composio, in your account there; the server keeps only its sign-in to that account.
- **The server will not be used to reach inside your network.** Connector addresses and skill
  installs must be https on a public host, re-checked on every redirect. The built-in computer
  runs inside the server, so what an agent fetches with `curl` there goes through the same check:
  the public internet only, by http or https. On Node every host name is also looked up, so a
  public name pointing at a private address is refused too; a Worker cannot reach private
  networks to begin with. `DC_ALLOW_PRIVATE_HOSTS=1` lifts all of this for a deployment that
  wants services on its own network.
- **A team's agent is reachable by its members and nobody else.** Who is in a team is checked
  on every request, from the session and the database, never from what the client says.
- **Agents write only to the agents beside them.** An agent reaches the other agents of its
  workspace, your own or a team's, and no others. That is looked up on the server each time a
  message or an answer is handed over, and a browser cannot send one in an agent's name. A
  message from another agent is marked as that agent's and not yours, and the agent that gets it
  is held to its own permissions. It does mean that what one agent was talked into by something
  it read can be passed on to another.
- **Slack is a wider room.** What Slack sends is taken in only when it is signed with the Slack
  app's secret, and recently. The bot's token and that secret are kept on the server and never
  sent back to a browser. Anyone in the Slack workspace can then speak to the agent, and it
  works for them as it does for its own people: its memory, its chats, its machines, its
  connectors and the computers you paired. Nothing is held back for someone because they have
  no account here; only the agent's Permissions limit it. So an agent that knows or can reach
  things not everyone in your Slack should have is not one to put there.
- **Asking for a computer changes nothing by itself.** An agent can see which computers the
  people it works for have paired, by name, owner and whether they are online, and nothing else
  about them. It gets one only when someone the computer belongs to says yes.
- **Revocation.** Removing a computer cuts its daemon off at once, and disconnecting an agent
  from one ends that agent's access to it: which agents may use a computer is looked up on the
  server before every use, not left to what the agent remembers. Removing a connector deletes its
  credentials. Deleting an agent deletes everything it stored, and offers to delete a machine
  that only it could use. Its files in the library are the workspace's, and stay.
