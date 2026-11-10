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
- `message=` receives `land`, `out`, `hatched`, or `fallback` if only the creature can draw.
  Normally wait for `land` before setting `hatching`. Reduced motion lands immediately and
  plays the package's short hatch. No auth, cards or flight-to-chat transition lives here.

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

## Message content: do-markdown, do-code, do-mermaid

These tags are web-only, selectable DOM, not canvases. Leave their height unset. Use
`align-self="stretch" min-width=0 max-width="100%"` in a column; their shadow content gives
its real height to browser layout. Code, tables and diagrams scroll sideways inside that
width. `dark="true"` or `"false"` overrides appearance; otherwise they follow Exact and the
browser. Fonts inherit from the host, with a monospace fallback for code. The syntax colors
are generated from the React app's theme tokens, not a similar Shiki preset.

The dispatcher loads these implementations only when one is created. A creature-only page
needs none of their dependencies. `load=` means the first rendering is ready (for a whole
message, prose is ready; highlighting and diagrams can still finish). If the implementation
cannot load, readable source replaces it and `message=` receives `content-unavailable`.
Do not assert native internals with the Exact tree: it sees the tag, props and label only.

### do-markdown

- `text`: the entire Markdown message, not HTML or a pre-split collection of blocks.
- `streaming`: `"true"` while this text is still arriving; default `"false"`. Only the last
  unclosed fence stays plain. Closed code blocks can highlight before the reply finishes.
- `files`: optional JSON array of `{ "path": "notes/hello.md", "id": "hello", "href": "…" }`.
  This is a caller's resolved library listing, not a request to fetch one. `path` is required;
  `id` and `href` are optional. Matching links emit `file:<id>` (or `file:<path>` without an
  id). Pictures use the supplied, browser-loadable `href`; the caller owns its authorization
  and expiry. Unresolved relative links open a new tab; unresolved pictures show their alt
  text. Never put a bearer secret in this prop.
- `dark`: optional appearance override.
- `message=`: `copied`, `copy-failed`, `highlighted`, `diagram`, `diagram-fallback`,
  `image-loaded`, `image:<url>` when opening a figure, `file:<id-or-path>`, or
  `content-unavailable`. These are notifications, not server writes. Ignore the ones your
  screen does not need. A figure also opens in a new browser tab; it is not yet the app's
  full picture viewer.

The parser is the React app's **actual** `components/markdown/pipeline.ts`, bundled with the
same CommonMark/GFM reader and sanitizer. It handles headings and duplicate heading IDs,
paragraphs, emphasis, strike, inline code, nested ordered/unordered lists, disabled task
checkboxes, quotes, thematic breaks, reference/autolinks, footnotes, aligned tables, all five
GitHub alert kinds and sanitized HTML (`details`, `summary`, `kbd`, sub/superscript, `mark`,
etc.). Heading links find a heading within this message; other links open a new tab with
`noreferrer noopener`. Tables have a one-line toggle and a copy menu for Markdown or CSV,
using the protocol's serializers. Unsafe HTML, scripts and unsafe URLs are removed.

Pictures at another host make **no request until Show is pressed**, including images written
in raw HTML. Show lasts for that picture instance; persistent per-host permission is not
implemented. Approved video/audio URLs use browser controls. Responsive `<source srcset>`
is deliberately skipped: it would bypass the image permission UI. `GAPS.md` lists the
library previews, viewer and permission work that remains. React has no KaTeX/remark-math
plugin here, and no Markdown mention widget: `$math$` and `@names` remain text in both.

### do-code

- `code`: the code string, without the fence or an added terminal newline.
- `language`: the fence language, including aliases such as `ts`, `js`, `py`, `sh`; empty or
  unknown names are plain code. The label preserves what the author wrote.
