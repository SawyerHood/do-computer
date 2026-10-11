# A Dood hatched inside a post on X: a mock-up

What it could look like if anyone could hatch a Dood inside a post on X, share it as a post of
their own, and claim it by signing up. Drawn before any of it is built. It is not part of the app
and nothing here is imported by it. The post, the composer, the phone and the browser window are
pretend; the egg, the creature, what it wears, its box and the sky in the card are the app's own
(`packages/mascot`).

```sh
node prototypes/dood-embed/build.mjs     # writes index.html here; open it from the file system
```

It needs the network once, for three.js and its font. The two lines along the bottom switch
between the scenes and say what each one shows; they are not part of the design. Each scene has an
address: `#hatch`, `#share`, `#shared`, `#claim`, `#presents`, `#phone` and `#off`. The buttons in the card
work, so it can be clicked through from the egg to the claim, and the Dood made in the first scene
is the one the later scenes show.

**How a page gets into a post.** It is X's player card, which is what Tweetcraft
(`tweetcraft.jai.vin`) uses. The address that is posted answers with `twitter:card` set to
`player`, a `twitter:player` address, a width and height of 480 each, and a `twitter:image`. X
shows the image with a play button, and when it is played puts the player address in a frame in
the post. The page must let X frame it (`frame-ancestors` naming x.com and twitter.com). The phone
apps open the page in their own browser instead. X stopped playing these cards for some hours on
8 October 2026 and started again the same day, so the last scene shows what the same link is
without it: an ordinary picture card that opens the page.

**The scenes.**

- `#hatch`: our own post. An egg comes down, two taps crack it, it is named and given a colour,
  and it hatches. "Hatch another" gives a different Dood with the same name and colour, as often
  as wanted. Then it has a present: the app's box, with three things in it, each shown on the
  Dood, and one to keep. Nobody signs in.
- `#share`: X's composer, opened from the card with the words and the Dood's link filled in.
- `#shared`: that post as others see it, of a Dood that has been claimed. It wears what it was
  given, can be stroked and fed, and every fourth treat is a present for its owner. One treat a
  day from each person. "Hatch your own" starts the first scene in the same card.
- `#claim`: do.computer in a new tab, with the Dood already out. It is the first run without the
  fall and the name. Signing in makes it the account's first agent.
- `#presents`: the owner, in the app. The presents the post's treats filled are opened with the
  box the app already has, one thing each by its rarities, and worn in the post as well.
- `#phone`: the X app, where a tap on the picture opens the page over the post.
- `#off`: the picture card that is left if X turns playing off.
