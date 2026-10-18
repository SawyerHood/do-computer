import type {
  BrowserRan,
  LiveView,
  PayWith,
  ScreenActed,
  ScreenWindow,
  SignInWith,
  UsingAgent,
} from "@do-computer/protocol"
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
    expect(Buffer.from(acted.shot!.data, "base64").subarray(1, 4).toString()).toBe("PNG")
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
    expect((refused as RemoteError).message).toMatch(/--enable-screen.*--doctor/)
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

describe("the windows on the screen of a paired computer", () => {
  const notes: ScreenWindow = {
    id: 11,
    app: "Notes",
    title: "Shopping",
    width: 400,
    height: 300,
    shown: true,
  }
  const calculator: ScreenWindow = {
    id: 12,
    app: "Calculator",
    title: "Calculator",
    width: 230,
    height: 408,
    shown: false,
  }
  const act = (link: LinkCore, action: Parameters<ReturnType<typeof fakeScreen>["act"]>[1]) =>
    link.use({ t: "screen", op: "act", agent: pip, action }) as Promise<ScreenActed>
  const view = (link: LinkCore) =>
    link.use({ t: "screen", op: "view", after: 0, waitMs: 0 }) as Promise<LiveView>

  it("are listed, the ones that cannot be seen too, with no picture", async () => {
    const daemonIO = io({ screen: fakeScreen() })
    const { link } = wire(daemonIO)
    expect(await act(link, { do: "windows" })).toEqual({ windows: [notes, calculator] })
    expect(daemonIO.audits[0]).toMatchObject({ kind: "screen", action: { do: "windows" } })
  })

  it("gain one for an app that is opened, which is answered with a picture of it", async () => {
    const { link } = wire(io({ screen: fakeScreen() }))
    const safari = { id: 22, app: "Safari", title: "Safari", width: 320, height: 240, shown: true }
    const opened = await act(link, { do: "open", app: "Safari" })
    expect(opened.window).toEqual(safari)
    expect(opened.windows).toEqual([safari])
    // The picture is of the window, at the window's own size.
    expect(opened.shot).toMatchObject({ mimeType: "image/png", width: 320, height: 240 })
    expect(opened.pointer).toBeUndefined()
    // The newest is the nearest the front.
    expect((await act(link, { do: "windows" })).windows).toEqual([safari, notes, calculator])
  })

  it("are worked in one at a time, and answer with how that window looks", async () => {
    const daemonIO = io({ screen: fakeScreen() })
    const { link } = wire(daemonIO)
    const inNotes = { do: "in_window", window: 11, act: click } as const
    const acted = await act(link, inNotes)
    expect(acted.window).toEqual(notes)
    expect(acted.pointer).toEqual({ x: 120, y: 80 })
    expect(acted.shot).toMatchObject({ mimeType: "image/png", width: 400, height: 300 })
    expect(Buffer.from(acted.shot!.data, "base64").subarray(1, 4).toString()).toBe("PNG")
    expect(daemonIO.audits[0]).toMatchObject({ kind: "screen", agent: "Pip", action: inNotes })

    // One that cannot be seen on the screen is worked in all the same.
    const hidden = await act(link, { do: "in_window", window: 12, act: { do: "screenshot" } })
    expect(hidden.window).toEqual(calculator)
    expect(hidden.shot).toMatchObject({ width: 230, height: 408 })
    // The pointer was in the other window, and is nowhere in this one yet.
    expect(hidden.pointer).toBeUndefined()

    // Text may come with the place to click first, and the keyboard is then there.
    const typed = await act(link, {
      do: "in_window",
      window: 12,
      act: { do: "type", text: "42", x: 30, y: 60 },
    })
    expect(typed.pointer).toEqual({ x: 30, y: 60 })
  })

  it("says so where there is no such window", async () => {
    const { link } = wire(io({ screen: fakeScreen() }))
    await expect(act(link, { do: "in_window", window: 99, act: click })).rejects.toThrow(
      /There is no window 99 on this computer now\. Ask for `windows`/,
    )
  })

  it("will not drag in one behind what is in front, and will once it is brought forward", async () => {
    const { link } = wire(io({ screen: fakeScreen() }))
    const drag = { do: "drag", x: 10, y: 20, toX: 200, toY: 150 } as const
    const refused = await act(link, { do: "in_window", window: 11, act: drag }).catch(
      (error: unknown) => error,
    )
    expect(refused).toBeInstanceOf(RemoteError)
    expect((refused as RemoteError).message).toMatch(/could not be done behind what is in front/)
    expect((refused as RemoteError).message).toMatch(
      /Nothing was done\. Do it again with `in_front: true`/,
    )
    // Nothing was: the pointer has been nowhere.
    expect((await act(link, { do: "screenshot" })).pointer).toBeUndefined()

    const acted = await act(link, { do: "in_window", window: 11, inFront: true, act: drag })
    expect(acted.window).toEqual(notes)
    expect(acted.pointer).toEqual({ x: 200, y: 150 })
    // On the whole screen a drag is done as it always was.
    expect((await act(link, drag)).pointer).toEqual({ x: 200, y: 150 })
  })

  it("show someone watching the window being worked in, by its name", async () => {
    const { link } = wire(io({ screen: fakeScreen() }))
    await act(link, { do: "in_window", window: 11, act: click })
    const inWindow = await view(link)
    expect(inWindow).toMatchObject({
      active: true,
      title: "Notes: Shopping",
      pointer: { x: 120, y: 80 },
      clicks: 1,
    })
    expect(inWindow.shot).toMatchObject({ width: 400, height: 300 })

    // Listing the windows leaves it where it was.
    await act(link, { do: "windows" })
    expect((await view(link)).title).toBe("Notes: Shopping")

    // Back on the whole screen there is no window to name.
    await act(link, { do: "screenshot" })
    const whole = await view(link)
    expect(whole).not.toHaveProperty("title")
    expect(whole).not.toHaveProperty("pointer")
    expect(whole.shot).toMatchObject({ width: 640, height: 400 })
  })
})