- `streaming`: `"true"` leaves the block plain until it closes. Default false.
- `dark`: optional appearance override.
- `message=`: `copied`, `copy-failed`, `highlighted`, `content-unavailable`. Copy is handled
  inside the view with the browser clipboard; no Contract mutation is needed. There is also
  a Wrap long lines button. `load=` fires after its first plain or highlighted rendering.

The implementation imports the React app's `shiki.ts`, including its aliases, lazy language
imports and `dc` CSS-variable theme. It uses the JavaScript regex engine, not a WASM download.
Like React, blocks over 80,000 characters stay plain, and the last 200 highlighted blocks are
remembered. Open streaming code updates the same text node with appended text: selection and
horizontal scroll survive. Late results cannot repaint a newer block or a destroyed view.

### do-mermaid

- `diagram`: Mermaid source without its fence.
- `streaming`: true shows source, without trying to parse an unfinished diagram.
- `dark`: optional appearance override.
- `message=`: `diagram`, `diagram-fallback`, `copied`, `copy-failed`, `content-unavailable`.
  `load=` fires after the initial source fallback or completed rendering.

Mermaid loads only for a complete, nonempty diagram. Draws are serialized because Mermaid
keeps global settings. It uses strict security, the React app's flat look and layout settings,
and the generated light/dark theme roles. Parse errors show source, as React does. A later
valid source recovers. A valid diagram has Show the code / Show the diagram and Copy controls.
It retains the previous drawing during a theme redraw and disposes its temporary measuring
surface even on failure.

### Contract caller

`views/markdown.contract` exports `MessageText` with four required props: `text: string`,
`streaming: bool`, `files: string`, `message: action`. Simple single-paragraph prose uses
Exact's own `markup="markdown"`. Multiline text, links, HTML and fenced blocks use a single
`do-markdown`: splitting prose and native fences across shadow roots loses a single DOM
selection range, and can also separate reference-link definitions or nested block trees.
The gallery keeps that rejected split trial and the unmodified Exact reader for comparison.

The real chat is intentionally unchanged, because its owner is moving it to `views/`.
Import from `./markdown.contract` in that view (or `./views/markdown.contract` in the root),
then replace the assistant text branch with:

```contract
MessageText(text=b.text, streaming=(message.status == "streaming"), files="[]", message=markdownSaid)
```

An empty `action markdownSaid(value: string)` is fine until the screen handles `file:` and
picture notifications. Later pass its library listing as `files`; do not fetch server state
inside the native view. Keep transcript following/scrolling with the screen that already owns
it. A reply that begins as simple prose can switch from Exact to native when richer text
arrives; selection over that one renderer change is not promised.

### Generated files and checks

`bun modules/web/build.mjs` now also regenerates `markdown-built/`. Do not hand-edit it. It
contains the parser, CSS tokens, Shiki, its 44 lazy grammar entries, Mermaid and its lazy
diagram implementations, plus upstream notices. The build pins its own working directory
because Bun's split-module identities depend on it. `--check` compares without writing.
There is no CDN and no foreign runtime import outside the copied module tree.

At this revision: **139 generated JS files, 8,607,475 bytes** (sum of individually gzipped
files: 2,052,838 bytes), plus **259,561 bytes of notices**. The parser's static closure is
387,486 bytes; the Shiki entry's is 7,956 bytes before its engine and requested grammars;
Mermaid's is 744,142 bytes before the diagram type's chunks. This is the available bundle,
not an initial download: parser/style load on first rich content, Shiki only for complete
code, each grammar on first use, Mermaid only for a complete diagram and its renderer on
first use. The unchanged mascot `engine.js` is another 790,023 bytes. No fonts are bundled by
this piece; prose inherits the host's font, and monospace uses the system fallback.

`tests/markdown-gallery/README.md` gives the gallery commands, the browser interaction checks,
React reference capture and the screenshot list. Its prepare step copies the complete module
tree, including lazy chunks; copying only the top-level JS files is not enough for rich tags.
The older creature-only gallery can keep its small mirror because dispatch to rich content
is lazy, and its three tests are regression-tested separately.
