import { defineConfig } from "vitest/config"

// The tests in e2e/ start the app itself and are Playwright's.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } })
