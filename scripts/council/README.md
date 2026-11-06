# Do Computer design council (Sol benchmark)

Adapted from Do Code's council, following Theo's "Agents Sucked At UI (Until Today)".
Read-only independent GPT (Codex on omarchy), Opus 5.5 High (Cursor), Gemini 4 Argon High
(Cursor) score identical fixed views against official Grok Bot / Meta Muse UI references.
The judge prompt never gives a target score or previous scores.

## Reproduce

Use pnpm 11 and Node 24, under `nice -n 19` on the shared bee machine.

1. `pnpm --filter @do-computer/web build:node`.
2. `scripts/council/serve.sh` (port 47210; persistent gitignored `.council/data`, no API keys).
3. `scripts/council/capture.sh` captures `.council/shots`: eight views × two themes.
4. `scripts/council/round.sh r0 .council/shots` gathers fixed competitor PNGs with app shots.
5. `COUNCIL_CODEX_HOST=omarchy COUNCIL_CLAUDE_VIA=cursor scripts/council/judge.sh .council/rounds/r0 codex claude gemini`.
6. `scripts/council/table.py .council/rounds` prints the full table.

Each round preserves `images/`, raw judge output, validated JSON, start/end UTC and notes.
Extraction rejects missing/zero/out-of-range scores, absent apps/categories, and issue counts
other than eight. Remote judge directories use `/tmp/council-sol-judge/` to avoid the parallel run.

## Fixed views

1440×900 home, conversation with table, live tool activity, profile settings, connectors;
390×844 responsive conversation; 760×1000 Electron computer settings and other-device settings.
All in light and dark. The main Electron window uses this same web UI. Native settings use
production HTML, CSS and bundled scripts with an inert mocked preload bridge. Chat data is
injected into the real websocket snapshot; no generated screenshot-only UI. Creature IDs stay
stable using the persistent local server data. No real tools, model keys, accounts or external
services are used by the fixture app. Reference collection alone uses the public internet.

Native mobile/Expo is not changed: phone-width captures cover the responsive web UI only.

After app changes rebuild the server and restart `serve.sh` against the same data before capture.
See `references.md` for source provenance and limitations.

## Record audit and archive

`python3 scripts/council/integrity.py .council/rounds` verifies identical view filenames and
reference SHA-256 bytes in every round, valid nonzero all-app/category score objects, eight
issues per response and recorded start/end times. `timing.py` prints the per-round clocks.

After the last round, run `scripts/council/archive.sh r12 /absolute/archive/directory`.
It preserves every round (including raw judge output and failed experiments), plus convenient
`final/`, `refs/`, `table.md`, `timing.md` and validation-log entry points. Screenshots and large
raw records stay out of git; the scoring report can be committed separately.
