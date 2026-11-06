# The design council

A hill climb on how Do Computer looks: the same screenshots every round, scored by judges from
different model providers beside reference shots of Grok Bot (xAI's agent app) and Muse
(Meta's long-running personal agent).

1. `scripts/council/run.sh r3 codex claude gemini` does a whole round: `pnpm build:node`, the
   pictures (`apps/web/e2e/council-shots.ts`, with its own config `e2e/council-shots.config.ts`),
   gathered with the reference shots in `.council/rounds/r3/images`, then the judges.
   The chat is written out in `e2e/council-script.ts` and answered by the echo model
   (`DC_ECHO_REPLIES`), so no key or network is needed. Set `PLAYWRIGHT_CHROMIUM_PATH` to an
   installed Chromium and `DC_COUNCIL_PORT` (default 47110) to a free port.
2. The reference apps' shots go in `.council/refs/` (gitignored): `grok-*` and `muse-*`.
3. `scripts/council/judge.sh .council/rounds/r3 codex claude gemini` asks each judge again,
   read-only, with `prompt.md`, and writes `<judge>.json`. The prompt never names a target score.
   Codex runs over ssh on `COUNCIL_CODEX_HOST` where it is signed in; `COUNCIL_CLAUDE_VIA=cursor`
   asks Opus through cursor-agent; Gemini is asked through cursor-agent.
4. `scripts/council/table.py .council/rounds` prints the scores round by round.
