import type { BrowserRan, LiveView, ScreenActed, UsingAgent } from "@durable-computer/protocol"
import { describe, expect, it } from "vitest"
import { fakeScreen } from "../src/fake-screen.ts"
import { type BrowserIO, DaemonCore, type DaemonIO, LinkCore, RemoteError } from "../src/index.ts"
import { UseRefused, UseState } from "../src/use.ts"

const pip: UsingAgent = { id: "agent-1", name: "Pip", color: "#5f8a4e" }

const io = (more: Partial<DaemonIO> = {}): DaemonIO & { audits: Record<string, unknown>[] } => {
  const audits: Record<string, unknown>[] = []
  const never = async () => {
    throw new Error("not used here")
  }
  return {
    audits,
    exec: never,
    statSize: never,
    readFile: never,
    writeFile: never,
    stat: never,
    list: never,
    realpath: never,
    mkdir: never,
    remove: never,
    rename: never,
    audit: (entry) => void audits.push(entry),
    ...more,
  }
}

/** A link and a daemon joined in memory. */
function wire(daemonIO: DaemonIO, options: { readOnly?: boolean } = {}) {
  const link: LinkCore = new LinkCore(
    (frame) => {
      queueMicrotask(() => daemon.onFrame(frame))
      return true
    },
    { useGraceMs: 200 },
  )
  const daemon: DaemonCore = new DaemonCore(
    daemonIO,
    (frame) => {
      queueMicrotask(() => link.onFrame(frame))
      return true
    },
    options,
  )
  return { link, daemon }
}

const click = { do: "click", x: 120, y: 80 } as const

describe("the screen of a paired computer", () => {
  it("does one thing and answers with how the screen looks afterwards", async () => {
    const daemonIO = io({ screen: fakeScreen() })
    const { link } = wire(daemonIO)
    const acted = (await link.use({
      t: "screen",
      op: "act",
      agent: pip,
      action: click,
      say: "Clicking the button",
    })) as ScreenActed
    expect(acted.pointer).toEqual({ x: 120, y: 80 })
    expect(acted.shot).toMatchObject({ mimeType: "image/png", width: 640, height: 400 })
    // A real picture, and not so large that it would not fit in one frame.
    expect(Buffer.from(acted.shot.data, "base64").subarray(1, 4).toString()).toBe("PNG")
    expect(daemonIO.audits[0]).toMatchObject({ kind: "screen", agent: "Pip", action: click })
  })

  it("shows nothing to someone watching until an agent is using it", async () => {
    const { link } = wire(io({ screen: fakeScreen() }))
    const before = (await link.use({ t: "screen", op: "view", after: 0, waitMs: 0 })) as LiveView
    expect(before).toEqual({ active: false, seq: 0 })

    await link.use({ t: "screen", op: "act", agent: pip, action: click, say: "Clicking" })
    const now = (await link.use({ t: "screen", op: "view", after: 0, waitMs: 0 })) as LiveView
    expect(now).toMatchObject({
      active: true,
      seq: 1,
      pointer: { x: 120, y: 80 },
      clicks: 1,
      say: "Clicking",
      agent: pip,
      held: false,
    })
    expect(now.shot?.mimeType).toBe("image/png")
  })

  it("keeps a paused agent waiting until it is let on, and says it is paused", async () => {
    const { link } = wire(io({ screen: fakeScreen() }))
    await link.use({ t: "screen", op: "act", agent: pip, action: click })
    await link.use({ t: "screen", op: "hold", held: true })
    let done = false
    const waiting = link
      .use({ t: "screen", op: "act", agent: pip, action: { do: "type", text: "hi" } })
      .then(() => void (done = true))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(done).toBe(false)
    const view = (await link.use({ t: "screen", op: "view", after: 0, waitMs: 0 })) as LiveView
    expect(view.held).toBe(true)

    await link.use({ t: "screen", op: "hold", held: false })
    await waiting
    expect(done).toBe(true)
  })

  it("says whose it is to switch on where there is none for agents", async () => {
    const { link } = wire(io())
    const refused = await link
      .use({ t: "screen", op: "act", agent: pip, action: click })
      .catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(RemoteError)
    expect((refused as RemoteError).code).toBe("refused")
    expect((refused as RemoteError).message).toMatch(/Do Computer app there, under This Computer/)
  })

  it("is looked at but not used on a computer that may only be read", async () => {
    const { link } = wire(io({ screen: fakeScreen() }), { readOnly: true })
    await expect(link.use({ t: "screen", op: "act", agent: pip, action: click })).rejects.toThrow(
      /read-only, so it will not use the screen/,
    )
    expect(await link.use({ t: "screen", op: "view", after: 0, waitMs: 0 })).toMatchObject({
      active: false,
    })
  })

  it("does not count someone watching as work the daemon has to finish", async () => {
    const { link, daemon } = wire(io({ screen: fakeScreen() }))
    await link.use({ t: "screen", op: "act", agent: pip, action: click })
    // Nothing newer will come: the question waits, and the daemon is free to restart meanwhile.
    const watching = link.use({ t: "screen", op: "view", after: 5, waitMs: 300 })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(daemon.busy).toBe(false)
    await watching
  })
})

