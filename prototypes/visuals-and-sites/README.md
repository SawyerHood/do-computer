# Visuals and shared sites: a mock-up

What two new things an agent could do might look like in Do Computer: answer with a small page of
its own drawn in the chat, and share a page or a folder of pages from the library as a website
with a link. It is drawn before any of it was built. It is not part of the app and nothing here
is imported by it. Everything in it is pretend.

It was built the same day, before the owner had answered it (HANDOFF.md, section 5, item 50).
Where the app differs: the files in the library's tree carry no lock or globe; a document open
beside a chat has no line along its bottom saying who shared it; in a workspace of one person
the pill reads "Only you"; and the approval request has the app's usual buttons. Since then
anything in the library can be shared, not only a page, and the words are "Shared with a link".

```sh
node prototypes/visuals-and-sites/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The icons, the pretend people and agents and
most of the styles are read from `prototypes/agent-pages/src` and
`prototypes/main-and-side-chats/src` when it is built. The two lines along the bottom switch
between the scenes and say what each one shows; they are not part of the design. Each scene also
has an address: `#visual`, `#beside`, `#shared`, `#share`, `#ask`, `#site`, `#private`,
`#library` and `#phone`. Who can open a site is kept from scene to scene, so a choice made in one
shows in the others; `#shared` and `#ask` put the launch plan back to Tidewater only.

**A visual in the chat.**

- `#visual`: Pip answers a question with a chart. It is drawn straight on the chat's background,
  with no card around it, as wide as the reply and in the app's colors, above what Pip wrote. Two
  buttons at its top right show when the pointer is over it (here they are always faintly there):
  open it beside the chat, and share it.
- `#beside`: the same visual open where Pip's panel is, as the file it is:
  `visuals/signups-q3.html`, shown as the page or as its source, with Share and a close button.
  The sidebar is folded away to leave it room.

**A shared site.**

- `#shared`: Pip put the launch plan on a page and shared it. The card in its reply has the
  site's name, its address (`do.computer/s/k3x9v2qd7m`), who can open it, Copy link, Open and a
  menu.
- `#share`: the menu open. The link, then who can open it: people in Tidewater, or anyone with
  the link. Both choices work, and so does Stop sharing.
- `#ask`: asked to make it public, Pip has to ask first. The request is the app's usual approval
  request above the message box. Allow makes the site public and Pip answers with the link.

**The site itself.**

- `#site`: the address in a browser tab, for someone in Tidewater. The agent's page fills the
  window and nothing of Do Computer is around it.
- `#private`: the same address for someone outside the workspace while it is shared with
  Tidewater only: a quiet message and a way to sign in, and nothing of the page. Once the site is
  public this scene shows the page.

**Elsewhere.**

- `#library`: the library's front page, with a section listing what is shared as a website: the
  file or folder it serves, who shared it, who can open it, a button to copy the link and the
  same menu. Shared files and folders carry a small lock or globe in the file tree.
- `#phone`: the chat on a phone. The visual is drawn again for the narrow column, with its
  buttons always there, and the site's card puts its actions on a line of their own.
