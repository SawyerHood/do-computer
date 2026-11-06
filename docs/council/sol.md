# Do Computer UI council — Sol

Draft only. Polish of the existing creature-companion UI, not a redesign. The prescribed stop
gate requires **every judge** to give Do Computer **at least 9 in every category** and strictly
beat both references in each category. The final report below states whether that gate passed;
we do not average our way around it.

## Three biggest changes

1. **One restrained action language.** Teal action/selection tokens independent of creature hue,
   legible dark-mode action labels, neutral disabled Send, a distinct live Stop action, consistent
   icon targets, and no redundant colored status dots in touched navigation/presence/native UI.
2. **Settings that behave and read as one system.** Independently scrolling profile body with a
   separate fixed action bar; consistent form/card radii, bundled Geist in Electron pages,
   coherent switch rows, compact metadata/logs, concise privacy copy and connector disclosures.
3. **More deliberate chat hierarchy.** Tighter real welcome creature/name stack, short threads
   beginning beneath the header, quiet desktop switcher, subtle own-message tint, readable
   responsive comparison tables and conservative numeric-column alignment that preserves
   authored Markdown alignment. No hard-coded recommended-row styling or fixture-only CSS.

## Method and scope

- Eight fixed views × light/dark = 16 Do Computer images per round: home, conversation, working
  activity, Profile, Connectors, 390×844 phone conversation, Electron This computer, Other devices.
- Same six genuine official reference images throughout: three Grok Bot launch-film frames and
  three Meta Muse product-site UI images. SHA-256 audit checks reference bytes and view filenames.
  See `scripts/council/references.md` for URLs, timestamps and capture limitations.
- Real production components. Only chat transport state and Electron's preload bridge are
  deterministic local fixtures. No actual tools or provider-model calls for app screenshots.
  Electron's main UI is the web app; phone scope is responsive web, not the Expo app.
- WebGL disabled for stable capture, so the creature is the app's production fallback SVG, not a
  generated screenshot-only mascot. Browser animations disabled/reduced consistently.
- Judges: GPT `gpt-6.1-sol` via read-only Codex on omarchy; Opus `claude-opus-5-5-high` and Gemini
  `gemini-4-argon-high` via Cursor ask. Prompt contains neither target nor previous scores.
  All builds and judge processes run at nice 19, fixture server on port 47210.
- Each response scores all three apps in all seven categories and gives eight concrete issues.
  Scores below are actual validated responses, not filled templates. Every improvement round
  has its own commit. Imperfect rounds remain in the record.

## Failures and limitations

- Judge/capture/typecheck/unit-test outcomes are summarized with the final results below.
- Official media.x.ai film download returned 403; used the official YouTube upload instead.
  Two WebP decode failures were handled with browser-canvas lossless conversion; Pillow was
  unavailable and was not installed. References were finalized before baseline judging.
- Initial theme emulation did not update the root class; corrected before baseline. R1's footer
  clipping was retained honestly, repaired incrementally in R2/R3 and regression-tested later.
  A timing-report file glob included a log filename; fixed without altering recorded clocks.
- R6's native pixel-mark experiment did not fit the creature identity and was reverted in R7.
- Different screenshot sizes, filmed/marketing reference crops, static empty-composer states,
  production-fallback mascot rendering and subjective judge variation limit the comparison.
  We did not enable empty Send or hard-code a recommended row just to satisfy visual critiques.

## Final result

**12 improvement rounds plus baseline. Strict stop gate: NOT achieved; stopped at the prescribed round-12 cap.**

| Judge  | Baseline average | Final average | Change | Final minimum |
| ------ | ---------------: | ------------: | -----: | ------------: |
| GPT    |            6.400 |         7.243 | +0.843 |           6.7 |
| Opus   |            5.757 |         6.129 | +0.371 |           5.9 |
| Gemini |            6.814 |         7.586 | +0.771 |           7.4 |

Task start: 2026-11-06T17:31:00Z. Last evaluation finished: 2026-11-06T19:01:39+00:00.
Setup + iteration wall time: **1h 30m 39s**.
Validation/archiving completion: 2026-11-06T19:04:25+00:00.
Total through archive completion: **93 minutes**.

