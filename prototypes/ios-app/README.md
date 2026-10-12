# The iOS app: a mock-up

What the native app in `apps/mobile` could be if it did everything the web app does on a phone
and felt like an iOS app. It is not part of the app and nothing here is imported by it.
Everything in it is pretend.

```sh
node prototypes/ios-app/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for the Inter typeface, which stands in for the system's own where
that is not San Francisco. The row along the top switches between the sections, and each has an
address: `#today`, `#agents`, `#chat`, `#inchat`, `#agent`, `#wardrobe`, `#library`,
`#automations`, `#settings`, `#start` and `#outside`. "Dark" draws the phones in the dark theme.

- **The gap** (`#today`) is the comparison the rest answers: what the web app does at a phone's
  width that the native app does not, row by row, with four pictures of the native app as it is.
- **Agents, Chat, In a chat** are the list of agents under their workspaces and a conversation
  with everything the web draws in one.
- **The agent** is a page of the agent's own, opened from its name: what the web splits between
  the agent's panel, which only a wide screen shows, and the agent's settings.
- **Wardrobe, Library, Automations, Settings, Getting in** follow the web's pages.
- **Outside the app** is two things the web cannot do, which nobody asked for.

The bars are drawn the way iOS 26 draws them: no bar of their own, glass buttons over the page.
`#agents` also has the other way to lay the app out, with a tab bar, for comparison.

## How it is made

`src/kit.mjs` has the icons, the phone, lists and bars; `src/screens-a.mjs` and
`src/screens-b.mjs` are the screens; `src/today.mjs` is the comparison. `build.mjs` runs them
once and writes plain HTML, so the page has no script beyond its tabs.

The creatures are stills drawn by the app's own code. `node creatures.mjs` draws the ones named
in `src/creatures-specs.json` into `src/creatures.json`; run it again when the specs change.

The pictures of the app as it is come from `shoot.mjs`, which photographs every page of the web
app and of the native app's web build at 390 by 844. It needs what `prototypes/polish/README.md`
sets up (a built server and `setup.mjs`) and `pnpm --filter @do-computer/mobile
export:web:test`. The build reads five of them as JPEGs from `shots/`, which is not kept in the
repository; without them the page is built with those pictures missing.

`pack.mjs` wraps the built page so it can be shown in a T3 Code thread, whose `html_render`
takes at most 512,000 characters but carries any local picture the page names.
