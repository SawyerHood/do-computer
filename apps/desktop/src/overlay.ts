import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { UseState } from "@do-computer/computers/use"
import { BrowserWindow, globalShortcut, type IpcMainEvent, ipcMain, screen } from "electron"
import type { OverlayAct, OverlayView } from "./pages/overlay.ts"

export type OverlayOptions = { state: UseState; pagesDir: string; preload: string }
export type Overlay = {
  /**
   * Put the agent's pointer at a place on the primary display, in that display's own points
   * from its top left; `click` makes it ripple. With no place, the pointer is taken away.
   */
  point(at: { x: number; y: number } | undefined, click: boolean): void
  /**
   * Say whether the agent is working behind what the owner has in front. Then the screen is
   * still theirs to use: there is no glow round it, and Esc stays their own key.
   */
  behind(on: boolean): void
  /** Whether the overlay turns up in pictures taken of the screen (true on Linux, where it cannot be kept out). */
  readonly inPictures: boolean
  dispose(): void
}

const LINUX = process.platform === "linux"
const MAC = process.platform === "darwin"

/** How often to look at whether the agent is still using the screen: that ends by the clock, unannounced. */
const LOOK_MS = 1_000
/** How far below the top of the usable screen the bar sits. */
const BAR_GAP = 16

type Pointer = { x: number; y: number }

/** What the page is to draw, from who is using the screen and where their pointer is. */
export function viewOf(
  state: Pick<UseState, "agent" | "say" | "held">,
  pointer: Pointer | undefined,
  ripples: number,
  place: { top: number; buttons: boolean; behind?: boolean },
): OverlayView | undefined {
  if (state.agent === undefined) return undefined
  return {
    agent: { name: state.agent.name, color: state.agent.color },
    ...(state.say === undefined ? {} : { say: state.say }),
    held: state.held,
    ...(pointer === undefined ? {} : { pointer }),
    ripples,
    ...place,
  }
}

/**
 * What the app draws on the computer while an agent uses its screen: one window over the whole
 * of the primary display, see-through and let through by the mouse, which is there for as long
 * as the screen is in use and is never the window being typed into.
 */
export function createOverlay(options: OverlayOptions): Overlay {
  const { state } = options
  let window: BrowserWindow | undefined
  /** True once the page in the window has asked what to draw. */
  let ready = false
  let pointer: Pointer | undefined
  let ripples = 0
  let behind = false
  let escape = false
  let looking: ReturnType<typeof setInterval> | undefined
  let disposed = false

  const alive = () => window !== undefined && !window.isDestroyed()

  /** Esc pauses the agent while it works, and is its owner's own key the rest of the time. */
  function takeEscape(take: boolean): void {
    if (take === escape) return
    if (take) {
      // Something else may have the key already. Then the bar is the way to pause.
      escape = globalShortcut.register("Escape", () => state.hold(true))
    } else {
      globalShortcut.unregister("Escape")
      escape = false
    }
  }

  /** Let clicks through to what is underneath, or keep them for the bar. */
  function takeClicks(take: boolean): void {
    if (!alive()) return
    // Linux cannot tell the page where the mouse is while clicks go through the window, so
    // there the window never takes one.
    if (take && !LINUX) window!.setIgnoreMouseEvents(false)
    else window!.setIgnoreMouseEvents(true, LINUX ? undefined : { forward: true })
  }

  function fit(): void {
    if (!alive()) return
    window!.setBounds(screen.getPrimaryDisplay().bounds)
    send()
  }

  function open(): BrowserWindow {
    if (alive()) return window!
    ready = false
    const made = new BrowserWindow({
      ...screen.getPrimaryDisplay().bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      roundedCorners: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // Without this macOS keeps a window below the menu bar, and the glow would stop short.
      enableLargerThanScreen: true,
      webPreferences: {
        preload: options.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    window = made
    made.setAlwaysOnTop(true, "screen-saver")
    made.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      // Left to itself, this takes the app out of the Dock while the window is there.
      skipTransformProcessType: true,
    })
    if (MAC) made.setHiddenInMissionControl(true)
    // Kept out of pictures of the screen, so that an agent sees the screen and not itself.
    made.setContentProtection(true)
    takeClicks(false)
    // The page is the app's own and goes nowhere else.
    made.webContents.on("will-navigate", (event) => event.preventDefault())
    made.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    made.on("closed", () => {
      if (window === made) window = undefined
    })
    void made.loadURL(pathToFileURL(join(options.pagesDir, "overlay.html")).href)
    return made
  }

  function send(): void {
    if (!alive() || !ready) return
    const { bounds, workArea } = screen.getPrimaryDisplay()
    const view = viewOf(state, pointer, ripples, {
      top: Math.max(0, workArea.y - bounds.y) + BAR_GAP,
      buttons: !LINUX,
      behind,
    })
    if (view !== undefined) window!.webContents.send("overlay:view", view)
  }

  /** Show what there is to show, or nothing where the screen is not in use. */
  function sync(): void {
    if (disposed) return
    if (!state.active) {
      takeEscape(false)
      clearInterval(looking)
      looking = undefined
      pointer = undefined
      behind = false
      if (alive()) {
        takeClicks(false)
        window!.hide()
      }
      return
    }
    // An Esc the agent presses is its own, and has to reach what it is typing into. One pressed
    // while the agent works behind what is in front is its owner's, at their own work.
    takeEscape(!behind && !state.held && !state.pressing)
    const shown = open()
    if (!shown.isVisible()) {
      shown.showInactive()
      // Some window managers forget this of a window that was hidden.
      shown.setAlwaysOnTop(true, "screen-saver")
    }
    looking ??= setInterval(() => {
      if (!state.active) sync()
    }, LOOK_MS)
    send()
  }

  const ours = (event: IpcMainEvent) => alive() && event.sender === window!.webContents
  const onReady = (event: IpcMainEvent) => {
    if (!ours(event)) return
    ready = true
    send()
  }
  const onOver = (event: IpcMainEvent, on: unknown) => {
    if (ours(event) && state.active) takeClicks(on === true)
  }
  const onAct = (event: IpcMainEvent, what: OverlayAct) => {
    if (!ours(event)) return
    if (what === "pause") state.hold(true)
    else if (what === "carry-on") state.hold(false)
    else if (what === "stop") state.stop()
  }
  ipcMain.on("overlay:ready", onReady)
  ipcMain.on("overlay:over", onOver)
  ipcMain.on("overlay:act", onAct)
  screen.on("display-metrics-changed", fit)
  // An agent that is let carry on is using the screen again only once it has woken, which is
  // a moment after the change is announced. So a change that seems to end the use is looked
  // at again when that moment has passed, and the window does not go and come back.
  const unwatch = state.onChange(() => {
    if (state.active) sync()
    else setTimeout(sync, 0)
  })
  sync()

  return {
    point(at, click) {
      if (disposed) return
      pointer = at === undefined ? undefined : { x: Math.round(at.x), y: Math.round(at.y) }
      if (click && at !== undefined) ripples += 1
      sync()
    },
    behind(on) {
      if (disposed || behind === on) return
      behind = on
      sync()
    },
    inPictures: LINUX,
    dispose() {
      if (disposed) return
      disposed = true
      unwatch()
      takeEscape(false)
      clearInterval(looking)
      ipcMain.off("overlay:ready", onReady)
      ipcMain.off("overlay:over", onOver)
      ipcMain.off("overlay:act", onAct)
      screen.off("display-metrics-changed", fit)
      if (alive()) window!.destroy()
      window = undefined
    },
  }
}
