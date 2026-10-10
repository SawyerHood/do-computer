import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./test/workers/wrangler.jsonc" } })],
  // The shell's own Worker takes a few seconds to start the first time.
  test: { include: ["test/workers/**/*.workers.test.ts"], testTimeout: 60_000 },
})
