# The pictures in the guides

`shoot.mjs` takes the five pictures that [`docs/apps.md`](../../docs/apps.md) shows, from the
built app, and puts them in `docs/images`. Run it again when the app's look has changed. Nothing
here is imported by the app.

```sh
cd apps/web && pnpm build:node
OPENROUTER_API_KEY=sk-or-... node ../../prototypes/guide-pictures/shoot.mjs
```

A folder given after the script's name gets the pictures in place of `docs/images`. Set
`PLAYWRIGHT_CHROMIUM_PATH` to use a Chromium that is already installed. It uses ports 3251 to 3253.

It needs a model key because two of the pictures are of an agent in a chat: one adding Apps
when asked to, one asking before it sends an email. What the agent says is its own, so it reads a
little differently each time. Each run also makes new agents, whose creatures are drawn at random,
so the two may not look alike. Look at the pictures before keeping them.

It starts the app twice:

- **As it is**, where Apps is Composio's own server. This gives the card that offers Apps, the
  agent adding it, and Composio's sign-in page, which is as far as anyone gets without an account
  there.
- **With a stand-in for Composio** (`standin.mjs`, through `DC_APPS_URL`), which can be signed
  in to with one press. This gives the card once it is connected and the agent asking before it
  acts. The stand-in offers the tools Composio's reference names (`COMPOSIO_SEARCH_TOOLS`,
  `COMPOSIO_MULTI_EXECUTE_TOOL` and the others) and answers with a Gmail tool and made-up
  results. No email is sent, because the picture is taken while the agent waits for an answer.
