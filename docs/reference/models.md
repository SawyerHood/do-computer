# Models

There are two places an agent's model can come from: the deployment, which offers its models to
everyone, and the agent's workspace, which can be signed in to a provider with an account of its
own.

**The deployment's models.** A deployment with `OPENROUTER_API_KEY` offers every OpenRouter model
that can call tools, and pays for them. It can also be signed in to any provider, in any of the
ways a workspace can be (below): someone named in `DC_ADMIN_EMAILS` finds **Server → Models** in
the settings, and what they sign the server in to there is offered to every workspace as the
deployment's own. Where anyone can sign up (`DC_SIGNUP=open`), an admin's
address also has to be one a Google or GitHub sign-in vouches for.

`DC_MODELS` narrows what the deployment offers to the models it names, for example

```sh
DC_MODELS=meta/muse-spark-1.3-contributor,anthropic/claude-haiku-5.5,openai/gpt-6-luna
```

Each is a model's whole id (`anthropic/claude-haiku-5-5` for Anthropic's own) or its OpenRouter
id. They are offered in that order, and new agents start on the first unless `DC_DEFAULT_MODEL`
names another of them. The deployment's key and sign-ins are then used for those models and for
no other, whatever an agent was set to before. The small models the server itself uses for web
search, notes and dictation are not chosen by anyone and are not narrowed.

**A workspace's own.** A workspace can be signed in to a model provider of its own, and its
agents can then be set to any of that provider's models, whatever `DC_MODELS` says:

- **With a subscription**, through the provider's own sign-in: Claude Pro or Max, ChatGPT (for
  OpenAI's models, and for Codex), GitHub Copilot, and a few more.
- **With a key**, for any of the providers [pi](https://github.com/earendil-works/pi) knows:
  Anthropic, OpenAI, Google, OpenRouter, Groq, Mistral, xAI and some thirty others.

A sign-in belongs to the workspace. Every agent in it can run on it, everyone in a team can set
an agent to its models, and what they use counts against whoever signed in. That holds for a
model the deployment offers too: a workspace signed in to its provider runs it on its own
account. Whoever signed in, or an admin of the team, can sign out; someone who leaves a team
takes their sign-ins along. Keys and tokens are kept on the server and are never sent to a
browser or shown to an agent.

It is under **Models** in a workspace's settings. A subscription is signed in to on the
provider's own page, which ends with a code to paste back or asks for a short code shown in the
app; nothing is installed and no address has to be registered with the provider. An agent's
model picker then lists those models under where they come from.

Someone new is asked in the first run what their agent should think with: what the
deployment includes, which is the model it starts agents on unless they change it there, or a
ChatGPT or Claude subscription or any other provider of their own, which they can sign in to
there and then.

An agent set to a model the deployment has since stopped offering goes on with the model new
agents start on. One whose workspace signed out of its model's provider says so in the chat
until it is signed in again or set to another model.

Amazon Bedrock and Google Vertex are not offered: they sign in with files and roles of the
machine the server runs on, which belong to no workspace.

## Limits worth knowing

Every call to one of the deployment's models is paid from the one deployment key and there are
no per-user limits yet, which is why sign-up is by invitation unless you open it. `DC_MODELS`
keeps what it can be spent on to the models you name. Everyone
invited to a team spends on that key too. So do agents that write to each other, and an exchange between them runs until they stop
answering or someone stops the conversation.
