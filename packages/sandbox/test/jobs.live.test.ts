import { afterAll, describe, expect, it } from "vitest"
import { daytonaSandbox } from "../src/daytona/index.ts"
import { shellJobs } from "../src/index.ts"

/**
 * Jobs against a real Daytona machine: that a job outlives the call that started it, that a
 * second call reaches the machine while a first is waiting, and what following costs a quick
 * command. Skipped unless DAYTONA_API_KEY is set, because it creates a machine on that account
 * (and deletes it at the end).
 *
 *   DAYTONA_API_KEY=... pnpm exec vitest run test/jobs.live.test.ts
 */
const apiKey = process.env.DAYTONA_API_KEY ?? ""
const id = `live-jobs-${Date.now().toString(36)}`
const sandbox = daytonaSandbox({ id, apiKey })
const jobs = shellJobs(sandbox, "live")

describe.skipIf(apiKey === "")("jobs on daytona, for real", () => {
  afterAll(async () => {
    await sandbox.destroy?.()
  }, 120_000)

  it("answers for a quick command about as fast as a plain call", async () => {
    await sandbox.exec("true")
    const timed = async (run: () => Promise<unknown>) => {
      const started = Date.now()
      await run()
      return Date.now() - started
    }
    const plain = await timed(() => sandbox.exec("echo hi"))
    let done: Awaited<ReturnType<typeof jobs.start>> | undefined
    const followed = await timed(async () => {
      done = await jobs.start(
        { id: "quick", command: "echo hi; exit 3", lifeMs: 60_000 },
        { waitMs: 30_000, removeUnder: { bytes: 1000, lines: 10 } },
      )
    })
    console.log(`plain call ${plain} ms, as a job ${followed} ms`)
    expect(done).toMatchObject({ state: "exited", exitCode: 3, output: "hi\n", kept: false })
    expect(followed - plain < 1_000).toBe(true)
  }, 180_000)

  it("leaves a job running after the call that started it, and stops it from another call", async () => {
    const first = await jobs.start(
      { id: "slow", command: "echo one; sleep 4; echo two; sleep 600", lifeMs: 900_000 },
      { waitMs: 1_000 },
    )
    expect(first).toMatchObject({ state: "running", output: "one\n" })
    // A call that waits, and one made while it waits.
    const waiting = jobs.follow("slow", { from: first.next, waitMs: 60_000 })
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    expect((await jobs.check(["slow"])).slow).toMatchObject({ state: "running", size: 8 })
    const started = Date.now()
    await jobs.stop("slow")
    const ended = await waiting
    console.log(`stopped ${Date.now() - started} ms after asking`)
    expect(ended).toMatchObject({ state: "exited", output: "two\n" })
    expect(Date.now() - started < 15_000).toBe(true)
  }, 180_000)
})
