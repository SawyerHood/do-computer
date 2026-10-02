import { afterAll, describe, expect, it } from "vitest"
import { daytonaName, daytonaSandbox } from "../src/daytona/index.ts"
import { registerSandboxConformance } from "../src/testing.ts"

/**
 * The same checks as every other sandbox, against a real Daytona machine. Skipped unless
 * DAYTONA_API_KEY is set, because it creates a machine on that account (and deletes it at the end).
 *
 *   DAYTONA_API_KEY=... pnpm exec vitest run test/daytona.live.test.ts
 */
const apiKey = process.env.DAYTONA_API_KEY ?? ""
const live = apiKey !== ""
const id = `live-test-${Date.now().toString(36)}`
const open = () => daytonaSandbox({ id, apiKey })

describe.skipIf(!live)("daytona, for real", () => {
  afterAll(async () => {
    await open().destroy?.()
  }, 120_000)

  it("creates the machine on first use", async () => {
    const result = await open().exec("uname -s && whoami && pwd")
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("Linux")
    expect(result.output).toContain("/home/daytona")
  }, 180_000)

  registerSandboxConformance(
    {
      describe,
      it: (name, body) => it(name, body, 120_000),
      expect,
    },
    "daytona (live)",
    async () => open(),
  )

  it("comes back with its files after being stopped", async () => {
    const sandbox = open()
    await sandbox.exec("echo survived > /home/daytona/stop-test.txt")
    // Stop it the way Daytona does when it has been idle.
    const { Daytona } = await import("@daytona/sdk")
    const client = new Daytona({ apiKey })
    const machine = await client.get(daytonaName(id))
    await client.stop(machine)
    expect((await client.get(daytonaName(id))).state).toBe("stopped")

    // A fresh handle, as after the server restarted, and the same one, as when it did not.
    expect((await open().exec("cat /home/daytona/stop-test.txt")).output).toBe("survived\n")
    await client.stop(await client.get(daytonaName(id)))
    expect((await sandbox.exec("cat /home/daytona/stop-test.txt")).output).toBe("survived\n")
  }, 300_000)

  it("is gone after destroy, and destroying again is fine", async () => {
    await open().destroy?.()
    const { Daytona } = await import("@daytona/sdk")
    await expect(new Daytona({ apiKey }).get(daytonaName(id))).rejects.toThrow()
    await open().destroy?.()
  }, 120_000)
})