describe("a browser on a paired computer", () => {
  const browser = (
    ran: Partial<BrowserRan> = {},
  ): BrowserIO & { scripts: string[]; logins: SignInWith[]; paid: unknown[] } => {
    const scripts: string[] = []
    const logins: SignInWith[] = []
    const paid: unknown[] = []
    return {
      scripts,
      logins,
      paid,
      pay: async (_agent, card, { fields, button }) => {
        paid.push({ card, fields, button })
        return { outcome: "sent", message: "Paid.", site: "shop.example", typed: true, own: false }
      },
      run: async (_agent, script) => {
        scripts.push(script)
        return { output: "Example Domain", shots: [], own: false, ...ran }
      },
      front: async () => ({ url: "https://example.com/login", title: "Sign in", own: false }),
      signIn: async (_agent, login) => {
        logins.push(login)
        return {
          outcome: "signed_in",
          message: "Signed in to example.com.",
          site: "example.com",
          own: false,
        }
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

  it("is told whether to have a window only where the call says", async () => {
    const asked: (boolean | undefined)[] = []
    const theirs = browser()
    theirs.run = async (_agent, _script, options) => {
      asked.push(options.shown)
      return { output: "", shots: [], own: false }
    }
    const { link } = wire(io({ browser: theirs }))
    await link.use({ t: "browser", op: "run", agent: pip, script: "1" })
    await link.use({ t: "browser", op: "run", agent: pip, script: "1", shown: true })
    await link.use({ t: "browser", op: "run", agent: pip, script: "1", shown: false })
    expect(asked).toEqual([undefined, true, false])
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
    ).rejects.toThrow(/does not let Doods use a browser/)
  })

  const login: SignInWith = {
    name: "Example",
    username: "pip@example.com",
    password: "correct horse battery staple",
    sites: ["example.com"],
  }

  it("says which page is in front", async () => {
    const { link } = wire(io({ browser: browser() }))
    expect(await link.use({ t: "browser", op: "front" })).toEqual({
      url: "https://example.com/login",
      title: "Sign in",
      own: false,
    })
  })

  it("signs in with a login, and writes down its name and nothing else of it", async () => {
    const theirs = browser()
    const daemonIO = io({ browser: theirs })
    const { link } = wire(daemonIO)
    const went = await link.use({ t: "browser", op: "sign_in", agent: pip, login })
    expect(went).toMatchObject({ outcome: "signed_in", site: "example.com" })
    expect(theirs.logins).toEqual([login])
    expect(daemonIO.audits).toHaveLength(1)
    expect(daemonIO.audits[0]).toEqual({
      ts: expect.any(Number),
      kind: "browser_sign_in",
      agent: "Pip",
      login: "Example",
    })
    expect(JSON.stringify(daemonIO.audits)).not.toContain(login.password)
  })

  it("says nothing of why where signing in threw, which could be made of what was typed", async () => {
    const theirs = browser()
    theirs.signIn = async (_agent, given) => {
      throw new Error(`could not type ${given.password}`)
    }
    const daemonIO = io({ browser: theirs })
    const { link } = wire(daemonIO)
    const went = await link.use({ t: "browser", op: "sign_in", agent: pip, login })
    expect(went).toEqual({
      outcome: "failed",
      message: 'This computer could not sign in with the login "Example".',
      own: false,
    })
    expect(JSON.stringify(daemonIO.audits)).not.toContain(login.password)

    theirs.signIn = async () => {
      throw new UseRefused("The person at the computer stopped you using the browser.")
    }
    await expect(link.use({ t: "browser", op: "sign_in", agent: pip, login })).rejects.toThrow(
      /stopped you/,
    )
  })

  it("does not sign in on a computer that may only be read, or with a login that is not whole", async () => {
    const theirs = browser()
    const readOnly = io({ browser: theirs })
    await expect(
      wire(readOnly, { readOnly: true }).link.use({
        t: "browser",
        op: "sign_in",
        agent: pip,
        login,
      }),
    ).rejects.toThrow(/read-only/)
    expect(readOnly.audits).toEqual([
      { ts: expect.any(Number), kind: "refused", what: "use a browser" },
    ])
    const daemonIO = io({ browser: theirs })
    await expect(
      wire(daemonIO).link.use({
        t: "browser",
        op: "sign_in",
        agent: pip,
        login: { ...login, sites: undefined } as never,
      }),
    ).rejects.toThrow(/needs an agent and a login/)
    expect(theirs.logins).toEqual([])
    expect(daemonIO.audits).toEqual([])
  })

  const card: PayWith = {
    name: "Team card",
    holder: "Pip Example",
    number: "4242424242424242",
    expMonth: 8,
    expYear: 2028,
    code: "737",
    postalCode: "94107",
  }
  const pay = { t: "browser", op: "pay", agent: pip, card, button: "Pay now" } as const

  it("pays with a card, and writes down its name and last four digits and nothing else of it", async () => {
    const theirs = browser()
    const daemonIO = io({ browser: theirs })
    const { link } = wire(daemonIO)
    const fields = [{ box: "Email", text: "pip@example.com" }]
    expect(await link.use({ ...pay, fields })).toMatchObject({ outcome: "sent" })
    expect(theirs.paid).toEqual([{ card, fields, button: "Pay now" }])
    expect(daemonIO.audits).toEqual([
      {
        ts: expect.any(Number),
        kind: "browser_pay",
        agent: "Pip",
        card: "Team card",
        last4: "4242",
      },
    ])
    // Without anything else to fill in there is none.
    await link.use(pay)
    expect(theirs.paid[1]).toEqual({ card, fields: [], button: "Pay now" })
  })

  it("says nothing of why where paying threw, which could be made of the card", async () => {
    const theirs = browser()
    theirs.pay = async (_agent, given) => {
      throw new Error(`could not type ${given.number} ${given.code}`)
    }
    const daemonIO = io({ browser: theirs })
    const { link } = wire(daemonIO)
    expect(await link.use(pay)).toEqual({
      outcome: "failed",
      message: 'This computer could not pay with the card "Team card".',
      own: false,
    })
    expect(JSON.stringify(daemonIO.audits)).not.toContain(card.number)
    theirs.pay = async () => {
      throw new UseRefused("The person at the computer stopped you using the browser.")
    }
    await expect(link.use(pay)).rejects.toThrow(/stopped you/)
  })

  it("does not pay on a computer that may only be read, or with a frame that is not whole", async () => {
    const theirs = browser()
    const readOnly = io({ browser: theirs })
    await expect(wire(readOnly, { readOnly: true }).link.use(pay)).rejects.toThrow(/read-only/)
    expect(readOnly.audits).toEqual([
      { ts: expect.any(Number), kind: "refused", what: "use a browser" },
    ])
    const daemonIO = io({ browser: theirs })
    const { link } = wire(daemonIO)
    for (const broken of [
      { card: { ...card, expYear: "2028" } },
      { card: { ...card, code: undefined } },
      { card: undefined },
      { button: " " },
      { button: undefined },
      { fields: [{ box: "Email" }] },
      { fields: "Email" },
      { fields: Array.from({ length: 21 }, () => ({ box: "a", text: "b" })) },
      { agent: undefined },
    ]) {
      await expect(link.use({ ...pay, ...broken } as never)).rejects.toThrow(/pay needs/)
    }
    expect(theirs.paid).toEqual([])
    expect(daemonIO.audits).toEqual([])
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
