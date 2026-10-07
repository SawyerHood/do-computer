import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig } from "@playwright/test"

const port = Number(process.env.DC_E2E_PORT ?? 3187)
const baseURL = `http://127.0.0.1:${port}`

/**
 * Browser tests against the built Node server, each run on a fresh data directory. Without a model
 * key the server answers with its built-in echo model, so the tests need no network.
 *
 * Build first: `pnpm build:node`, and for the mobile app's tests
 * `pnpm --filter @durable-computer/mobile export:web:test`. Set PLAYWRIGHT_CHROMIUM_PATH to use an already-installed Chromium
 * instead of the one `playwright install chromium` downloads.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    colorScheme: "dark",
    viewport: { width: 1280, height: 860 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      // A synthetic microphone, for the dictation test.
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node server.node.mjs",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      DC_BASE_URL: baseURL,
      DC_DATA_DIR: mkdtempSync(join(tmpdir(), "dc-e2e-")),
      OPENROUTER_API_KEY: "",
      // The mobile app's tests sign up their own account on this invite-only deployment.
      DC_ALLOWED_EMAILS: "mobile@example.com",
      // The connector tests run their MCP server on this machine.
      DC_ALLOW_PRIVATE_HOSTS: "1",
    },
  },
})