39/39 judge responses valid; no judge or capture failures. All round score schemas and
unchanged references audited. Final `pnpm check`, protocol/web/desktop unit suites and
Electron production build passed (see archive validation logs). **813 unit tests passed:**
345 protocol, 310 web, 158 desktop. Screenshot regression assertions
cover fixed footer geometry, phone overflow and native font loading.

Primary-action text contrast measured in Chromium: light 5.54:1, dark 7.42:1.

Scores are non-monotonic; all rounds, including regressions, are retained. The final state is
the cap round, not a cherry-picked per-judge peak.

### Do Computer averages, all rounds

| Round |   GPT |  Opus | Gemini |
| ----: | ----: | ----: | -----: |
|     0 | 6.400 | 5.757 |  6.814 |
|     1 | 6.600 | 5.771 |  6.857 |
|     2 | 6.429 | 5.857 |  7.400 |
|     3 | 6.743 | 6.071 |  7.043 |
|     4 | 7.014 | 6.171 |  7.357 |
|     5 | 7.071 | 6.357 |  7.843 |
|     6 | 7.071 | 6.243 |  7.957 |
|     7 | 7.114 | 6.157 |  7.700 |
|     8 | 7.186 | 6.271 |  7.614 |
|     9 | 7.100 | 6.300 |  7.957 |
|    10 | 7.243 | 6.671 |  7.714 |
|    11 | 7.214 | 6.300 |  7.614 |
|    12 | 7.243 | 6.129 |  7.586 |

### Round clocks

| Round | Start (UTC)          | End (UTC)            | Wall time |
| ----: | -------------------- | -------------------- | --------: |
|     0 | 2026-11-06T17:47:04Z | 2026-11-06T17:50:46Z |    3m 42s |
|     1 | 2026-11-06T17:52:51Z | 2026-11-06T17:57:24Z |    4m 33s |
|     2 | 2026-11-06T17:58:07Z | 2026-11-06T18:01:32Z |    3m 25s |
|     3 | 2026-11-06T18:03:55Z | 2026-11-06T18:06:44Z |    2m 49s |
|     4 | 2026-11-06T18:08:08Z | 2026-11-06T18:11:28Z |    3m 20s |
|     5 | 2026-11-06T18:13:36Z | 2026-11-06T18:16:37Z |     3m 1s |
|     6 | 2026-11-06T18:18:12Z | 2026-11-06T18:21:40Z |    3m 28s |
|     7 | 2026-11-06T18:24:59Z | 2026-11-06T18:28:08Z |     3m 9s |
|     8 | 2026-11-06T18:30:04Z | 2026-11-06T18:33:23Z |    3m 19s |
|     9 | 2026-11-06T18:36:17Z | 2026-11-06T18:40:15Z |    3m 58s |
|    10 | 2026-11-06T18:42:04Z | 2026-11-06T18:46:43Z |    4m 39s |
|    11 | 2026-11-06T18:49:58Z | 2026-11-06T18:53:33Z |    3m 35s |
|    12 | 2026-11-06T18:56:37Z | 2026-11-06T19:01:39Z |     5m 2s |

### Full scoring table — every app, judge, round and category

#### Codex judge (GPT)

