import {
  BrowserWindow,
  type IpcMainEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  screen,
} from "electron"
import {
  areasOf,
  boundsOf,
  BOX,
  inAny,
  isId,
  isPetPage,
  keepOn,
  PET,
  petAddress,
  type PetInfo,
  type Place,
  placeOf,
  type Point,
  type Rect,
  startAt,
} from "./companion-place.ts"

export type CompanionOptions = {
  /** The script the window is given. */
  preload: string
  /** The deployment whose page it shows. */
  server(): string | undefined
  /** The agent its owner chose for it, and where they last put it. */
  agent(): string | undefined
  at(): Point | undefined
  /** Keep what its owner chose. */
  remember(change: { companionAgent?: string; companionAt?: Point }): void
  /** The agents there are to choose from, for whoever is signed in. */
  agents(): Promise<{ id: string; name: string }[]>
  /** Open the app on an agent, at one of its chats if given. */
  open(agentId: string, chatId?: string): void
  /** Its owner asked, from its own menu, for it to go. */
  dismiss(): void
}

export type Companion = {
  /** Put it on the desktop, or take it off. */
  show(on: boolean): void
  /**
   * Take it off for the time being, and put it back. While an agent uses the screen it is in
   * the way, and while the screen is locked nobody sees it: a window that is not showing
   * draws nothing. It is back once none of the reasons it went for still holds.
   */
  away(why: "screen" | "locked", on: boolean): void
  /** Load its page again: the deployment changed, or who is signed in. */
  reload(): void
  dispose(): void
}

const LINUX = process.platform === "linux"
const MAC = process.platform === "darwin"

/** How often the pointer is looked for: where the creature looks, and whether a click is its own. */
const LOOK_MS = 33
/** How often while it is carried, which is as often as it is drawn. */
const CARRY_MS = 16
/** How long after its page could not be loaded it is tried again. */
const RETRY_MS = 30_000

/**
 * An agent's companion on the desktop: one small window, see-through, over every other window
 * and on every desktop, that is never the window being typed into. Where the page draws
 * nothing, clicks go through to whatever is under it. It is shown once its page has something
 * to show, which it has not while nobody is signed in.
 */
