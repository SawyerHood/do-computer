# Docs, and a guide an agent can follow: a mock-up

The owner (2026-10-11): "I would love to add a docs page on the website that has guides for going
over things. The first thing I want to go over is how to self host. You should also be able to
give the guide to an agent via a link to set it up." This is what that could look like. It is not
part of the app, nothing here is imported by it, and nothing in it is live.

```sh
pnpm install                        # once: the build uses the app's Markdown renderer
node prototypes/docs/build.mjs      # writes index.html here; open it from the file system
```

`index.html` is not kept in git. It needs the network once, for its fonts. The strip along the
bottom switches between the scenes and is not part of the design.

**The idea.** A guide is one Markdown file in the repository. The site serves it twice: as a page
for people, and as the file itself for agents, at the same address with `.md` after it. So the
guide on the page and the guide an agent follows cannot drift apart.

**The scenes.**

- `#page`, the guide at `/docs/self-hosting`. The landing page's top line with Docs in it. Guides
  on the left, with the open guide's sections under it. The guide in the middle. On the right a
  card, "Have an agent set it up", with a prompt to copy that holds the link, and the guide as
  Markdown to copy or open. Narrower, the card goes between the title and the guide; on a phone
  the list of guides folds into a line under the top. "With more guides" in the strip adds five
  that are not written, to show the list with more than one in it.
- `#agent`, what the link answers with: the Markdown file, and `/llms.txt`, which lists the
  guides.
- `#run`, an agent following the link in someone's terminal. An illustration, not a page.

**Everything in the guide is plain Markdown**, drawn by the same renderer the app uses. Three
things are drawn specially, and each is ordinary Markdown in the file: `**Needs you:**` becomes
the yellow mark on a step that waits for the person, a paragraph that starts with `Check:` gets
a tick, and a quote is a note set apart. Numbered steps get their number in a ring, and each
block of commands a button to copy it.

**It was built** the same day (HANDOFF.md, section 5, item 55): the owner wrote "I love this can
you build this for real". The guide the mock-up draws is now the app's own,
`docs/self-hosting.md`, so it shows the guide as it is today, not as it was when it was shown.
Where the app differs: the prompt gives the deployment's own address, not do.computer's, and
the top line has "Get started" where sign-up is open.

**Mine, not the owner's:** all of it past the three sentences above. In particular: no separate
list page (`/docs` opens the first guide and the list is at the side), the card for agents and
its words, one document for people and agents with a note to agents at its top, the "Needs you"
marks and the checks, `/llms.txt`, and the guide's own text and order.
