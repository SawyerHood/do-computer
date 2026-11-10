# Message content gallery

A second, data-free Exact app. `prepare.mjs` checks the committed dependency build, mirrors
all production web modules (including nested lazy chunks), and copies `views/markdown.contract`.
There is no test implementation of the renderer and no route added to the real app.

The fixture strings in `app.contract` cover CommonMark/GFM, reference/autolinks and heading
links, tasks and nested lists, a quote and alert, a rule and setext heading, sanitized folding
HTML/kbd/sub/sup/mark, footnotes, an unsafe script/URL, library links, remote/missing pictures,
inline code, known/unknown code languages, long lines, an 80-line block, a wrapping table,
a six-column overflowing table, complete and incomplete Mermaid, and a six-piece stream.
`fixtures.mjs` reads these exact strings for the React echo-model reference.

## Run

From this folder, after the root PORTING.md setup:

```sh
./x test web markdown.test.contract --size 390x844
./x test web markdown.test.contract --size 1280x800
./x agent web --size 390x844 "clock data" "clock until state ready == true within 3000" \
  "clock +1000 real" "tap examples" "screenshot .exact/syntax.png" "check both"
./x agent web --size 1280x800 "clock data" "clock until state ready == true within 3000" \
  "clock +1000 real" "tap prose-jump" "screenshot .exact/prose.png" "check both"
```

The two Contract tests are:

- `rich text and standalone blocks mount at natural height`: tags/load event, destruction and
  remounting. Height itself is checked by the browser probe, not the opaque Exact tree.
- `a reply streams prose, an open code fence and a completed block on Exact time`: six pieces
  arrive on the app clock and it finishes without a still-streaming fence.

Both pass at 390×844 and 1280×800. Both sizes' sequential `check both` pass, with no gallery
compiler warnings. Do not use a second server on 8766. Like creature-gallery, this data-free
app uses sequential checks instead of Exact's known parallel-drive `verify` port race.

The DOM probe needs the Playwright Chromium binary available on this machine:

```sh
export CHROME="$HOME/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"
~/.bun-1.4.2/bin/bun run-browser.mjs
```

`run-browser.mjs` starts **only `./x agent`**, waits for its host-ready output, then runs
`probe.mjs` against that host. The drive closes when the helper writes its completion file.
It respects the same machine-wide lock even when another agent holds the ports. The ten
browser checks cover:

1. Shiki token spans and a completed Mermaid SVG.
2. Host/child natural height equality, internal code scrolling and no page overflow.
3. Selection crossing prose and code in one message.
4. Clipboard text and `copied`, code wrapping, table Markdown/CSV copy menus.
5. Sanitization, GFM tasks, setext/reference links, alerts, folding HTML and image consent
   (an intercepted image succeeds only after Show; zero remote requests before it), and
   replacing a caller-resolved file URL.
6. Same-message heading links and `file:id` for resolved library links.
7. The same text node and selection while streaming, and identical block height before/after
   highlighting the completed code, plus the 80,000-character cutoff.
8. Malformed Mermaid falling back to code, recovery, and source/diagram switching.
9. The rejected split-prose trial: a DOM Range cannot span into another shadow tree.
10. Horizontal scrolling in a genuinely wide table and full height for eighty code lines.

The probe uses the native props ABI for replacement/race cases; the Contract stream test
separately covers the actual caller. It does not claim a long-chat performance benchmark.
The unchanged creature-gallery's three tests also pass after adding the lazy dispatcher.

## React reference

```sh
~/.bun-1.4.2/bin/bun run-browser.mjs --reference
```

This starts a root `./x agent` drive with `DC_ECHO_REPLIES` set to the fixture messages, then
`reference.mjs` makes an account and agent and sends the two fixture prompts through the
real chat API. It captures the **actual React chat**, not a replacement rendering or copied
CSS, at 1280×800 and 390×844 in light/dark. The root drive owns 3911 and 8766 for its lifetime;
the helper starts no server and changes no production setting. Look at the captured files.

## Screenshots inspected

All are under this folder's `.exact/` (not committed). The final reviewed set is:

- `exact-syntax-{desktop,mobile}-{light,dark}-v2.png`: highlighted long code, aligned wrapping
  table, rendered diagram and an unknown-language fallback.
- `exact-prose-{desktop,mobile}-{light,dark}-final.png`: prose/inline markup, references, nested
  lists/tasks, alerts, folding section, footnote, privacy prompt, missing picture and unsafe URL.
- `exact-diagram-wide-mobile-{light,dark}.png`: independent completed diagram, wide table,
  and the start of the 80-line block.
- `exact-stream-writing.png`, `exact-stream-done.png`: open/plain and completed/highlighted
  fenced code, alongside the unfinished Mermaid fallback.
- `exact-own-reader.png`: Exact's own reader and the split trial. The reader leaves the table
  as literal pipe text and the diagram as source, with no highlighting/copy controls.
- `react-{syntax,prose}-{desktop,mobile}-{light,dark}.png`: the same fixture text through the
  actual React chat. Its frame/sidebar/composer and font differ; syntax colors, table behavior,
  diagram shape and the supported Markdown constructs were compared visually.

Root `./x test web` still passes. Root `./x verify` retains the existing persisted
`performanceNow()` warning and two largest-text layout findings (sign-in title and relaunch
list); it passes its account/chat test and normal first/test/relaunch light/dark checks.
The root chat is intentionally not changed by this piece. The integration call and remaining
library/image limitations are in `../../modules/web/README.md` and `../../GAPS.md`.
