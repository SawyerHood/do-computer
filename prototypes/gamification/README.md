# Treats, boxes and a wardrobe: a mock-up

What a little gamification of the agent's creature could look like in Do Computer: giving it
treats, opening the boxes it finds, and dressing it in what was inside. It is not part of the app
and nothing here is imported by it. Everything in it is pretend.

The owner approved the second pass, and it was built the same day (HANDOFF.md, section 5, item
24). Where the app differs: a creature starts with one box and nothing to wear, where the mock-up
starts it with ten things; the box is opened in three.js on the creature's own stage, which the
owner asked for after seeing the flat one here; the wardrobe shows only what has been found, with
no switch to see the rest; and what was `src/wear.js` here is `packages/mascot/src/wardrobe.js`.

```sh
node prototypes/gamification/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The icons, the pretend people and agents and
most of the styles are read from `prototypes/agent-pages/src` and
`prototypes/main-and-side-chats/src` when it is built. The two lines along the bottom switch
between the scenes and say what each one shows; they are not part of the design. Each scene also
has an address: `#panel`, `#earn`, `#box`, `#wardrobe`, `#phone` and `#bodies`.

This is the second pass. The owner's notes on the first: treats and not food (the creature never
needs one); a box of one random thing to wear, with rarities, once it is happy enough; a hundred
things in all; less room taken in the panel and no bond level; a page of its own on a phone; and
hats must not sit inside heads.

**The loop.**

- `#earn`: the agent earns a treat each time it finishes a task. It lands on the pile beside the
  creature; nothing is added to the chat.
- `#panel`: the panel has two small things beside the creature and nothing else new. Its treats are
  at its left, its next box at its right, filling as it is given treats, and a wardrobe button sits
  by its name. Drag a treat onto it, or press the pile.
- `#box`: a full box is opened by pressing it. Inside is one thing the creature does not have yet,
  picked at random. Sixty boxes in a hundred hold something common, 25 uncommon, 10 rare, 4 epic
  and 1 legendary.
- `#wardrobe`: the hundred things: 41 for the head, 20 for the eyes, 20 for the face and 19 for the
  neck, one worn in each place. Every tile is the creature itself wearing the thing. The switch
  shows the wardrobe as its owner would see it, with what is not found yet as a question mark.
- `#phone`: there is no panel on a phone. The chat is unchanged, and the creature has a page of its
  own, opened from its picture, with the treats, the box and the wardrobe.

**Fitting (`src/wear.js`).** Every creature is grown from a seed, so nothing is placed by a fixed
number:

- a stiff hat is open underneath and is lowered along its own axis until the first point of the
  head touches its underside;
- ears in a small hat's way flop out sideways from under it; under a wide brim or a cap they lie
  flat, as a horn, a tuft or an antenna does;
- a soft thing (a beanie, a scarf, a beard) is made out of the skin itself, lifted a little, with a
  hole where a tail or an ear comes through;
- a last pass moves anything that still has a corner in the body straight out of it.

`#bodies` shows twelve creatures from random seeds, and its last button fits all 41 hats to 200
more and counts any with a part inside the head. `Wear.audit(orb)` is that measure. It is taken
against the body at rest: the skin ripples as the creature moves, and a hat stands off by a small
allowance for that.

Built for real, wearing things belongs in `packages/mascot` (this reads the orb's own uniforms and
wraps its `update`), and eating needs a call of its own there (here it borrows the speaking mouth).