| Round | App             | Hierarchy | Typography | Icons | Color | Spacing | Consistency | Polish | Lowest | Average |
| ----: | --------------- | --------: | ---------: | ----: | ----: | ------: | ----------: | -----: | -----: | ------: |
|     0 | **Do Computer** |       6.5 |        6.7 |   6.4 |   6.3 |     6.4 |         6.1 |    6.4 |    6.1 |    6.40 |
|     0 | Grok Bot        |       7.3 |          7 |   7.4 |     7 |     7.2 |         7.5 |    7.2 |      7 |    7.23 |
|     0 | Meta Muse       |       8.3 |        8.3 |   8.1 |   7.8 |       8 |         8.2 |    8.4 |    7.8 |    8.16 |
|     1 | **Do Computer** |       6.5 |          7 |   6.5 |   6.6 |     6.4 |         6.8 |    6.4 |    6.4 |    6.60 |
|     1 | Grok Bot        |       7.2 |        6.8 |   7.2 |   6.7 |     6.8 |         7.3 |      7 |    6.7 |    7.00 |
|     1 | Meta Muse       |       8.4 |        8.3 |     8 |     8 |     8.1 |         8.3 |    8.4 |      8 |    8.21 |
|     2 | **Do Computer** |       6.3 |        6.7 |   6.1 |   6.4 |     6.2 |           7 |    6.3 |    6.1 |    6.43 |
|     2 | Grok Bot        |       7.2 |        6.8 |   7.3 |   6.7 |       7 |         7.3 |      7 |    6.7 |    7.04 |
|     2 | Meta Muse       |       8.3 |        8.2 |     8 |   7.8 |     8.1 |         8.3 |    8.4 |    7.8 |    8.16 |
|     3 | **Do Computer** |       6.7 |          7 |   6.5 |   6.8 |     6.3 |         7.3 |    6.6 |    6.3 |    6.74 |
|     3 | Grok Bot        |       7.2 |        6.8 |   7.4 |   6.7 |     6.8 |         7.1 |      7 |    6.7 |    7.00 |
|     3 | Meta Muse       |       8.3 |        8.2 |     8 |   7.8 |       8 |         8.2 |    8.4 |    7.8 |    8.13 |
|     4 | **Do Computer** |         7 |        7.1 |   6.7 |   6.8 |     7.2 |         7.4 |    6.9 |    6.7 |    7.01 |
|     4 | Grok Bot        |       6.8 |        6.6 |   7.3 |   6.5 |     6.7 |         7.1 |    6.8 |    6.5 |    6.83 |
|     4 | Meta Muse       |       8.3 |        8.2 |     8 |   7.7 |     8.1 |           8 |    8.3 |    7.7 |    8.09 |
|     5 | **Do Computer** |         7 |        7.2 |   6.7 |   7.1 |       7 |         7.6 |    6.9 |    6.7 |    7.07 |
|     5 | Grok Bot        |       7.1 |        6.8 |   7.4 |   6.7 |     6.8 |         7.2 |      7 |    6.7 |    7.00 |
|     5 | Meta Muse       |       8.5 |        8.3 |   8.1 |     8 |     8.2 |         8.3 |    8.5 |      8 |    8.27 |
|     6 | **Do Computer** |       7.1 |        7.3 |   6.7 |   7.2 |     7.2 |           7 |      7 |    6.7 |    7.07 |
|     6 | Grok Bot        |       7.3 |          7 |   7.6 |   6.8 |     7.1 |         7.6 |    7.3 |    6.8 |    7.24 |
|     6 | Meta Muse       |       8.3 |        8.2 |     8 |     8 |     7.9 |         8.5 |    8.4 |    7.9 |    8.19 |
|     7 | **Do Computer** |         7 |        7.1 |   6.7 |   7.2 |     7.3 |         7.5 |      7 |    6.7 |    7.11 |
|     7 | Grok Bot        |       7.2 |        6.9 |   7.5 |   6.9 |     6.8 |         7.3 |    7.1 |    6.8 |    7.10 |
|     7 | Meta Muse       |       8.4 |        8.3 |     8 |     8 |     8.1 |         8.3 |    8.5 |      8 |    8.23 |
|     8 | **Do Computer** |       7.1 |        7.3 |   6.6 |   7.4 |     7.2 |         7.7 |      7 |    6.6 |    7.19 |
|     8 | Grok Bot        |       7.2 |          7 |   7.4 |   7.1 |     6.8 |         7.5 |    7.2 |    6.8 |    7.17 |
|     8 | Meta Muse       |       8.5 |        8.4 |   8.3 |   8.2 |     8.3 |         8.3 |    8.6 |    8.2 |    8.37 |
|     9 | **Do Computer** |         7 |        7.2 |   6.5 |   7.3 |     7.2 |         7.5 |      7 |    6.5 |    7.10 |
|     9 | Grok Bot        |       6.7 |        6.6 |   7.2 |   6.4 |     6.5 |           7 |    6.8 |    6.4 |    6.74 |
|     9 | Meta Muse       |       8.5 |        8.3 |     8 |   7.8 |     8.1 |         8.3 |    8.5 |    7.8 |    8.21 |
|    10 | **Do Computer** |       7.2 |        7.4 |   6.8 |   7.2 |     7.3 |         7.7 |    7.1 |    6.8 |    7.24 |
|    10 | Grok Bot        |       7.3 |        7.1 |   7.5 |   7.2 |     6.9 |         7.4 |    7.2 |    6.9 |    7.23 |
|    10 | Meta Muse       |       8.4 |        8.3 |   8.2 |   8.1 |     8.1 |         8.2 |    8.5 |    8.1 |    8.26 |
|    11 | **Do Computer** |       7.1 |        7.2 |   6.6 |   7.5 |     7.3 |         7.7 |    7.1 |    6.6 |    7.21 |
|    11 | Grok Bot        |       6.8 |        6.7 |   7.2 |   6.5 |     6.6 |         7.1 |    6.8 |    6.5 |    6.81 |
|    11 | Meta Muse       |       8.4 |        8.3 |   8.1 |   8.1 |     8.2 |         8.5 |    8.5 |    8.1 |    8.30 |
|    12 | **Do Computer** |       7.2 |        7.3 |   6.7 |   7.2 |     7.4 |         7.8 |    7.1 |    6.7 |    7.24 |
|    12 | Grok Bot        |       7.3 |        6.8 |   7.5 |   6.7 |     6.9 |         7.2 |      7 |    6.7 |    7.06 |
|    12 | Meta Muse       |       8.4 |        8.2 |     8 |   7.7 |     7.8 |         8.3 |    8.5 |    7.7 |    8.13 |

