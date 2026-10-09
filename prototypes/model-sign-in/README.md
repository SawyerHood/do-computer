# Signing in to model providers: a mock-up

What signing a workspace in to a model provider could look like in Do Computer: a Claude or
ChatGPT subscription, or a key for any provider pi knows. It is not part of the app and nothing
here is imported by it. Everything in it is pretend.

It was drawn first, over a server side that already existed, and the screens were built from
it the same day (HANDOFF.md, section 5, item 28, which also says where the app differs). The
owner had been shown it and had not yet said it was right.

```sh
node prototypes/model-sign-in/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The icons, the pretend people and agents and
most of the styles are read from `prototypes/agent-pages/src`, `prototypes/main-and-side-chats/src`
and `prototypes/slack/src` when it is built. The two lines along the bottom switch between the
scenes and say what each one shows; they are not part of the design. Each scene also has an
address: `#models`, `#claude`, `#codex`, `#codex-page`, `#key`, `#signed-in`, `#picker` and
`#lapsed`. The buttons work: signing in, signing out, and changing how.

**Where it is.**

- `#models`: a Models section in the workspace's settings, between Computers and New agents. The
  deployment's own models first, then the providers there are, the ones most asked for at the top
  and the rest behind "23 more". A provider with a subscription has a button named for it; any
  provider that takes a key has "Use a key".

**Signing in.** Each is the provider's own way, as pi does it in a terminal, drawn for a page.

- `#claude`: a Claude Pro or Max subscription. Claude's page opens in a new tab and ends by
  showing a code, which is pasted here.
- `#codex`: a ChatGPT subscription, by a code. OpenAI's page takes a short code shown here, and
  the window closes by itself once it has it.
- `#codex-page`: the same subscription, by a page. OpenAI's page ends at an address on the
  person's own machine that does not load, so the address is pasted here.
- `#key`: a key, for any provider. One field, typed in secret.

**Afterwards.**

- `#signed-in`: who signed in, with what, and how many models it gives. Whoever signed in, or an
  admin of the team, can sign out.
- `#picker`: an agent's model picker says where each model comes from. The same model can be
  there on a subscription and paid for by the token.
- `#lapsed`: an agent set to a model of a provider the workspace is no longer signed in to says
  so in place of its reply, with the two ways out.

**Not decided, and drawn one way to have something to look at.**

- pi has two providers for a ChatGPT subscription: "OpenAI", signed in to with ChatGPT, and
  "OpenAI Codex", which pi marks as the older way. Both are drawn, as pi has both.
- A model on a subscription shows "on the subscription" where one paid by the token shows its
  price.
- The line about Claude's billing ("it may count as extra usage") is worded without having been
  checked against what Anthropic says today.
