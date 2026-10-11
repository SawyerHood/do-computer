# Polish: the app before and after a restyle

Type, shadows and layout borrowed from T3 Code, tried on every page of the app. The restyle
itself is in the app's own code (`apps/web/src`); what is here takes the pictures that show it.
Nothing here is imported by the app.

`tour.mjs` opens every page of a running server and takes a picture of it: the chat, an empty
chat, a side chat, a document beside a chat, the library, automations, each section of the
agent's settings and the workspace's, the menus, the wardrobe, sign-in and the first run, and
some of them again in the dark theme and at a phone's width. Run against a build of the app as
it was and a build as it is, the two sets can be put side by side.

```sh
cd apps/web && pnpm build:node
PORT=3391 DC_SIGNUP=open DC_DATA_DIR=$(mktemp -d) DC_BASE_URL=http://127.0.0.1:3391 \
  OPENROUTER_API_KEY= node server.node.mjs &
node ../../prototypes/polish/setup.mjs            # an account, agents, chats, files, automations
node ../../prototypes/polish/tour.mjs proposed    # pictures in prototypes/polish/shots/proposed
```

For the other set, build the app from the commit before the restyle, start it on the same data
directory and run `node tour.mjs today`. A third word takes only the pictures whose names start
with it (`node tour.mjs proposed library`). Set `PLAYWRIGHT_CHROMIUM_PATH` to use a Chromium that
is already installed. The pictures are not kept in the repository.

The server answers with its echo model, so `tour.mjs` puts a conversation of its own in the
place of what was said, the same one in both sets.

## What the restyle changes

- **Type.** Geist in place of Inter (the landing page and the guides keep Inter). What the agent
  says is the page's own text, with no bubble, at 16px. A person's own messages are a pale tint
  of the agent's color. Labels are in sentence case. The chat's column is 720px wide.
- **Shadows.** Three levels, each a hairline with a shadow under it: `shadow-raised` (what is
  chosen in a list, a card), `shadow-card` (the page) and `shadow-float` (the message box, menus,
  windows). In the dark theme each level is a step lighter. They are set in `styles.css`.
- **Layout.** The sidebar sits on a tinted frame (`bg-frame`) and the page is a rounded sheet on
  it. The strip has no line under it and its tabs are one control. The agent's panel, a side
  chat and a document beside a chat are cards in the sheet. Sign-in, pairing and an invitation
  are a card on the frame.
- **Fields and cards.** Fields are white with a hairline where they were grey fills. Cards are
  white and raised where they were grey with a border.
