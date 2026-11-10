# Web native views

`index.js` dispatches by tag. All props below are strings; booleans are `"true"` and
`"false"`. Contract owns `width`, `height`, `press=`, `message=`, `load=`, `role`, `aria-label`
and `testId`. A click or keyboard activation reaches `press=` once through Exact's host.
Every view emits `load` after its first drawing. These are presentation views, not server
clients: a `"pet"` is for the caller to send to the server if appropriate.

## do-creature

- `seed`: feature seed, default `do-computer`.
- `colour`: protocol colour id (`clay`, `moss`, `tide`, `plum`, `honey`, `slate`, `rose`, `ink`)
  or `#rrggbb`. Default clay. `color` belongs to Exact's box; do not use it.
- `state`: idle, listening, thinking, working, speaking, waiting, asking (waiting), done,
  error, asleep, egg. Unknown states fall back to idle.
- `variant`: command, file, search, memory, for working.
- `hat`, `glasses`, `face`, `neck`: wardrobe item ids; empty means remove. `outfit` accepts
  a JSON object with those keys; individual slots override it. Unknown ids are ignored by
  the real wardrobe. Do not JSON-encode each individual slot.
- `side`: CSS drawing resolution, 16–600, default the smaller measured dimension (160 before
  layout). Give Contract `width` and `height` too. Non-square boxes contain the square picture.
- `overscan`: `"true"` draws the picture 12% past the box on every side, as React's
  `AgentAvatar` does, so the creature is as large in its box as there; the box (and so the
  layout and what checks see) stays the given size. `side` is the box's.
- `dark`, `reduced`: override the browser's preferences; omitted follows them.
- `slow`: 15 rather than 30 frames per second, with no pointer attention.
- `still`: render and hold, redrawing for props/size changes. Default true at side ≤64, false
  above that. Held expressions settle for twelve steps as the React still avatar does.
  Forty sidebar stills plus a live chat creature share **one** retro WebGL renderer, not forty
  contexts. The forty-avatar stress gallery also has the eleven moods and all four work variants, three small
  sizes, a separate hatching egg and scene views. Held orbs retain their scene but do no
  animation or draw work; the shared loop visits them cheaply. There is no claim of an
  unlimited list or a measured hardware frame-rate guarantee. Virtualised rows should destroy
  their views normally.
- `pettable`: click/tap to pat, or rub back and forth to stroke, with up to eight hearts. The
  body radius, rub/stroke thresholds, rest and heart interval match React's `usePetting`.
  Hearts follow Exact time, with no rising movement when reduced. An egg cannot be petted.
- `hatching`: a false-to-true change plays the hatch; false or a press while hatching skips
  to the end. `crack`: 0–1, how far the waiting egg is cracked.
- `feed`, `cheer`, `talk`, `key`: counters for one-off acts. Each change to a non-empty value
  is one more: `feed` is a treat at its mouth (it opens for it, takes three bites 300 ms apart
  with crumbs in the colour `crumb` names, then is pleased, with three hearts: care.tsx's
  `useTreats`); `cheer` a hop; `talk` a word of its answer (`feedMascot("token")`); `key` a key
  the person pressed. The treat itself is the caller's to draw (care.contract does). Hearts are
  React's pixel `PetHeart`, stepped like its `pet-heart` keyframes, and rise past the box.
- `message=` receives `pet`, `out`, `hatched`, `state:idle` (after done), or `fallback` when
  WebGL is unavailable. The fallback is the protocol's plain SVG, not a replacement 3D model.

The package draws retro pixels at its own internal resolution; CSS scales them without
smoothing. The entire stage stays within the tag's box (React's avatar lets its canvas extend
12% beyond its span). Allow space for the complete picture when choosing a box size.

## do-portrait

A still player-card island, made by `AgentOrbPortrait` itself. `seed`, `colour`, the outfit
slots and `outfit` work as above. `grid` is its internal pixel side (32–256, default 120),
`hour` 0–3 (default sunrise, 2), `zoom` .2–1 (default 1), `egg` shows the egg. `island="false"`
uses the plain deep-colour backdrop; a failed island uses it too and messages `backdrop`. Without WebGL it overlays the plain
SVG and messages `fallback`.
The sky renderer used for the still is disposed immediately, not held per portrait.

