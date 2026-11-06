import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: ".",
  testMatch: "council-shots.ts",
  workers: 1,
  timeout: 180000,
  use: {
    baseURL: "http://127.0.0.1:47210",
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
      args: ["--disable-webgl", "--disable-webgl2"],
    },
    trace: "retain-on-failure",
  },
})
