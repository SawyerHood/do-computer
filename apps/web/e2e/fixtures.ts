import { type ChildProcess, spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test as base } from "@playwright/test"

/**
 * Every file of tests has a server to itself: the built Node server on a fresh data directory and
 * a port of its own. That is what lets the files run side by side, one to a worker, while the
 * tests inside a file still run in order and build on each other. Without a model key the server
 * answers with its built-in echo model, so the tests need no network.
 */
type Server = {
  file: string
  url: string
  /** Where this server looks for Slack. Nothing is there unless a file's tests put it there. */
  slack: string
  /** Where this server takes the Apps connector to be. Nothing is there either, until a test is. */
  apps: string
  stop: () => void
}

const entry = fileURLToPath(new URL("../server.node.mjs", import.meta.url))

/** A port nothing is listening on, found by asking for any and giving it straight back. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const { port } = probe.address() as { port: number }
  await new Promise((resolve) => probe.close(resolve))
  return port
}

async function start(file: string, settings: Record<string, string>): Promise<Server> {
  const url = `http://127.0.0.1:${await freePort()}`
  const slack = `http://127.0.0.1:${await freePort()}`
  const apps = `http://127.0.0.1:${await freePort()}`
  const data = mkdtempSync(join(tmpdir(), "dc-e2e-"))
  let errors = ""
  const child: ChildProcess = spawn("node", [entry], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      PORT: new URL(url).port,
      DC_BASE_URL: url,
      DC_DATA_DIR: data,
      OPENROUTER_API_KEY: "",
      // The mobile app's tests sign up their own account on this invite-only deployment.
      DC_ALLOWED_EMAILS: "mobile@example.com",
      // The connector tests run their MCP server on this machine.
      DC_ALLOW_PRIVATE_HOSTS: "1",
      // The Slack tests stand in for Slack on this machine too.
      DC_SLACK_API_URL: `${slack}/api`,
      // And for the service the Apps connector signs people in to.
      DC_APPS_URL: `${apps}/oauth/mcp`,
      // Where the tests sign the server itself in to a model provider, their owner may.
      ...(file.endsWith("models.spec.ts") ? { DC_ADMIN_EMAILS: "owner@example.com" } : {}),
      ...settings,
    },
  })
  child.stderr!.on("data", (chunk) => {
    errors += String(chunk)
    process.stderr.write(String(chunk).replace(/^(?=.)/gm, "[server] "))
  })
  const stop = () => {
    child.kill("SIGKILL")
    rmSync(data, { recursive: true, force: true })
  }
  // A worker that is cut short must not leave its server behind.
  process.once("exit", stop)

  const deadline = Date.now() + 30_000
  for (;;) {
    if (child.exitCode !== null) {
      stop()
      throw new Error(`The server stopped before it was ready. Is it built?\n${errors}`)
    }
    const up = await fetch(`${url}/api/health`).then(
      (response) => response.ok,
      () => false,
    )
    if (up) return { file, url, slack, apps, stop }
    if (Date.now() > deadline) {
      stop()
      throw new Error(`The server did not come up at ${url}.\n${errors}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

type WorkerFixtures = {
  servers: {
    for: (file: string) => Promise<string>
    /** The address a file's server calls Slack at, for a stand-in to listen on. */
    slackFor: (file: string) => Promise<string>
    /** The address a file's server takes the Apps connector to be at, for a stand-in to listen on. */
    appsFor: (file: string) => Promise<string>
  }
  /** Whether the agent's creature is drawn live. Set with `test.use` by the tests that are about it. */
  creature: boolean
  /** Settings of the deployment that a file's server is started with, over the ones every file gets. */
  settings: Record<string, string>
}

export const test = base.extend<object, WorkerFixtures>({
  // A row in the sidebar repeats the start of what its agent last said or was told, a moment
  // after it is said. A test that asks the page for some words means where they were said, so
  // the rows' own lines are left out of `page.getByText`: otherwise the same words are one
  // thing or two, by how fast the row caught up. A test about a row asks the row for its words.
  page: async ({ page }, use) => {
    const byText = page.getByText.bind(page)
    page.getByText = (text, options) =>
      byText(text, options).and(page.locator(":not([data-latest])"))
    await use(page)
  },
  creature: [false, { option: true, scope: "worker" }],
  settings: [{}, { option: true, scope: "worker" }],
  // The creature is drawn with WebGL, which a browser with no graphics card does in software: a
  // whole core's work for as long as a page is open. Without it the app shows the creature as a
  // still picture, which is all that most tests need of it.
  launchOptions: [
    async ({ launchOptions, creature }, use) => {
      const args = creature ? [] : ["--disable-webgl", "--disable-webgl2"]
      await use({ ...launchOptions, args: [...(launchOptions.args ?? []), ...args] })
    },
    { scope: "worker" },
  ],
  servers: [
    // Playwright reads what a fixture needs from this pattern, so it has to be one.
    async ({ settings }, use) => {
      let server: Server | undefined
      // A worker runs one file at a time. When it moves on to the next, that one starts clean.
      const serverFor = async (file: string) => {
        if (server?.file !== file) {
          server?.stop()
          server = await start(file, settings)
        }
        return server
      }
      await use({
        for: async (file) => (await serverFor(file)).url,
        slackFor: async (file) => (await serverFor(file)).slack,
        appsFor: async (file) => (await serverFor(file)).apps,
      })
      server?.stop()
    },
    { scope: "worker" },
  ],
  baseURL: async ({ servers }, use, testInfo) => {
    await use(await servers.for(testInfo.file))
  },
})

export { expect } from "@playwright/test"
