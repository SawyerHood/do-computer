import { defineConfig } from "@playwright/test"

/** The council's pictures (`council-shots.ts`), apart from the test suite. */
export default defineConfig({
  testDir: ".",
  testMatch: "council-shots.ts",
  workers: 1,
  reporter: [["list"]],
  timeout: 600_000,
  expect: { timeout: 15_000 },
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
})