#### Claude judge (Opus)

| Round | App             | Hierarchy | Typography | Icons | Color | Spacing | Consistency | Polish | Lowest | Average |
| ----: | --------------- | --------: | ---------: | ----: | ----: | ------: | ----------: | -----: | -----: | ------: |
|     0 | **Do Computer** |         6 |        5.8 |     6 |   5.6 |     6.2 |           5 |    5.7 |      5 |    5.76 |
|     0 | Grok Bot        |       6.8 |        6.8 |   7.3 |   6.6 |     6.5 |         7.1 |      7 |    6.5 |    6.87 |
|     0 | Meta Muse       |       8.3 |        8.1 |   7.8 |     8 |     8.4 |         7.9 |    8.4 |    7.8 |    8.13 |
|     1 | **Do Computer** |         6 |        5.4 |   6.2 |   5.9 |     6.2 |           5 |    5.7 |      5 |    5.77 |
|     1 | Grok Bot        |         7 |        6.8 |   7.2 |   6.6 |     6.8 |         7.1 |      7 |    6.6 |    6.93 |
|     1 | Meta Muse       |       8.5 |        8.3 |   8.2 |     8 |     8.6 |         8.4 |    8.7 |      8 |    8.39 |
|     2 | **Do Computer** |         6 |        5.7 |   6.1 |   5.8 |       6 |         5.5 |    5.9 |    5.5 |    5.86 |
|     2 | Grok Bot        |       6.9 |        6.8 |   7.1 |   6.6 |     6.6 |           7 |    6.9 |    6.6 |    6.84 |
|     2 | Meta Muse       |       8.4 |        8.2 |   8.1 |   8.1 |     8.5 |         8.3 |    8.6 |    8.1 |    8.31 |
|     3 | **Do Computer** |       6.3 |        6.1 |     6 |   5.9 |     6.4 |         5.7 |    6.1 |    5.7 |    6.07 |
|     3 | Grok Bot        |         7 |          7 |   7.4 |   6.7 |     6.9 |         7.1 |    7.1 |    6.7 |    7.03 |
|     3 | Meta Muse       |       8.4 |        8.3 |   8.1 |     8 |     8.4 |         8.3 |    8.6 |      8 |    8.30 |
|     4 | **Do Computer** |       6.3 |          6 |     6 |   6.4 |     6.5 |         5.8 |    6.2 |    5.8 |    6.17 |
|     4 | Grok Bot        |       6.9 |        6.8 |   7.3 |   6.8 |     6.7 |         7.1 |    7.1 |    6.7 |    6.96 |
|     4 | Meta Muse       |       8.4 |        8.2 |   7.8 |     8 |     8.4 |         7.9 |    8.6 |    7.8 |    8.19 |
|     5 | **Do Computer** |       6.7 |        6.2 |     6 |   6.3 |     6.5 |         6.4 |    6.4 |      6 |    6.36 |
|     5 | Grok Bot        |       6.5 |        6.7 |     7 |   6.3 |     6.4 |           7 |    6.8 |    6.3 |    6.67 |
|     5 | Meta Muse       |       8.1 |          8 |   7.5 |   7.9 |     8.1 |         7.7 |    8.3 |    7.5 |    7.94 |
|     6 | **Do Computer** |       6.6 |        6.1 |   5.9 |   6.7 |     6.5 |         5.7 |    6.2 |    5.7 |    6.24 |
|     6 | Grok Bot        |         7 |        6.8 |   7.3 |   6.9 |     6.9 |         7.1 |    7.1 |    6.8 |    7.01 |
|     6 | Meta Muse       |       8.3 |        8.2 |   8.5 |     8 |     8.3 |         8.1 |    8.6 |      8 |    8.29 |
|     7 | **Do Computer** |       6.4 |        5.9 |     6 |   6.3 |     6.4 |         5.9 |    6.2 |    5.9 |    6.16 |
|     7 | Grok Bot        |       7.2 |          7 |   7.4 |   6.9 |       7 |         7.2 |    7.1 |    6.9 |    7.11 |
|     7 | Meta Muse       |       8.5 |        8.3 |   8.1 |   8.3 |     8.6 |         8.1 |    8.7 |    8.1 |    8.37 |
|     8 | **Do Computer** |       6.4 |          6 |   5.9 |   6.7 |     6.5 |         6.1 |    6.3 |    5.9 |    6.27 |
|     8 | Grok Bot        |       6.9 |        6.8 |   7.1 |   6.2 |     6.6 |           7 |    6.8 |    6.2 |    6.77 |
|     8 | Meta Muse       |       8.5 |        8.3 |     8 |   8.3 |     8.6 |           8 |    8.7 |      8 |    8.34 |
|     9 | **Do Computer** |       6.4 |          6 |   6.5 |   6.6 |     6.4 |           6 |    6.2 |      6 |    6.30 |
|     9 | Grok Bot        |         7 |          7 |   7.4 |   6.8 |     6.8 |         7.2 |    7.1 |    6.8 |    7.04 |
|     9 | Meta Muse       |       8.2 |        8.1 |   7.8 |     8 |     8.4 |         7.8 |    8.5 |    7.8 |    8.11 |
|    10 | **Do Computer** |       6.9 |          7 |   6.1 |     7 |     6.8 |         6.3 |    6.6 |    6.1 |    6.67 |
|    10 | Grok Bot        |         7 |          7 |   7.3 |   6.7 |     6.8 |         7.2 |      7 |    6.7 |    7.00 |
|    10 | Meta Muse       |       8.4 |        8.3 |   8.6 |   8.1 |     8.5 |         8.3 |    8.6 |    8.1 |    8.40 |
|    11 | **Do Computer** |       6.5 |        6.1 |   5.9 |   6.7 |     6.6 |           6 |    6.3 |    5.9 |    6.30 |
|    11 | Grok Bot        |       6.8 |        6.9 |   7.1 |   6.4 |     6.5 |           7 |      7 |    6.4 |    6.81 |
|    11 | Meta Muse       |       8.3 |        8.2 |   7.9 |   8.1 |     8.4 |         8.1 |    8.5 |    7.9 |    8.21 |
|    12 | **Do Computer** |       6.4 |        5.9 |     6 |   6.5 |     6.1 |         5.9 |    6.1 |    5.9 |    6.13 |
|    12 | Grok Bot        |       6.9 |        6.8 |   7.3 |   6.7 |     6.6 |           7 |      7 |    6.6 |    6.90 |
|    12 | Meta Muse       |       8.4 |        8.2 |   8.1 |   8.2 |     8.4 |         8.3 |    8.6 |    8.1 |    8.31 |

