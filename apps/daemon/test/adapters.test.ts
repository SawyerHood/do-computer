import { PassThrough } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { selectScreen, selectBrowser, adapterStatus, screenRefusal } from "../src/adapters/index.ts"
import { linuxDriver, keys } from "../src/adapters/linux.ts"
import { nativeScreen } from "../src/adapters/native-screen.ts"
import { appScreen } from "../src/screen.ts"
import { parseCall } from "../src/events.ts"
import type { Command } from "../src/adapters/command.ts"
import type { Layout, PointerStep } from "../src/adapters/wayland-pointer.ts"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)
const agent = { id: "test", name: "Test", color: "#123456" }
function machine() {
  const env = {
    PATH: "/usr/bin",
    WAYLAND_DISPLAY: "wayland-1",
    XDG_RUNTIME_DIR: "/run/user/1000",
    XDG_SESSION_ID: "3",
    HYPRLAND_INSTANCE_SIGNATURE: "test",
  }
  const state = {
    locked: false,
    active: true,
    uid: 1000,
    dpms: true,
    type: "wayland",
    transform: 0,
    x: 10,
    monitor: "DP-1",
    sessionLocked: false,
  }
  const calls: { file: string; args: string[]; input?: string }[] = []
  const run: Command = async (file, args, options) => {
    options?.signal?.throwIfAborted()
    calls.push({ file, args, input: options?.input })
    if (file === "loginctl")
      return Buffer.from(
        `User=${state.uid}\nType=${state.type}\nActive=${state.active ? "yes" : "no"}\nLockedHint=${state.locked ? "yes" : "no"}\n`,
      )
    if (file === "hyprctl" && args.includes("monitors"))
      return Buffer.from(
        JSON.stringify([
          {
            name: state.monitor,
            focused: true,
            x: state.x,
            y: 20,
            width: 200,
            height: 100,
            scale: 2,
            dpmsStatus: state.dpms,
            transform: state.transform,
            solitaryBlockedBy: state.sessionLocked ? ["LOCK", "WINDOWED"] : ["WINDOWED"],
          },
        ]),
      )
    if (file === "xdotool" && args[0] === "getdisplaygeometry") return Buffer.from("200 100")
    if (file === "xset") return Buffer.from(`Monitor is ${state.dpms ? "On" : "Off"}`)
    if (file === "grim" || file === "import") return png
    return Buffer.from("ok")
  }
  const pointed: { socket: string; layout: Layout; steps: readonly PointerStep[] }[] = []
  const pointer = async (socket: string, layout: Layout, steps: readonly PointerStep[]) => {
    pointed.push({ socket, layout, steps })
  }
  return {
    env,
    state,
    calls,
    pointed,
    run,
    linux: { run, uid: 1000, has: async () => true, pointer },
  }
}

