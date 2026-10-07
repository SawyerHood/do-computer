# Loading states: a mock-up

What switching agents, changing tab, opening settings and reloading could look like if nothing
waited on the network before moving. It is not part of the app and nothing here is imported by it.
Everything in it is pretend, the network included.

```sh
node prototypes/loading-states/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The bar along the bottom is not part of the
design. It switches between **Today** and **Proposed**, sets how long each trip to the server
takes, and says after every click how long it was until something moved and until everything was
there. Click the agents, the tabs and the settings button as in the app.

- **Today** plays what the app does now, in the order it was measured to do it: a click on an
  agent asks who is signed in, then for the agent, then is sent on to its main chat, then asks who
  is signed in again, and only then does the frame change, to a chat that is empty until its
  stream answers. A tab's mark and the sidebar move before the page under them. A reload is a
  blank page until all of that is back.
- **Proposed** moves the frame on the click, from what the list of agents already knows (name,
  creature, color). What has not arrived has a placeholder in its own shape, shown only after a
  tenth of a second so that a fast answer never flashes one. What was seen before is shown as it
  was. "Fetch on hover" starts fetching when the pointer reaches a row or a tab. "Hold the
  placeholders" keeps them up to be looked at.

An address can set the scene: `#old` or `#new`, then any of `hold`, `light`, `l=400`, and a place:
`agent=scout`, `tab=library`, `tab=automations`, `settings=usage` or `reload`. For example
`#new,hold,agent=scout`.

The owner asked for it to be built, and it was the same day (HANDOFF.md, section 5, item 20).
