import { defineConfig } from "@playwright/test"

/**
 * Browser tests against the built Node server. Each file of tests is given a server of its own
 * (see e2e/fixtures.ts), so the files run side by side while the tests in a file run in order.
 *
 * Build first: `pnpm build:node`, and for the mobile app's tests
 * `pnpm --filter @durable-computer/mobile export:web:test`. Set PLAYWRIGHT_CHROMIUM_PATH to use an already-installed Chromium
 * instead of the one `playwright install chromium` downloads.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  // CI's machines have two cores, and a third worker there only makes the tests late for each
  // other. Elsewhere it is half the cores there are.
  workers: process.env.CI ? 2 : undefined,
  // Those machines are also several times slower, most of all where a creature is drawn, which
  // they do in software: a page that is right a moment late was failing a run there now and
  // then, and a failed run on main is a deploy that does not happen.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  // A test that fails there is run once more, with its file's tests before it and a server
  // of its own. One that then passes does not fail the run. It is named as flaky at the end of
  // the run and as a warning on it (see e2e/flaky.ts), and what its failure left is kept.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["./e2e/flaky.ts"]],
  use: {
    colorScheme: "dark",
    viewport: { width: 1280, height: 860 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      // A synthetic microphone, for the dictation test.
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    trace: "retain-on-failure",
  },
  // The mobile app's tests need its web build, which takes a while to make, so CI runs them apart.
  projects: [
    { name: "web", testIgnore: "mobile.spec.ts" },
    { name: "mobile", testMatch: "mobile.spec.ts" },
  ],
})