export function createCompanion(options: CompanionOptions): Companion {
  let window: BrowserWindow | undefined
  let wanted = false
  const away = new Set<string>()
  let disposed = false
  /** Where the creature's square is on the screen, and which corner of the window that is. */
  let at: Point = { x: 0, y: 0 }
  let place: Place = { x: "right", y: "bottom" }
  /** The parts of the window the page says are something, measured from its top left. */
  let areas: Rect[] = []
  /** While it is carried: how far the pointer is from the corner of its square. */
  let carried: Point | undefined
  /** Whether clicks are the window's own just now. */
  let taking = false
  let showing: string | undefined
  let looking: ReturnType<typeof setInterval> | undefined
  let lookEvery = 0
  let pointer = ""
  let retry: ReturnType<typeof setTimeout> | undefined

  const alive = () => window !== undefined && !window.isDestroyed()

  const workAreaAt = (point: Point) =>
    screen.getDisplayNearestPoint({ x: point.x + BOX / 2, y: point.y + BOX / 2 }).workArea

  /** Put the square where it is said to be, on a screen, with what it says on the side there is room. */
  function settle(to: Point | undefined): void {
    const workArea = to === undefined ? screen.getPrimaryDisplay().workArea : workAreaAt(to)
    at = keepOn(to ?? startAt(workArea), workArea)
    const next = placeOf(at, workArea)
    const moved = next.x !== place.x || next.y !== place.y
    place = next
    if (!alive()) return
    window!.setBounds(boundsOf(at, place))
    if (moved) window!.webContents.send(PET.place, place)
  }

  /** Keep clicks for the window, or let them through to what is under it. */
  function take(on: boolean): void {
    if (LINUX || on === taking || !alive()) return
    taking = on
    window!.setIgnoreMouseEvents(!on)
  }

  function look(): void {
    if (!alive()) return
    const cursor = screen.getCursorScreenPoint()
    if (carried !== undefined) {
      at = { x: cursor.x - carried.x, y: cursor.y - carried.y }
      window!.setBounds(boundsOf(at, place))
    }
    const bounds = window!.getBounds()
    const local = { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
    const now = `${local.x},${local.y}`
    if (now !== pointer) {
      pointer = now
      window!.webContents.send(PET.pointer, local)
    }
    take(carried !== undefined || inAny(local, areas))
  }

  function watch(every: number): void {
    if (every === lookEvery) return
    clearInterval(looking)
    lookEvery = every
    looking = every === 0 ? undefined : setInterval(look, every)
  }

  /** Show the window if there is something in it to show, and its owner wants it now. */
  function sync(): void {
    if (!alive()) return watch(0)
    const on = wanted && away.size === 0 && areas.length > 0
    if (!on) {
      carried = undefined
      take(false)
      watch(0)
      if (window!.isVisible()) window!.hide()
      return
    }
    if (!window!.isVisible()) {
      window!.showInactive()
      // Some window managers forget this of a window that was hidden.
      window!.setAlwaysOnTop(true, "floating")
    }
    watch(carried === undefined ? LOOK_MS : CARRY_MS)
  }

  function load(): void {
    clearTimeout(retry)
    const server = options.server()
    if (!alive() || server === undefined) return
    areas = []
    sync()
    void window!.loadURL(petAddress(server)).catch(() => {})
  }

  function open(): void {
    if (alive() || options.server() === undefined) return
    place = { x: "right", y: "bottom" }
    settle(options.at())
    const made = new BrowserWindow({
      ...boundsOf(at, place),
      title: "Do Computer Companion",
      show: false,
      // Until it is shown its page is not showing, and draws nothing. Left to itself a window
      // that starts hidden tells its page otherwise.
      paintWhenInitiallyHidden: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      roundedCorners: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // Without this macOS keeps a window below the menu bar, and one put by it would jump.
      enableLargerThanScreen: true,
      webPreferences: {
        preload: options.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    window = made
    made.setAlwaysOnTop(true, "floating")
    made.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      // Left to itself, this takes the app out of the Dock while the window is there.
      skipTransformProcessType: true,
    })
    if (MAC) made.setHiddenInMissionControl(true)
    taking = true
    take(false)
    // The page is the deployment's companion and goes nowhere else.
    made.webContents.on("will-navigate", (event, address) => {
      if (!isPetPage(address, options.server())) event.preventDefault()
    })
    made.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    made.webContents.on("did-fail-load", (_event, code, _text, _url, isMainFrame) => {
      // -3 is a load that was replaced by another, which is no failure.
      if (!isMainFrame || code === -3) return
      areas = []
      sync()
      clearTimeout(retry)
      retry = setTimeout(load, RETRY_MS)
    })
    made.webContents.on("render-process-gone", () => {
      clearTimeout(retry)
      retry = setTimeout(load, RETRY_MS)
    })
    made.on("closed", () => {
      if (window === made) window = undefined
      watch(0)
    })
    load()
  }

  function close(): void {
    clearTimeout(retry)
    watch(0)
    carried = undefined
    areas = []
    if (alive()) window!.destroy()
    window = undefined
  }

  /** It is put down: kept on a screen, with what it says turned to where there is room for it. */
  function drop(): void {
    if (carried === undefined) return
    carried = undefined
    settle(at)
    options.remember({ companionAt: at })
    sync()
  }

  async function menu(): Promise<void> {
    const agents = await options.agents().catch(() => [])
    if (!alive()) return
    const shown = showing
    const name = agents.find((agent) => agent.id === shown)?.name
    const choices: MenuItemConstructorOptions[] = agents.map((agent) => ({
      label: agent.name,
      type: "radio",
      checked: agent.id === shown,
      click: () => {
        options.remember({ companionAgent: agent.id })
        if (alive()) window!.webContents.send(PET.agent, agent.id)
      },
    }))
    Menu.buildFromTemplate([
      {
        label: name === undefined ? "Open Do Computer" : `Open ${name}`,
        enabled: shown !== undefined,
        click: () => shown !== undefined && options.open(shown),
      },
      ...(choices.length > 1 ? [{ type: "separator" } as const, ...choices] : []),
      { type: "separator" },
      { label: "Hide Companion", click: () => options.dismiss() },
    ]).popup({ window: window! })
  }

  /** Whether whoever speaks is the companion's page itself, on the deployment. */
  const ours = (event: IpcMainEvent): boolean => {
    const frame = event.senderFrame
    if (!alive() || event.sender !== window!.webContents) return false
    if (frame === null || frame.isDestroyed() || frame.parent !== null) return false
    return isPetPage(frame.url, options.server())
  }
  const onInfo = (event: IpcMainEvent) => {
    const agent = options.agent()
    const info: PetInfo = { ...(agent === undefined ? {} : { agent }), box: BOX, place }
    event.returnValue = ours(event) ? info : null
  }
  const onShowing = (event: IpcMainEvent, agentId: unknown) => {
    if (ours(event) && isId(agentId)) showing = agentId
  }
  const onAreas = (event: IpcMainEvent, said: unknown) => {
    if (!ours(event)) return
    areas = areasOf(said)
    // Linux cannot tell a see-through window where the mouse is while clicks go through it,
    // so there the window is cut to the shape of what is in it.
    if (LINUX && areas.length > 0) window!.setShape(areas)
    sync()
  }
  const onDrag = (event: IpcMainEvent, on: unknown) => {
    if (!ours(event)) return
    if (on !== true) return drop()
    if (carried !== undefined || !window!.isVisible()) return
    const cursor = screen.getCursorScreenPoint()
    carried = { x: cursor.x - at.x, y: cursor.y - at.y }
    sync()
  }
  const onOpen = (event: IpcMainEvent, agentId: unknown, chatId: unknown) => {
    if (!ours(event) || !isId(agentId)) return
    options.open(agentId, isId(chatId) ? chatId : undefined)
  }
  const onMenu = (event: IpcMainEvent) => {
    if (ours(event)) void menu()
  }
  /** A screen came or went, or changed size: it is kept on one. */
  const fit = () => {
    if (alive() && carried === undefined) settle(at)
  }
  ipcMain.on(PET.info, onInfo)
  ipcMain.on(PET.showing, onShowing)
  ipcMain.on(PET.areas, onAreas)
  ipcMain.on(PET.drag, onDrag)
  ipcMain.on(PET.open, onOpen)
  ipcMain.on(PET.menu, onMenu)
  screen.on("display-metrics-changed", fit)
  screen.on("display-removed", fit)

  return {
    show(on) {
      if (disposed) return
      wanted = on
      if (on) open()
      else close()
      sync()
    },
    away(why, on) {
      if (disposed || away.has(why) === on) return
      if (on) away.add(why)
      else away.delete(why)
      sync()
    },
    reload() {
      if (disposed) return
      if (wanted && !alive()) open()
      else load()
    },
    dispose() {
      if (disposed) return
      disposed = true
      ipcMain.off(PET.info, onInfo)
      ipcMain.off(PET.showing, onShowing)
      ipcMain.off(PET.areas, onAreas)
      ipcMain.off(PET.drag, onDrag)
      ipcMain.off(PET.open, onOpen)
      ipcMain.off(PET.menu, onMenu)
      screen.off("display-metrics-changed", fit)
      screen.off("display-removed", fit)
      close()
    },
  }
}
