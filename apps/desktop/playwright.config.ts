import { defineConfig } from "@playwright/test"

/**
 * The app itself, started as its owner would start it, against the built Node server. Build
 * both first: `pnpm --filter @durable-computer/web build:node` and `pnpm build` here. A Linux
 * machine with no screen needs one made up: `xvfb-run -a pnpm test:e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
})
