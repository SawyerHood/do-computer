import { describe, expect, it } from "vitest"
import { shellJobs } from "../src/index.ts"
import { createLocalProcessSandbox } from "../src/testing.ts"

const open = () => {
  const sandbox = createLocalProcessSandbox()
  return { sandbox, jobs: shellJobs(sandbox, "agent/1") }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("jobs on a machine with a shell", () => {
  it("answers for a quick command as a plain call would, and leaves nothing behind", async () => {
    const { sandbox, jobs } = open()
    let streamed = ""
    const done = await jobs.start(
      { id: "a", command: "echo out; echo err >&2; pwd; exit 3", lifeMs: 60_000 },
      {
        waitMs: 10_000,
        onOutput: (text) => (streamed += text),
        removeUnder: { bytes: 1000, lines: 100 },
      },
    )
    expect(done).toEqual({
      state: "exited",
      exitCode: 3,
      timedOut: false,
      output: `out\nerr\n${sandbox.home}\n`,
      next: `out\nerr\n${sandbox.home}\n`.length,
      kept: false,
    })
    expect(streamed).toBe(done.output)
    expect(await sandbox.fs.stat(jobs.log("a"))).toBe(undefined)
  })

  it("runs where it is told, with the variables it is given", async () => {
    const { sandbox, jobs } = open()
    await sandbox.fs.mkdir(`${sandbox.home}/sub dir`, { recursive: false })
    const done = await jobs.start(
      {
        id: "a",
        command: 'echo "$GREETING from $(basename "$PWD")"',
        cwd: `${sandbox.home}/sub dir`,
        env: { GREETING: "it's" },
        lifeMs: 60_000,
      },
      { waitMs: 10_000 },
    )
    expect(done.output).toBe("it's from sub dir\n")
  })

  it("leaves a slow command running when the wait ends, to be followed from where it was", async () => {
    const { jobs } = open()
    const first = await jobs.start(
      { id: "slow", command: "echo one; sleep 1; echo two", lifeMs: 60_000 },
      { waitMs: 200 },
    )
    expect(first).toEqual({ state: "running", output: "one\n", next: 4, kept: true })
    expect((await jobs.check(["slow"])).slow).toEqual({ state: "running", size: 4 })
    const rest = await jobs.follow("slow", { from: first.next, waitMs: 10_000 })
    expect(rest).toEqual({
      state: "exited",
      exitCode: 0,
      timedOut: false,
      output: "two\n",
      next: 8,
      kept: true,
    })
    expect((await jobs.check(["slow"])).slow).toEqual({
      state: "exited",
      exitCode: 0,
      timedOut: false,
      size: 8,
    })
  })

  it("stops a job and what it started", async () => {
    const { sandbox, jobs } = open()
    const started = await jobs.start(
      { id: "s", command: "sleep 300 & echo $! > child; wait", lifeMs: 600_000 },
      { waitMs: 300 },
    )
    expect(started.state).toBe("running")
    const child = (await sandbox.exec("cat child")).output.trim()
    await jobs.stop("s")
    const ended = await jobs.follow("s", { from: 0, waitMs: 10_000 })
    expect(ended.state).toBe("exited")
    expect((await sandbox.exec(`kill -0 ${child}`)).exitCode).not.toBe(0)
  })

  it("stops a job at its time limit and says that is what happened", async () => {
    const { jobs } = open()
    const ended = await jobs.start(
      { id: "t", command: "echo begun; sleep 30", lifeMs: 1_000 },
      { waitMs: 10_000 },
    )
    expect(ended).toMatchObject({
      state: "exited",
      exitCode: 124,
      timedOut: true,
      output: "begun\n",
    })
  })

  it("calls a job lost when it is neither running nor ended", async () => {
    const { sandbox, jobs } = open()
    await jobs.start({ id: "l", command: "sleep 300", lifeMs: 600_000 }, { waitMs: 100 })
    // What a machine that restarted looks like: the folder is there and nothing is running.
    const folder = jobs.log("l").replace("/output.log", "")
    await sandbox.exec(`kill -KILL $(cat ${folder}/pid); kill -KILL $(cat ${folder}/tpid)`)
    await sleep(200)
    expect((await jobs.check(["l", "never"])).l).toEqual({ state: "lost", size: 0 })
    expect((await jobs.check(["never"])).never).toEqual({ state: "lost", size: 0 })
    await jobs.remove(["l"])
    expect(await sandbox.fs.stat(jobs.log("l"))).toBe(undefined)
  })

  it("keeps the trailer out of what it passes on, however the output is cut up", async () => {
    const { jobs } = open()
    const done = await jobs.start(
      { id: "m", command: "printf 'a\\n<<job:not-it>> 1 1 running\\nb'", lifeMs: 60_000 },
      { waitMs: 10_000 },
    )
    expect(done.output).toBe("a\n<<job:not-it>> 1 1 running\nb")
    expect(done.state).toBe("exited")
  })
})