describe("a browser on a paired computer", () => {
  const browser = (ran: Partial<BrowserRan> = {}): BrowserIO & { scripts: string[] } => {
    const scripts: string[] = []
    return {
      scripts,
      run: async (_agent, script) => {
        scripts.push(script)
        return { output: "Example Domain", shots: [], own: false, ...ran }
      },
      view: async (after) => ({ active: false, seq: after }),
      hold: async () => {},
      close: async () => {},
    }
  }

  it("runs a script and answers with what it printed", async () => {
    const theirs = browser({ url: "https://example.com/", own: true })
    const daemonIO = io({ browser: theirs })
    const { link } = wire(daemonIO)
    const ran = await link.use({ t: "browser", op: "run", agent: pip, script: "page.title()" })
    expect(ran).toMatchObject({ output: "Example Domain", url: "https://example.com/", own: true })
    expect(theirs.scripts).toEqual(["page.title()"])
    expect(daemonIO.audits[0]).toMatchObject({ kind: "browser", script: "page.title()" })
  })

  it("passes on, as a refusal, what a browser that was stopped says", async () => {
    const stopped = browser()
    stopped.run = async () => {
      throw new UseRefused("The person at the computer stopped you using the browser.")
    }
    const { link } = wire(io({ browser: stopped }))
    const refused = await link
      .use({ t: "browser", op: "run", agent: pip, script: "1" })
      .catch((error: unknown) => error)
    expect((refused as RemoteError).code).toBe("refused")
    expect((refused as RemoteError).message).toMatch(/stopped you/)
  })

  it("is not run on a computer that may only be read, or one whose owner said no", async () => {
    await expect(
      wire(io({ browser: browser() }), { readOnly: true }).link.use({
        t: "browser",
        op: "run",
        agent: pip,
        script: "1",
      }),
    ).rejects.toThrow(/read-only/)
    await expect(
      wire(io()).link.use({ t: "browser", op: "run", agent: pip, script: "1" }),
    ).rejects.toThrow(/does not let agents use a browser/)
  })
})

describe("who is using a screen", () => {
  it("counts as in use for a while after the last thing done, and then no longer", async () => {
    let now = 1_000
    const state = new UseState({ what: "the screen", now: () => now })
    expect(state.active).toBe(false)
    await state.enter(pip, "Clicking")
    expect(state.active).toBe(true)
    now += 44_000
    expect(state.active).toBe(true)
    now += 2_000
    expect(state.active).toBe(false)
  })

  it("stays in use for as long as it is paused", async () => {
    let now = 1_000
    const state = new UseState({ what: "the screen", now: () => now })
    await state.enter(pip, undefined)
    state.hold(true)
    now += 10 * 60_000
    expect(state.active).toBe(true)
  })

  it("fails what a stopped agent is doing, and what it tries straight afterwards", async () => {
    let now = 1_000
    const state = new UseState({ what: "the screen", now: () => now })
    await state.enter(pip, undefined)
    state.hold(true)
    const waiting = state.enter(pip, "Typing")
    state.stop()
    await expect(waiting).rejects.toBeInstanceOf(UseRefused)
    expect(state.active).toBe(false)
    await expect(state.enter(pip, "Typing again")).rejects.toThrow(/stopped you using the screen/)
    // A minute on, it may be asked again.
    now += 61_000
    await state.enter(pip, "Typing")
    expect(state.active).toBe(true)
  })

  it("tells an agent that stays paused that it is, and does not keep it for ever", async () => {
    const state = new UseState({ what: "the browser", heldWaitMs: 80 })
    state.hold(true)
    await expect(state.enter(pip, undefined)).rejects.toThrow(
      /paused you before you could use the browser/,
    )
  })

  it("says so whenever something about it changes", async () => {
    const state = new UseState({ what: "the screen" })
    let changes = 0
    const stop = state.onChange(() => changes++)
    await state.enter(pip, "Clicking")
    state.hold(true)
    state.hold(true)
    state.hold(false)
    stop()
    state.touch()
    expect(changes).toBe(3)
  })
})
