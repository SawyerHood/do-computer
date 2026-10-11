# The landing page, the professional look: a mock-up

The owner, after the landing page's lower half was redrawn with pictures of the product
(2026-10-11): "can you also prototype a more professional version of this site in the style of the
references i linked", the references being x.ai/bot and chatgpt.com/features/dots. This is that:
the whole page again, light, in plain type, with no pixel face and no console. It is not part of
the app, nothing here is imported by it, and nothing in it signs anyone in. Nothing has been
chosen yet.

```sh
node prototypes/landing-pro/build.mjs     # writes index.html here; open it from the file system
```

`index.html` is not kept in git: with the pictures of the app in it, it is close to a megabyte.
It needs the network once, for three.js and its fonts. The creature and what it wears are the
app's own, read from `packages/mascot/src` when it is built, and the pictures of the app are the
light ones in `../landing/shots`. The line along the bottom switches between the two states,
`#open` and `#soon`, and is not part of the design.

**What is taken from the references.** A page the color of paper with near-black type and pill
buttons, the one that matters in black. The product shown in small pictures of itself rather than
described: white cards of the app on rounded panels of strong color, beside a short heading and
two lines (Dots). A grid of two with the words over the picture, a list of jobs as chips beside a
phone, and questions at the end (Grok Bot). The mascot rare.

**The page, top to bottom.**

- The top: "Your open source personal assistant." and the way in on the left; on the right a
  panel with one creature large, which is each of eight in turn (the planner, the builder and so
  on, the last an egg), what it was asked and what it is doing about it, and under it the eight
  in two rows of four. Choosing one, or a mouse over one, stops the turning. The panel takes a
  tint of whoever is on it. Then the app in a window whose tabs change the picture.
  (Drawn three times. First one fixed creature at the top, with the jobs as chips beside a phone
  further down. The owner: "i still like that rotating choose your character selection if you can
  switch between the personas but it doesn't need to be a character select screen". Then the
  eight as chips of words under the creature: "don't like the pill treatment liked the grid of
  guys more".)
- "It does the work, not just the talking.": three things beside a picture each (its own
  computer, a phone's lock screen, a schedule), then two side by side (memory, a team).
- "Right where you need it": web, desktop, phone, Slack.
- Open source, with the three lines that run it, and three plain cards.
- Hats, said once. "Try one on" only changes the hat: the box opening is the app's.
- Questions, and "Get yours".

Under the top, with its one large creature and eight small, there is one more: under a hat.

**Mine, not the owner's:** every line of copy, which features get a large picture, the
tint of the panel, keeping the pixel creature on a page this plain, and
"Download for Mac" beside "Get started".