## do-gift

The real wardrobe gift, not an SVG of a box. Common creature props apply; it is always
animated, unpettable and idle behind the box. `shake` starts/stops its rattle. `open="true"`
opens on the wardrobe id in `item`; rarity tiers come from protocol, not copied colours.
`message=` receives `pop` and `shown`. Removing and remounting the tag makes a fresh box.

## do-wardrobe

A held creature wearing `item`, the real wardrobe id, in that item's slot. Common creature
look, side, theme and outfit props apply. It is idle and unpettable. Bind `press=` to choose
or wear it. The server decides whether it is owned; the view does not.

## do-sky

First-run sky, falling egg and island, drawn with `AgentOrbSky` and the same creature.
Give it a box, for example 480×360. It owns one extra sky WebGL renderer, so use it for
onboarding, not for each sidebar row.

- `seed`, `colour`, outfit, `reduced`, `hatching`, `crack` as above. The sky's creature is
  dark, live and unpettable. `side` is calculated from the sky, not a caller prop.
- `fall="false"` puts the egg down; default falls. Change `restart` to replay the arrival.
- `dawn`: 0 night to 3 day, default 0. `clear` keeps the island/egg above this many pixels
  from the top. On shell break, chips/confetti and daybreak play.
- `out`: it is out of its egg (set it once `hatched` arrives); then `state` is the creature's
  state as on `do-creature` (`speaking` while its words are typed), and it looks about.
- `crack` rising throws bits of shell in its colour (`sky.chips`). On shell break, the flash,
  daybreak, bump and confetti in every creature colour play, as welcome/scene.tsx's `hatch`.
- `glow`, `cheer`, `talk`: counters, as on `do-creature`. `glow` pats it and lights the sky
  about it (a colour was picked); `talk` is a letter of what it says: out, it talks; in its egg,
  it rocks every fourteenth letter.
- `card`: the test id of the card under the egg. While that element is in the page the view keeps
  the egg and island above its top (`sky.clear`), as welcome's `Stage.card` does.
- `fly`: the test id of another picture of the creature. Set, the sky fades (700 ms) and the
  creature goes from the island to that element's picture (its box and the 12% `overscan` past
  it), scaled to fit, in 950 ms (Stage.fly),
  once the element has stopped moving (looked for up to 5 s); then `message` receives `flown`.
  The scene is meant to fill the window: a target outside the view's own box is clipped. Hide the
  target until `flown`, so the creature is never seen twice.
- A click on the view while the egg falls lands it; a click on the creature makes it hop.
- `message=` receives `land`, `out`, `hatched`, `flown`, or `fallback` if only the creature can
  draw. Normally wait for `land` before setting `hatching`. Reduced motion lands immediately and
  plays the package's short hatch. The cards and what they ask are welcome.contract's.

## Build and tests

After `pnpm install`, run `bun modules/web/build.mjs` from `apps/do-exact` to regenerate
`engine.js`. Its source imports are intentionally outside the page-module tree; the bundle's
imports are not. The bundle is generated and committed, never hand-edited. The rest of the
files remain ordinary modules so other tags can be added without rebuilding the mascot.

From `tests/creature-gallery`, use `./x test web creature.test.contract` (see PORTING.md).
Run it once with `--size 390x844` and once with `--size 1280x1300`. A server-free `./x verify`
currently races its own parallel drives on the pinned port; use sequential `agent … "check
both"` for its light/dark checks, as PORTING.md explains. For the
real app run the root `./x test web` and `./x verify` too. These tests need no server account:
they are a separate, data-free app. Do not add its route to the real app.

The gallery prepare step runs `bun modules/web/build.mjs --check` to catch stale generated
code. `reference.mjs` captures the actual React Dood page for seed `pip0`, colour `moss`,
while a root `./x agent` drive holds the test server open; it never starts another server.
For example, clear `.exact/reference.done` in the gallery, start root
`./x agent web "clock +30000 real until tests/creature-gallery/.exact/reference.done"`, then
run `bun reference.mjs` in the gallery while that drive is live. Supply `CHROME` if its
Playwright Chromium is not installed at the default location.

The browser fallback for gift and wardrobe tiles is the plain creature, without the box or
clothes. Nothing silently pretends a failed WebGL drawing is a successfully rendered garment.