#### Gemini judge (Gemini 4 Argon High)

| Round | App             | Hierarchy | Typography | Icons | Color | Spacing | Consistency | Polish | Lowest | Average |
| ----: | --------------- | --------: | ---------: | ----: | ----: | ------: | ----------: | -----: | -----: | ------: |
|     0 | **Do Computer** |       6.8 |          7 |   7.2 |   6.4 |     7.1 |         6.5 |    6.7 |    6.4 |    6.81 |
|     0 | Grok Bot        |       7.2 |        7.1 |     7 |   7.3 |       7 |         7.2 |    7.1 |      7 |    7.13 |
|     0 | Meta Muse       |       8.6 |        8.5 |   8.3 |   8.5 |     8.7 |         8.4 |    8.8 |    8.3 |    8.54 |
|     1 | **Do Computer** |       6.8 |        7.2 |     7 |   6.9 |     6.6 |         6.7 |    6.8 |    6.6 |    6.86 |
|     1 | Grok Bot        |       7.9 |        7.7 |   7.8 |   7.6 |     7.8 |           8 |    7.8 |    7.6 |    7.80 |
|     1 | Meta Muse       |       8.6 |        8.4 |   8.5 |   8.5 |     8.6 |         8.4 |    8.7 |    8.4 |    8.53 |
|     2 | **Do Computer** |       7.3 |        7.8 |   7.2 |   7.4 |     7.4 |         7.3 |    7.4 |    7.2 |    7.40 |
|     2 | Grok Bot        |       7.6 |        7.7 |   7.8 |   7.2 |     7.5 |         7.6 |    7.6 |    7.2 |    7.57 |
|     2 | Meta Muse       |       8.8 |        8.6 |   8.5 |   8.6 |     8.7 |         8.7 |    8.9 |    8.5 |    8.69 |
|     3 | **Do Computer** |       7.1 |        7.4 |   6.8 |   6.9 |     7.3 |         6.8 |      7 |    6.8 |    7.04 |
|     3 | Grok Bot        |       7.9 |        7.8 |   7.7 |   7.4 |     7.8 |         7.9 |    7.8 |    7.4 |    7.76 |
|     3 | Meta Muse       |       8.8 |        8.7 |   8.9 |   8.6 |     8.7 |         8.8 |    8.9 |    8.6 |    8.77 |
|     4 | **Do Computer** |       7.3 |        7.6 |   7.4 |   7.4 |     7.2 |         7.3 |    7.3 |    7.2 |    7.36 |
|     4 | Grok Bot        |       7.9 |        7.8 |   7.7 |   7.8 |     7.8 |         7.6 |    7.8 |    7.6 |    7.77 |
|     4 | Meta Muse       |       8.6 |        8.5 |   8.4 |   8.5 |     8.6 |         8.4 |    8.7 |    8.4 |    8.53 |
|     5 | **Do Computer** |       7.8 |          8 |   7.9 |   7.7 |     8.1 |         7.6 |    7.8 |    7.6 |    7.84 |
|     5 | Grok Bot        |       7.7 |        7.6 |   7.5 |     7 |     7.6 |         7.5 |    7.6 |      7 |    7.50 |
|     5 | Meta Muse       |         9 |        8.9 |   8.8 |     9 |     8.9 |         8.8 |    9.1 |    8.8 |    8.93 |
|     6 | **Do Computer** |       7.9 |        8.2 |   7.8 |   8.3 |       8 |         7.6 |    7.9 |    7.6 |    7.96 |
|     6 | Grok Bot        |       7.2 |        7.4 |   7.5 |   6.8 |     7.6 |         6.9 |    7.3 |    6.8 |    7.24 |
|     6 | Meta Muse       |       8.7 |        8.6 |   8.5 |   8.6 |     8.8 |         8.5 |    8.9 |    8.5 |    8.66 |
|     7 | **Do Computer** |       7.6 |        7.8 |   7.7 |   7.3 |       8 |         7.9 |    7.6 |    7.3 |    7.70 |
|     7 | Grok Bot        |       8.2 |        8.1 |   8.3 |     8 |     8.3 |         8.2 |    8.3 |      8 |    8.20 |
|     7 | Meta Muse       |       8.9 |        8.8 |   9.1 |   8.8 |     8.9 |         8.7 |    9.1 |    8.7 |    8.90 |
|     8 | **Do Computer** |       7.6 |        7.8 |   7.7 |   7.3 |     7.8 |         7.5 |    7.6 |    7.3 |    7.61 |
|     8 | Grok Bot        |       8.1 |          8 |   7.9 |   8.1 |     7.9 |           8 |    8.1 |    7.9 |    8.01 |
|     8 | Meta Muse       |       8.8 |        8.7 |   8.9 |   8.6 |     8.7 |         8.6 |    8.9 |    8.6 |    8.74 |
|     9 | **Do Computer** |       7.9 |        8.1 |     8 |   7.8 |     7.7 |         8.2 |      8 |    7.7 |    7.96 |
|     9 | Grok Bot        |       7.6 |        7.5 |   7.4 |   7.3 |     7.4 |         7.6 |    7.5 |    7.3 |    7.47 |
|     9 | Meta Muse       |       8.6 |        8.5 |   8.7 |   8.6 |     8.5 |         8.4 |    8.7 |    8.4 |    8.57 |
|    10 | **Do Computer** |       7.6 |        7.8 |   7.9 |   7.8 |     7.5 |         7.7 |    7.7 |    7.5 |    7.71 |
|    10 | Grok Bot        |       7.6 |        7.5 |   7.7 |   7.2 |     7.5 |         7.6 |    7.5 |    7.2 |    7.51 |
|    10 | Meta Muse       |       8.8 |        8.5 |   8.6 |   8.2 |     8.7 |         8.6 |    8.8 |    8.2 |    8.60 |
|    11 | **Do Computer** |       7.6 |        7.8 |   7.5 |   7.9 |     7.4 |         7.5 |    7.6 |    7.4 |    7.61 |
|    11 | Grok Bot        |       7.8 |        7.9 |   7.7 |   7.6 |     7.8 |         7.7 |    7.8 |    7.6 |    7.76 |
|    11 | Meta Muse       |       8.8 |        8.6 |   8.7 |   8.8 |     8.7 |         8.6 |    8.8 |    8.6 |    8.71 |
|    12 | **Do Computer** |       7.6 |        7.8 |   7.7 |   7.5 |     7.4 |         7.6 |    7.5 |    7.4 |    7.59 |
|    12 | Grok Bot        |       7.9 |        7.8 |   7.7 |   7.2 |       8 |         7.8 |    7.8 |    7.2 |    7.74 |
|    12 | Meta Muse       |       8.8 |        8.7 |   8.4 |   8.6 |     8.9 |         8.8 |      9 |    8.4 |    8.74 |

## Records and reproduction

- Reproducible harness: `scripts/council/README.md`.
- Committed complete score/timing report: `docs/council/sol.md`.
- Full raw records on bee: `/home/sawyer/.do-code/do-computer-council/sol/rounds/`.
- Final images: `/home/sawyer/.do-code/do-computer-council/sol/final/`.
- Unchanged references: `/home/sawyer/.do-code/do-computer-council/sol/refs/`.
- Full score table: `/home/sawyer/.do-code/do-computer-council/sol/table.md`.
- Validation logs: `/home/sawyer/.do-code/do-computer-council/sol/checks/`.

Large screenshots and raw judge transcripts stay out of git. Nothing merged.
