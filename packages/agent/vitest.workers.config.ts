import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./test/workers/wrangler.jsonc" } })],
  test: { include: ["test/workers/**/*.workers.test.ts"], testTimeout: 20_000 },
})