describe("adapter selection and permission", () => {
  it("never enables screen access just because a session exists", async () => {
    const m = machine()
    const selected = await selectScreen({
      enabled: false,
      embedded: false,
      env: m.env,
      platform: "linux",
      linux: m.linux,
    })
    expect(selected.report).toMatchObject({ adapter: "hyprland", enabled: false })
    expect(selected.screen).toBeUndefined()
    expect(m.calls.every((c) => ["loginctl", "hyprctl"].includes(c.file))).toBe(true)
    expect(adapterStatus(selected.report).state).toBe("disabled")
  })
  it("diagnoses a disabled adapter without capturing or injecting input", async () => {
    const m = machine()
    const selected = await selectScreen({
      enabled: false,
      embedded: false,
      env: m.env,
      platform: "linux",
      linux: m.linux,
    })
    expect(selected.report).toMatchObject({ available: true, ready: true, enabled: false })
    expect(selected.screen).toBeUndefined()
    expect(m.calls.every((c) => ["loginctl", "hyprctl"].includes(c.file))).toBe(true)
  })
  it("selects Hyprland after opt-in", async () => {
    const m = machine()
    const selected = await selectScreen({
      enabled: true,
      embedded: false,
      env: m.env,
      platform: "linux",
      linux: m.linux,
    })
    expect(selected.report).toMatchObject({ adapter: "hyprland", available: true, ready: true })
    expect(selected.screen).toBeDefined()
    selected.dispose()
  })
  it("does not fall back to XWayland when Wayland discovery is blocked", async () => {
    const selected = await selectScreen({
      enabled: true,
      embedded: false,
      env: { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" },
      platform: "linux",
      linux: {
        uid: 1000,
        has: async () => false,
        run: async () => {
          throw new Error("No logind")
        },
      },
    })
    expect(selected.report.adapter).not.toBe("x11")
    expect(adapterStatus(selected.report).state).toBe("unsupported")
    expect(selected.report.reason).toBeTruthy()
  })
  it("reports installed backends but a blocked state when no graphical session exists", async () => {
    const selected = await selectScreen({
      enabled: true,
      embedded: false,
      env: {},
      platform: "linux",
      linux: { uid: 1000, has: async () => true, run: async () => Buffer.alloc(0) },
    })
    expect(adapterStatus(selected.report)).toMatchObject({ name: "auto", state: "blocked" })
    expect(selected.report.reason).toContain("Installed adapters: hyprland, x11")
    expect(selected.report.tools).toEqual(
      expect.arrayContaining(["grim", "wtype", "hyprctl", "xdotool"]),
    )
    expect(selected.screen).toBeUndefined()
    selected.dispose()
  })
  it("honors explicit none even with a usable session", async () => {
    const m = machine()
    const selected = await selectScreen({
      enabled: true,
      adapter: "none",
      embedded: false,
      env: m.env,
    })
    expect(selected.screen).toBeUndefined()
    expect(selected.report.enabled).toBe(false)
    expect(selected.report.reason).toMatch(/explicitly disabled/)
  })
  it("does not treat a forced IPC adapter as proof of a parent", async () => {
    const selected = await selectScreen({ enabled: true, adapter: "ipc", embedded: false, env: {} })
    expect(selected.screen).toBeUndefined()
    expect(selected.report.reason).toMatch(/requires a desktop-app parent/)
  })
  it("reports missing dependencies without changing the selected backend", async () => {
    const m = machine()
    const selected = await selectScreen({
      enabled: true,
      adapter: "hyprland",
      embedded: false,
      env: m.env,
      platform: "linux",
      linux: { ...m.linux, has: async (file) => file !== "wtype" },
    })
    expect(selected.report).toMatchObject({ adapter: "hyprland", available: false })
    expect(adapterStatus(selected.report).state).toBe("unsupported")
    expect(selected.report.reason).toMatch(/Missing wtype/)
    expect(selected.screen).toBeUndefined()
  })
  it("reports blocked, not unsupported, when session verification is unavailable", async () => {
    const m = machine()
    const selected = await selectScreen({
      enabled: true,
      adapter: "hyprland",
      embedded: false,
      env: m.env,
      platform: "linux",
      linux: {
        ...m.linux,
        run: async () => {
          throw new Error("session bus unavailable")
        },
      },
    })
    expect(adapterStatus(selected.report).state).toBe("blocked")
    expect(screenRefusal(selected.report)).toMatch(/available but currently blocked/)
    expect(screenRefusal({ ...selected.report, available: true, enabled: false })).toMatch(
      /does not let Doods use its screen.*disabled by its owner.*--screen=auto/,
    )
    expect(screenRefusal({ ...selected.report, available: false })).toMatch(/unsupported here/)
    expect(screenRefusal({ ...selected.report, available: false })).not.toMatch(
      /in the desktop app/,
    )
    selected.dispose()
  })
  it("bounds even a metadata transport that ignores cancellation", async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const m = machine()
    try {
      const pending = selectScreen({
        enabled: true,
        adapter: "hyprland",
        embedded: false,
        env: m.env,
        platform: "linux",
        linux: {
          ...m.linux,
          run: (_file, _args, options) => {
            signals.push(options!.signal!)
            return new Promise(() => {})
          },
        },
      })
      await vi.advanceTimersByTimeAsync(20_001)
      const selected = await pending
      expect(adapterStatus(selected.report).state).toBe("blocked")
      expect(selected.report.reason).toMatch(/timed out/)
      expect(signals.length).toBeGreaterThan(0)
      expect(signals.every((signal) => signal.aborted)).toBe(true)
      selected.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
  it("keeps the browser independent of any display session", () => {
    const selected = selectBrowser({ enabled: true, dir: "/tmp/not-started-by-probe", log() {} })
    expect(selected.report).toMatchObject({
      adapter: "dev-browser",
      enabled: true,
      available: true,
    })
    expect(selected.browser).toBeDefined()
    expect(
      selectBrowser({ enabled: false, dir: "/tmp/not-started-by-probe", log() {} }).browser,
    ).toBeUndefined()
  })
})

describe("native session safety and coordinates", () => {
  it("refuses root and another user's session", async () => {
    const m = machine()
    await expect(
      linuxDriver("hyprland", { ...m.linux, env: m.env, uid: 0 }).probe(),
    ).rejects.toThrow(/non-root/)
    m.state.uid = 2000
    await expect(linuxDriver("hyprland", { ...m.linux, env: m.env }).probe()).rejects.toThrow(
      /does not belong/,
    )
  })
  it("does not permanently disable a locked adapter; it recovers after the owner unlocks", async () => {
    const m = machine()
    m.state.locked = true
    const selected = await selectScreen({
      enabled: true,
      embedded: false,
      env: m.env,
      platform: "linux",
      linux: m.linux,
    })
    expect(selected.report).toMatchObject({ available: true, ready: false })
    expect(adapterStatus(selected.report).state).toBe("blocked")
    await expect(selected.screen!.act(agent, { do: "screenshot" }, undefined)).rejects.toThrow(
      /locked/,
    )
    expect(m.calls.some((c) => c.file === "grim")).toBe(false)
    m.state.locked = false
    await selected.refresh!()
    expect(adapterStatus(selected.report).state).toBe("ready")
    expect(m.calls.some((c) => c.file === "grim")).toBe(false)
    expect((await selected.screen!.act(agent, { do: "screenshot" }, undefined)).shot?.width).toBe(1)
    selected.dispose()
  })
  it("never wakes a sleeping monitor by default or injects input into it", async () => {
    const m = machine()
    m.state.dpms = false
    const driver = linuxDriver("hyprland", { ...m.linux, env: m.env })
    await expect(
      driver.act({ do: "key", keys: "enter" }, new AbortController().signal),
    ).rejects.toThrow(/asleep/)
    expect(m.calls.some((c) => c.file === "wtype" || c.args.includes("dispatch"))).toBe(false)
  })
  it("wakes only after explicit opt-in and never during a probe or through a lock", async () => {
    const m = machine()
    m.state.dpms = false
    const driver = linuxDriver("hyprland", {
      ...m.linux,
      env: m.env,
      wakeDisplay: true,
      run: async (file, args, options) => {
        if (file === "hyprctl" && args.includes("dpms")) m.state.dpms = true
        return m.run(file, args, options)
      },
    })
    await expect(driver.probe()).rejects.toThrow(/asleep/)
    expect(m.calls.some((c) => c.args.includes("dpms"))).toBe(false)
    await driver.act({ do: "key", keys: "enter" }, new AbortController().signal)
    expect(m.calls.filter((c) => c.args.includes("dpms")).map((c) => c.args)).toEqual([
      ["dispatch", "dpms", "on DP-1"],
    ])
    m.calls.length = 0
    m.state.locked = true
    m.state.dpms = false
    await expect(
      driver.act({ do: "key", keys: "enter" }, new AbortController().signal),
    ).rejects.toThrow(/locked/)
    expect(m.calls.some((c) => c.args.includes("dpms") || c.file === "wtype")).toBe(false)
  })
  it("can opt in to waking X11 without bypassing session checks", async () => {
    const m = machine()
    m.state.type = "x11"
    m.state.dpms = false
    const driver = linuxDriver("x11", {
      ...m.linux,
      env: { DISPLAY: ":0", XDG_SESSION_ID: "3" },
      wakeDisplay: true,
      run: async (file, args, options) => {
        if (file === "xset" && args[0] === "dpms") m.state.dpms = true
        return m.run(file, args, options)
      },
    })
    await expect(driver.probe()).rejects.toThrow(/asleep/)
    await driver.capture(new AbortController().signal)
    expect(m.calls.some((c) => c.args.join(" ") === "dpms force on")).toBe(true)
  })
  it("refuses an unverifiable lock state before capture", async () => {
    const m = machine()
    const driver = linuxDriver("hyprland", {
      ...m.linux,
      env: m.env,
      run: async (file, args, options) => {
        const result = await m.run(file, args, options)
        return file === "loginctl"
          ? Buffer.from(result.toString().replace("LockedHint=no", "LockedHint="))
          : result
      },
    })
    await expect(driver.capture(new AbortController().signal)).rejects.toThrow(/lock state/)
    expect(m.calls.some((c) => c.file === "grim")).toBe(false)
  })
  it("refuses incomplete session bindings on every operation, not just during probing", async () => {
    const m = machine()
    const driver = linuxDriver("hyprland", {
      ...m.linux,
      env: { ...m.env, WAYLAND_DISPLAY: undefined },
      wakeDisplay: true,
    })
    await expect(driver.capture(new AbortController().signal)).rejects.toThrow(
      /requires WAYLAND_DISPLAY/,
    )
    await expect(
      driver.act({ do: "key", keys: "enter" }, new AbortController().signal),
    ).rejects.toThrow(/requires WAYLAND_DISPLAY/)
    expect(m.calls).toEqual([])
    const selected = await selectScreen({
      enabled: true,
      adapter: "hyprland",
      embedded: false,
      env: { ...m.env, WAYLAND_DISPLAY: undefined, XDG_RUNTIME_DIR: "/nonexistent-test-runtime" },
      platform: "linux",
      linux: m.linux,
    })
    expect(selected.rediscover).toBe(true)
    expect(adapterStatus(selected.report).state).toBe("blocked")
    await expect(selected.screen!.act(agent, { do: "screenshot" }, undefined)).rejects.toThrow(
      /requires WAYLAND_DISPLAY/,
    )
    expect(m.calls.some((c) => c.file === "grim")).toBe(false)
    selected.dispose()
  })
  it("rejects rotated outputs rather than guessing coordinates", async () => {
    const m = machine()
    m.state.transform = 1
    await expect(linuxDriver("hyprland", { ...m.linux, env: m.env }).probe()).rejects.toThrow(
      /Rotated/,
    )
  })
  it("maps screenshot pixels to scaled output coordinates and rejects stale geometry", async () => {
    const m = machine()
    const screen = nativeScreen(linuxDriver("hyprland", { ...m.linux, env: m.env }))
    await expect(screen.act(agent, { do: "click", x: 0, y: 0 }, undefined)).rejects.toThrow(
      /screenshot/,
    )
    await screen.act(agent, { do: "screenshot" }, undefined)
    await screen.act(agent, { do: "click", x: 0.5, y: 0.5 }, undefined)
    expect(m.pointed.at(-1)).toEqual({
      socket: "/run/user/1000/wayland-1",
      layout: { x: 10, y: 20, width: 100, height: 50 },
      steps: [
        { do: "move", x: 60, y: 45 },
        { do: "button", button: "left", pressed: true },
        { do: "button", button: "left", pressed: false },
      ],
    })
    m.state.x = 11
    await expect(screen.act(agent, { do: "click", x: 0, y: 0 }, undefined)).rejects.toThrow(
      /geometry changed/,
    )
    await expect(screen.act(agent, { do: "click", x: NaN, y: 0 }, undefined)).rejects.toThrow()
    screen.dispose()
  })
  it("keeps watching private while no agent is using the screen", async () => {
    const m = machine()
    const screen = nativeScreen(linuxDriver("hyprland", { ...m.linux, env: m.env }))
    expect(await screen.view(0, 0)).toMatchObject({ active: false })
    expect(m.calls).toEqual([])
    await expect(
      screen.act(agent, { do: "in_window", window: 1, act: { do: "screenshot" } }, undefined),
    ).rejects.toThrow(/whole-screen/)
    screen.dispose()
  })
  it("passes typed text on stdin, never through a shell or as command options", async () => {
    const m = machine()
    const text = "--key ctrl+a; $(touch should-not-run)"
    await linuxDriver("hyprland", { ...m.linux, env: m.env }).act(
      { do: "type", text },
      new AbortController().signal,
    )
    expect(m.calls.find((c) => c.file === "wtype")).toEqual({
      file: "wtype",
      args: ["-"],
      input: text,
    })
    expect(() => keys("ctrl+--evil")).toThrow()
  })
  it("drags with the button held across real motion, in one pointer connection", async () => {
    const m = machine()
    const driver = linuxDriver("hyprland", { ...m.linux, env: m.env })
    await driver.act({ do: "drag", x: 10, y: 20, toX: 70, toY: 50 }, new AbortController().signal)
    expect(m.pointed).toHaveLength(1)
    const steps = m.pointed[0]!.steps.filter((step) => step.do !== "wait")
    expect(steps[0]).toEqual({ do: "move", x: 10, y: 20 })
    expect(steps[1]).toEqual({ do: "button", button: "left", pressed: true })
    expect(steps.at(-1)).toEqual({ do: "button", button: "left", pressed: false })
    expect(steps.at(-2)).toEqual({ do: "move", x: 70, y: 50 })
    // Intermediate motion while held, not a warp.
    expect(steps.filter((step) => step.do === "move").length).toBeGreaterThan(5)
  })
  it("double-clicks within one connection and scrolls by wheel notches", async () => {
    const m = machine()
    const driver = linuxDriver("hyprland", { ...m.linux, env: m.env })
    await driver.act({ do: "double_click", x: 30, y: 30 }, new AbortController().signal)
    const presses = m.pointed[0]!.steps.filter((step) => step.do === "button" && step.pressed)
    expect(presses).toHaveLength(2)
    const waits = m.pointed[0]!.steps.flatMap((step) => (step.do === "wait" ? [step.ms] : []))
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThan(200)
    await driver.act(
      { do: "scroll", x: 30, y: 30, direction: "up", amount: 2 },
      new AbortController().signal,
    )
    expect(m.pointed[1]!.steps.filter((step) => step.do === "scroll")).toEqual([
      { do: "scroll", axis: "vertical", notches: -1 },
      { do: "scroll", axis: "vertical", notches: -1 },
    ])
    expect(m.calls.some((c) => c.file === "wlrctl")).toBe(false)
  })
  it("refuses a Hyprland session that Hyprland reports locked, whatever logind says", async () => {
    const m = machine()
    m.state.sessionLocked = true
    const driver = linuxDriver("hyprland", { ...m.linux, env: m.env })
    await expect(driver.probe()).rejects.toThrow(/locked/)
    await expect(driver.capture(new AbortController().signal)).rejects.toThrow(/locked/)
    await expect(
      driver.act({ do: "type", text: "hunter2" }, new AbortController().signal),
    ).rejects.toThrow(/locked/)
    expect(m.calls.some((c) => c.file === "wtype" || c.file === "grim")).toBe(false)
    expect(m.pointed).toEqual([])
  })
  it("wakes a monitor with the Lua dispatcher on Hyprland with a Lua config", async () => {
    const m = machine()
    m.state.dpms = false
    const driver = linuxDriver("hyprland", {
      ...m.linux,
      env: m.env,
      wakeDisplay: true,
      run: async (file, args, options) => {
        if (file === "hyprctl" && args[0] === "dispatch") {
          m.calls.push({ file, args })
          if (args[1] === "dpms") return Buffer.from("error: ')' expected near 'on'")
          m.state.dpms = true
          return Buffer.from("ok")
        }
        return m.run(file, args, options)
      },
    })
    await driver.capture(new AbortController().signal)
    expect(m.calls.filter((c) => c.args[0] === "dispatch").map((c) => c.args[1])).toEqual([
      "dpms",
      'hl.dsp.dpms({ action = "on", monitor = "DP-1" })',
    ])
  })
  it("releases an X11 drag button after a failure without hiding the failure", async () => {
    const m = machine()
    m.state.type = "x11"
    const env = { PATH: "/usr/bin", DISPLAY: ":0", XDG_SESSION_ID: "3" }
    const driver = linuxDriver("x11", {
      ...m.linux,
      env,
      run: async (file, args, options) => {
        if (args[0] === "mousemove" && args.includes("20")) throw new Error("movement failed")
        if (args[0] === "mouseup") {
          m.calls.push({ file, args })
          throw new Error("release failed too")
        }
        return m.run(file, args, options)
      },
    })
    await expect(
      driver.act({ do: "drag", x: 0, y: 0, toX: 20, toY: 30 }, new AbortController().signal),
    ).rejects.toThrow(/movement failed/)
    expect(m.calls.some((c) => c.args[0] === "mouseup")).toBe(true)
    await driver.act({ do: "double_click", x: 5, y: 5 }, new AbortController().signal)
    expect(m.calls.filter((c) => c.args[0] === "click").at(-1)?.args).toEqual([
      "click",
      "--repeat",
      "2",
      "--delay",
      "60",
      "1",
    ])
  })
  it("supports X11 separately and refuses XWayland", async () => {
    const m = machine()
    m.state.type = "x11"
    const env = { PATH: "/usr/bin", DISPLAY: ":0", XDG_SESSION_ID: "3" }
    const driver = linuxDriver("x11", { ...m.linux, env })
    await driver.probe()
    await driver.act({ do: "key", keys: "ctrl+enter" }, new AbortController().signal)
    expect(m.calls.some((c) => c.args.join(" ") === "key --clearmodifiers ctrl+Return")).toBe(true)
    await expect(
      linuxDriver("x11", { ...m.linux, env: { ...env, WAYLAND_DISPLAY: "wayland-0" } }).probe(),
    ).rejects.toThrow(/XWayland/)
    m.state.dpms = false
    await expect(driver.capture(new AbortController().signal)).rejects.toThrow(/asleep/)
  })
})

describe("native lifecycle", () => {
  it("waits for a picture newer than the watcher's and captures only when one is due", async () => {
    const m = machine()
    const screen = nativeScreen(linuxDriver("hyprland", { ...m.linux, env: m.env }))
    const grims = () => m.calls.filter((c) => c.file === "grim").length
    await screen.act(agent, { do: "screenshot" }, undefined)
    expect(grims()).toBe(1)
    // Newer than what the watcher has: returned at once, no capture.
    expect(await screen.view(0, 5_000)).toMatchObject({ active: true, seq: 1 })
    // Nothing newer and no time to wait: the same picture, still no capture.
    expect(await screen.view(1, 0)).toMatchObject({ seq: 1 })
    expect(grims()).toBe(1)
    // Two watchers waiting share one capture, taken when it is due.
    const started = Date.now()
    const [a, b] = await Promise.all([screen.view(1, 5_000), screen.view(1, 5_000)])
    expect(a.seq).toBe(2)
    expect(b.seq).toBe(2)
    expect(grims()).toBe(2)
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
    // An action's picture wakes a waiting watcher early.
    const waiting = screen.view(2, 5_000)
    await screen.act(agent, { do: "screenshot" }, undefined)
    expect((await waiting).seq).toBe(3)
    expect(grims()).toBe(3)
    screen.dispose()
  })
  it("serializes actions and does not run queued work after disposal", async () => {
    const m = machine()
    const started = Promise.withResolvers<void>()
    const driver = linuxDriver("hyprland", { ...m.linux, env: m.env })
    let captures = 0
    const screen = nativeScreen({
      ...driver,
      capture: (signal) => {
        captures++
        started.resolve()
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        )
      },
    })
    const first = expect(screen.act(agent, { do: "screenshot" }, undefined)).rejects.toThrow(
      /stopped/,
    )
    const second = expect(screen.act(agent, { do: "screenshot" }, undefined)).rejects.toThrow(
      /stopped/,
    )
    await started.promise
    expect(captures).toBe(1)
    screen.dispose()
    await Promise.all([first, second])
    expect(captures).toBe(1)
    expect(await screen.view(0, 0)).toMatchObject({ active: false })
  })
  it("validates scrolling before moving the pointer", async () => {
    const m = machine()
    await expect(
      linuxDriver("hyprland", { ...m.linux, env: m.env }).act(
        { do: "scroll", x: 1, y: 1, direction: "down", amount: -1 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/Invalid scroll/)
    expect(m.calls).toEqual([])
  })
})

describe("versioned and bounded app IPC", () => {
  it("requires the app to confirm its protocol and permission", async () => {
    const input = new PassThrough()
    const ipc = appScreen((line) => {
      const call = parseCall(line)!
      input.write(
        JSON.stringify({ id: call.id, value: { protocolVersion: 1, screen: true } }) + "\n",
      )
    }, input)
    await ipc.probe()
    ipc.dispose()
    expect(input.listenerCount("data")).toBe(0)
  })
  it.each([
    { protocolVersion: 2, screen: true },
    { protocolVersion: 1, screen: "yes" },
    { protocolVersion: 1, screen: true, available: "maybe" },
    { protocolVersion: 1, screen: false, reason: {} },
  ])("rejects malformed or incompatible parent replies", async (value) => {
    const input = new PassThrough()
    const ipc = appScreen(
      (line) => input.write(JSON.stringify({ id: parseCall(line)!.id, value }) + "\n"),
      input,
    )
    await expect(ipc.probe()).rejects.toThrow(/IPC/)
    ipc.dispose()
    expect(input.isPaused()).toBe(true)
  })
  it("does not fall back when the app explicitly disabled sharing", async () => {
    const input = new PassThrough()
    const ipc = appScreen(
      (line) =>
        input.write(
          JSON.stringify({
            id: parseCall(line)!.id,
            value: { protocolVersion: 1, screen: false },
          }) + "\n",
        ),
      input,
    )
    await expect(ipc.probe()).rejects.toThrow(/disabled/)
    ipc.dispose()
  })
  it.each([
    'The screen has no "hello".',
    "Unknown request",
    "Das Bildschirm-Protokoll kennt hello nicht",
  ])(
    "takes a released app's ordinary error for hello as on, whatever it says (%s)",
    async (message) => {
      const input = new PassThrough()
      const ops: string[] = []
      const ipc = appScreen((line) => {
        const call = parseCall(line)!
        ops.push(call.op)
        input.write(JSON.stringify({ id: call.id, error: { refused: false, message } }) + "\n")
      }, input)
      expect(await ipc.inspect()).toEqual({ available: true, enabled: true, legacy: true })
      await ipc.probe()
      // No screenshot is taken to find out.
      expect(ops).toEqual(["hello", "hello"])
      ipc.dispose()
    },
  )
  it("takes a refusal of hello as the app saying no", async () => {
    const input = new PassThrough()
    const ipc = appScreen((line) => {
      const call = parseCall(line)!
      input.write(
        JSON.stringify({
          id: call.id,
          error: { refused: true, message: "This computer does not let Doods use its screen." },
        }) + "\n",
      )
    }, input)
    expect(await ipc.inspect()).toMatchObject({ available: true, enabled: false })
    ipc.dispose()
  })
  it("does not wait for the desktop app before the daemon can connect", async () => {
    const input = new PassThrough()
    const printed: string[] = []
    const selected = await selectScreen({
      enabled: true,
      adapter: "ipc",
      embedded: true,
      env: {},
      input,
      print: (line) => printed.push(line),
    })
    // Selected and usable at once, as before the handshake existed; nothing asked yet.
    expect(printed).toEqual([])
    expect(selected.screen).toBeDefined()
    expect(adapterStatus(selected.report).state).toBe("ready")
    selected.dispose()
  })
  it("distinguishes an unavailable app driver from owner permission", async () => {
    const input = new PassThrough()
    const selected = await selectScreen({
      enabled: true,
      adapter: "ipc",
      embedded: true,
      env: {},
      input,
      print: (line) =>
        input.write(
          JSON.stringify({
            id: parseCall(line)!.id,
            value: {
              protocolVersion: 1,
              available: false,
              screen: false,
              reason: "No screen driver on this platform.",
            },
          }) + "\n",
        ),
    })
    await selected.refresh?.()
    expect(adapterStatus(selected.report)).toMatchObject({
      name: "ipc",
      state: "unsupported",
      reason: "No screen driver on this platform.",
    })
    expect(selected.report.enabled).toBe(false)
    selected.dispose()
  })
  it("cannot confuse a late answer with a replacement adapter's handshake", async () => {
    const input = new PassThrough()
    const printed: string[] = []
    const first = appScreen((line) => printed.push(line), input, { probeTimeoutMs: 5 })
    await expect(first.probe()).rejects.toThrow(/in time/)
    const oldId = parseCall(printed[0]!)!.id
    first.dispose()
    const second = appScreen((line) => {
      const id = parseCall(line)!.id
      expect(id).not.toBe(oldId)
      input.write(JSON.stringify({ id: oldId, value: { protocolVersion: 1, screen: true } }) + "\n")
      input.write(JSON.stringify({ id, value: { protocolVersion: 1, screen: false } }) + "\n")
    }, input)
    await expect(second.probe()).rejects.toThrow(/disabled/)
    second.dispose()
  })
  it("times out a missing parent and rejects pending calls on EOF", async () => {
    const input = new PassThrough()
    const ipc = appScreen(() => {}, input, { probeTimeoutMs: 5, timeoutMs: 50 })
    await expect(ipc.probe()).rejects.toThrow(/in time/)
    const pending = expect(ipc.act(agent, { do: "screenshot" }, undefined)).rejects.toThrow(
      /closed/,
    )
    input.end()
    await pending
    await expect(ipc.hold(true)).rejects.toThrow(/closed/)
    ipc.dispose()
  })
  it("cleans up when printing a request fails", async () => {
    const input = new PassThrough()
    const ipc = appScreen(() => {
      throw new Error("parent gone")
    }, input)
    await expect(ipc.hold(true)).rejects.toThrow(/parent gone/)
    ipc.dispose()
  })
})
