/**
 * Do Computer on the desktop. Two things in one program:
 *
 * - The app, in a window of its own. The window shows the deployment, as a browser would, so
 *   there is no second user interface to keep up with the first.
 * - The daemon that lets agents work on this computer. It runs for as long as the program
 *   does, which is until its owner quits it from the tray: closing the window only hides it.
 *
 * The few pages that are the program's own (choosing the deployment, and how this computer is
 * shared) are files that come with it.
 *
 * The deployment can be the program's own as well: Do Computer run by it, on this computer, for
 * its owner alone. Then it is a third thing, the server, for as long as it runs.
 */
import { spawn } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  nativeTheme,
  net,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron"
import { autoUpdater } from "electron-updater"
import { ownBrowserAccess } from "@do-computer/computers/chrome"
import { UseState } from "@do-computer/computers/use"
import {
  CONNECTOR_BROWSER_PATH,
  CONNECTOR_CALLBACK_PATH,
  CONNECTOR_FROM_APP,
} from "@do-computer/protocol"
import { toQR } from "toqr"
import type { AppState, DeviceLink } from "./api.ts"
import { HIDDEN_FLAG, setLinuxAutostart } from "./autostart.ts"
import { browserConnect, browserSignIn } from "./browser-sign-in.ts"
import { withContextMenu } from "./context-menu.ts"
import { cookieDetails } from "./cookies.ts"
import { DaemonRunner, seedDaemon } from "./daemon.ts"
import { LocalServer, localAddress, ownerKey, pickPort, serverEnv } from "./local-server.ts"
import { loginPath } from "./login-path.ts"
import { createOverlay, type Overlay } from "./overlay.ts"
import {
  CHANNELS,
  computerName,
  iconFits,
  iconPicture,
  mayUseBridge,
  type HereAnswer,
  ownerName,
  type PageInfo,
  pairedAs,
  provider,
  type ScreenAnswer,
  screenRefusal,
  type ShareAnswer,
  shareAnswer,
  sharingNow,
  type SignInAnswer,
  TRAY_SIDE,
  trayFits,
  trayPictures,
} from "./page-bridge.ts"
import { ScreenService } from "./screen.ts"
import { cuaDriver, driverMissing, fakeDriver, type ScreenDriver } from "./screen-driver.ts"
import { atServer, cameBack, isWebAddress, onServer, serverAddress } from "./server.ts"
import { DEFAULTS, loadSettings, type Settings, saveSettings } from "./settings.ts"
import { headline, type Sharing } from "./status.ts"
import {
  findTailscale,
  serve,
  type Tailnet,
  tailnet as lookAtTailnet,
  tailnetAddress,
  unserve,
} from "./tailscale.ts"
import {
  afterUpdate,
  mayRestart,
  returningUnseen,
  type Update,
  type UpdateEvent,
} from "./update.ts"

/** The deployment the app was built for, if it was built for one. Otherwise it asks. */
declare const DEFAULT_SERVER: string

const NAME = "Do Computer"
/** How long a deployment has to say that it is one, when its address is entered. */
const HEALTH_TIMEOUT_MS = 10_000
/** How long the daemon has to get as far as a pairing, when a page asked to share this computer. */
const SHARE_TIMEOUT_MS = 45_000
/** How often the app looks for a newer one of itself. It runs for weeks without being started. */
const UPDATE_EVERY_MS = Number(process.env.DC_DESKTOP_UPDATE_MS ?? 4 * 60 * 60_000)
/** How often an app that has fetched a newer one looks whether it may restart as it. */
const RESTART_LOOK_MS = 60_000
/** How often an app whose server was to be served over Tailscale, and is not, looks again. */
const TAILNET_LOOK_MS = 60_000
const MAC = process.platform === "darwin"
/**
 * Whether the deployment's window is made with no title bar: on a Mac, where the page runs to
 * the top of the window and the window's three buttons lie over its corner. Said of another
 * desktop only by the tests.
 */
const NO_TITLE_BAR = MAC || process.env.DC_DESKTOP_TITLE_BAR === "inset"
/** Where the window's three buttons are, over a column of faces made wide enough for them. */
const TRAFFIC_LIGHTS = { x: 12, y: 20 }
/** As tall as a title bar: where a page that made no room for one is dragged by. */
const DRAG_STRIP =
  "html::before{content:'';position:fixed;top:0;left:0;right:0;height:28px;z-index:2147483647;-webkit-app-region:drag}"
const here = (...parts: string[]) => path.join(__dirname, ...parts)
const page = (name: string) => here("pages", `${name}.html`)

// A graphics card that is reset twice in a few seconds has Chromium refuse 3D to the page for
// as long as the app runs. A browser says so and offers to load the page again; here nothing
// would, and the agents' creatures would be flat pictures until the app was quit.
app.disableDomainBlockingFor3DAPIs()

// A run with a folder of its own: the tests', or a second copy beside the first.
if (process.env.DC_DESKTOP_DATA) app.setPath("userData", process.env.DC_DESKTOP_DATA)
else app.setName(NAME)

const settingsFile = () => path.join(app.getPath("userData"), "settings.json")
let settings: Settings = { ...DEFAULTS }
const remember = (change: Partial<Settings>) => {
  settings = { ...settings, ...change }
  saveSettings(settingsFile(), settings)
}

let mainWindow: BrowserWindow | undefined
let computerWindow: BrowserWindow | undefined
let welcomeWindow: BrowserWindow | undefined
let devicesWindow: BrowserWindow | undefined
/** Do Computer itself, while the app runs it on this computer. */
let localServer: LocalServer | undefined
/** How this computer stands with Tailscale, as of the last look. */
let tailnetNow: Tailnet = { state: "missing" }
/** The address the app's own server is reached at from its owner's other devices, while it is. */
let reachedAt: string | undefined
/** Why it is not reached from them though it was asked to be. */
let tailnetProblem: string | undefined
let tailnetBusy = false
let tray: Tray | undefined
let runner: DaemonRunner | undefined
let screenService: ScreenService | undefined
let screenDriver: ScreenDriver | undefined
let overlay: Overlay | undefined
/** Whether an agent is using the screen, once one could be. */
let usingScreen: UseState | undefined
let quitting = false
/** Whether there is a newer app than this one. Until it has looked, it is as new as it knows. */
let update: Update = { state: "current" }
/** The PATH commands run with, once it has been asked for. */
let commandPath: string | undefined
/** Set when the owner has just asked to share this computer, so the page to confirm on is shown. */
let showConfirm = false
let confirmTimer: ReturnType<typeof setInterval> | undefined
/** Told whenever something changed: whoever is waiting for the daemon to get somewhere. */
const waiting = new Set<() => void>()
/** The sign-in that is waiting for the owner's browser, if one is. */
const browser = browserSignIn()
/** The connector's sign-in that is waiting for the owner's browser, if one is. */
const connecting = browserConnect()

const alive = (window: BrowserWindow | undefined): window is BrowserWindow =>
  window !== undefined && !window.isDestroyed()

/**
 * The app started by itself, where nobody asked to see it: at sign-in, or as the newer one
 * it restarted as while no window was showing.
 */
const startedHidden = () =>
  process.argv.includes(HIDDEN_FLAG) ||
  (MAC && app.getLoginItemSettings().wasOpenedAtLogin) ||
  returningUnseen(settings.restarted, Date.now())

/**
 * The deployment the app would use if nobody said otherwise: the one it was built or run for.
 * A run can be told there is none, by naming an empty one, and then asks.
 */
const suggested = () => process.env.DC_DESKTOP_SERVER ?? DEFAULT_SERVER
const canOpenAtLogin = () => app.isPackaged || process.env.DC_DESKTOP_AUTOSTART === "1"

/**
 * The page the window starts on. Until the first run is over that is the deployment's welcome,
 * which asks who its owner is and whether agents may work here, however often the app is quit
 * before it has been answered. Someone the deployment knows is sent on from there to their
 * agents, and asked about this computer in the app.
 */
const home = () => (settings.welcomed ? settings.server! : `${settings.server}/welcome`)

// ---------------------------------------------------------------------------------------------
// State, as the app's pages and the tray show it

/** A screen that is only pretended, so that the tests need none. */
const FAKE_SCREEN = process.env.DC_DESKTOP_FAKE_SCREEN === "1"
/**
 * Where the driver's packages are. They are programs for one system, which cannot be run from
 * inside the one file the app is packed into, so a packed app keeps them beside that file.
 */
const driverDir = () =>
  app.isPackaged ? path.join(process.resourcesPath, "driver") : here("driver")
const screenUnavailable = () => (FAKE_SCREEN ? undefined : driverMissing(driverDir()))

/**
 * Where Do Computer itself is, for the app to run: one file and the pages beside it. A packed
 * app keeps them beside its one packed file, as files a program can be run from.
 */
const serverDir = () =>
  app.isPackaged ? path.join(process.resourcesPath, "server") : here("server")
const serverScript = () => path.join(serverDir(), "server.mjs")
const canRunLocally = () => existsSync(serverScript())
/** Where the app's own server keeps everything: accounts, Doods, their files. */
const serverData = () => path.join(app.getPath("userData"), "server")

/** What macOS has let the app do, of the two things using the screen takes. */
const permissions = () => ({
  accessibility: systemPreferences.isTrustedAccessibilityClient(false),
  screenRecording: systemPreferences.getMediaAccessStatus("screen") === "granted",
})

/**
 * Whether macOS lets the app look for its owner's own Chrome, where they have one and agents
 * may use a browser. The daemon is the app's, so what the app may read is what it may.
 */
function ownBrowser(): "allowed" | "blocked" | undefined {
  if (!MAC || !settings.browser) return undefined
  const access = ownBrowserAccess()
  return access === "none" ? undefined : access
}

/** What agents may use here now. One that may only read files may use neither. */
const abilities = () => ({
  screen: settings.screen && !settings.readOnly && screenUnavailable() === undefined,
  browser: settings.browser && !settings.readOnly,
})

/** What macOS has still to allow before the screen can be used here, by the names it gives them. */
function unpermitted(): string[] {
  if (!MAC || FAKE_SCREEN) return []
  const allowed = permissions()
  return [
    ...(allowed.accessibility ? [] : ["Accessibility"]),
    ...(allowed.screenRecording ? [] : ["Screen Recording"]),
  ]
}

/** Why an agent may not use the screen just now, in words it can pass on to its owner. */
function screenForbidden(): string | undefined {
  if (!abilities().screen) {
    return "This computer does not let Doods use its screen. Its owner can switch that on in the Do Computer app on that computer, under This Computer."
  }
  const missing = unpermitted()
  if (missing.length === 0) return undefined
  return `macOS has not let Do Computer use this Mac's screen yet. Ask its owner to allow Do Computer under ${missing.join(" and ")} in System Settings, Privacy & Security (the Do Computer app on that Mac has a button for each, under This Computer), then try again.`
}

/**
 * For the tests, which have no other way to know that the driver that came with the app loads
 * and runs on the system they are on: ask it how large the screen is, and write down what it
 * said, or why it could not.
 */
async function probeDriver(): Promise<void> {
  const file = process.env.DC_DESKTOP_PROBE_DRIVER
  if (file === undefined || file === "") return
  const driver = cuaDriver(driverDir())
  const said = await driver.probe!().then(
    (text) => `ok: ${text}`,
    (error) => `failed: ${error instanceof Error ? error.message : String(error)}`,
  )
  writeFileSync(file, said)
  await driver.dispose()
}

/** The screen as agents use it, made when one first does or the app is ready to draw on it. */
function screenOf(): ScreenService {
  if (screenService !== undefined) return screenService
  const using = new UseState({ what: "the screen" })
  usingScreen = using
  overlay = createOverlay({
    state: using,
    pagesDir: here("pages"),
    preload: here("overlay-preload.cjs"),
  })
  screenDriver = FAKE_SCREEN
    ? fakeDriver(process.env.DC_DESKTOP_FAKE_SCREEN_LOG)
    : cuaDriver(driverDir())
  screenService = new ScreenService({
    state: using,
    driver: screenDriver,
    pointer: overlay,
    display: () => screen.getPrimaryDisplay().bounds,
    toJpeg: (png, quality) => nativeImage.createFromBuffer(png).toJPEG(quality),
    forbidden: screenForbidden,
  })
  return screenService
}

function state(): AppState {
  const sharing = runner?.sharing ?? { state: "off" }
  const unavailable = screenUnavailable()
  const own = ownBrowser()
  return {
    ...(settings.server === undefined ? {} : { server: settings.server }),
    suggestedServer: settings.server ?? suggested(),
    local: settings.local,
    canRunLocally: canRunLocally(),
    serving: localServer?.serving ?? { state: "off" },
    tailnet: {
      status: tailnetNow,
      on: settings.tailnet,
      ...(reachedAt === undefined ? {} : { address: reachedAt }),
      ...(tailnetProblem === undefined ? {} : { problem: tailnetProblem }),
      busy: tailnetBusy,
    },
    welcomed: settings.welcomed,
    sharing,
    headline: headline(sharing),
    readOnly: settings.readOnly,
    screen: settings.screen,
    ...(unavailable === undefined ? {} : { screenUnavailable: unavailable }),
    ...(MAC ? { permissions: permissions() } : {}),
    browser: settings.browser,
    ...(own === undefined ? {} : { ownBrowser: own }),
    openAtLogin: settings.openAtLogin,
    canOpenAtLogin: canOpenAtLogin(),
    log: runner?.lines ?? [],
    platform: process.platform,
    version: app.getVersion(),
    update,
  }
}

function changed(): void {
  const now = state()
  for (const window of [computerWindow, welcomeWindow, devicesWindow, mainWindow]) {
    if (alive(window) && window.webContents.getURL().startsWith("file:")) {
      window.webContents.send("state", now)
    }
  }
  drawTray()
  for (const tell of [...waiting]) tell()
  void confirmWhenSignedIn()
}

// ---------------------------------------------------------------------------------------------
// Windows

const webPreferences = () => ({
  preload: here("preload.cjs"),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
})

/** What a window is filled with before its page has drawn: the page's own colour, not a flash. */
const canvas = () => (nativeTheme.shouldUseDarkColors ? "#121415" : "#f8fbfb")

const icon = () => (MAC ? undefined : nativeImage.createFromPath(here("assets", "icon.png")))

/** The picture a page of the deployment last asked the app to be shown by, if it asked. */
let ownIcon: Electron.NativeImage | undefined

/**
 * Be shown by a picture a page drew, its owner's own agent, or by the usual one again. On a
 * Mac that is the Dock's; elsewhere the main window's, which the taskbar shows. It lasts as
 * long as the app runs: the app's file keeps the picture it was built with.
 */
function showIcon(asked: unknown): void {
  const picture = iconPicture(asked)
  if (picture === undefined) return
  if (picture === null) ownIcon = undefined
  else {
    const image = nativeImage.createFromDataURL(picture)
    if (image.isEmpty() || !iconFits(image.getSize())) return
    ownIcon = image
  }
  if (MAC) app.dock?.setIcon(ownIcon ?? nativeImage.createFromPath(here("assets", "icon-mac.png")))
  else if (alive(mainWindow)) mainWindow.setIcon(ownIcon ?? icon()!)
}

/**
 * A page of the deployment, at the address the window goes to it by: the app's own server is
 * also the one its owner's other devices reach, and sends people back to that address.
 */
const ours = (address: string) =>
  settings.server === undefined ? undefined : atServer(address, settings.server, reachedAt)

/** A window of the deployment beside the others, as one of its pages opens for itself. */
function openBeside(address: string): void {
  const window = new BrowserWindow({
    title: NAME,
    backgroundColor: canvas(),
    autoHideMenuBar: true,
    ...(MAC ? {} : { icon: ownIcon ?? icon()! }),
    webPreferences: webPreferences(),
  })
  keepToServer(window)
  void window.loadURL(address)
}

/**
 * A window of the app shows the deployment and nowhere else: it has no address to read and no
 * way back. Links that lead away open in the browser, where its owner is at home. So does a
 * connector's sign-in, which the browser brings back to the app. Any other page that sends its
 * owner away to sign in somewhere has that shown in a small window over it instead.
 */
function keepToServer(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const at = ours(url)
    if (at === url) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } }
    }
    // The deployment by its other address: the same page, where the app is signed in.
    if (at !== undefined) openBeside(at)
    else if (isWebAddress(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  // A window the deployment opened beside this one is kept to it as well.
  window.webContents.on("did-create-window", keepToServer)
  const leaving = (event: Electron.Event, address: string) => {
    const at = ours(address)
    if (at === address || !isWebAddress(address)) return
    event.preventDefault()
    // The deployment by its other address: the same page, where this window is signed in.
    if (at !== undefined) void window.loadURL(at)
    // The app's own pages sign nobody in.
    else if (window.webContents.getURL().startsWith("file:")) void shell.openExternal(address)
    else void signInElsewhere(window, address)
  }
  window.webContents.on("will-navigate", (event) => leaving(event, event.url))
  window.webContents.on("will-redirect", (event) => {
    if (event.isMainFrame) leaving(event, event.url)
  })
}

/** The small window each window's sign-in elsewhere is shown in, while there is one. */
const signIns = new Map<BrowserWindow, BrowserWindow>()

/** A place for a window of this size over another, kept on the screen that one is on. */
function over(window: BrowserWindow, width: number, height: number) {
  const bounds = window.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const size = { width: Math.min(width, area.width), height: Math.min(height, area.height) }
  const within = (at: number, length: number, from: number, room: number) =>
    Math.round(Math.min(Math.max(at, from), from + room - length))
  return {
    ...size,
    x: within(bounds.x + (bounds.width - size.width) / 2, size.width, area.x, area.width),
    y: within(bounds.y + (bounds.height - size.height) / 2, size.height, area.y, area.height),
  }
}

/** A window that shows somewhere else is named by where: all there is to say whose page it is. */
function nameByAddress(window: BrowserWindow): void {
  window.webContents.on("page-title-updated", (event) => {
    event.preventDefault()
    const address = window.webContents.getURL()
    if (isWebAddress(address)) window.setTitle(new URL(address).host)
  })
}

/**
 * A window of the deployment was sent somewhere else to sign in. A connector's sign-in is done
 * in its owner's browser, where they are signed in to the service already; anything else, or
 * a deployment that knows nothing of this, in a small window of the app.
 */
async function signInElsewhere(asked: BrowserWindow, address: string): Promise<void> {
  if (!(await connectInBrowser(asked, address))) showElsewhere(asked, address)
}

/**
 * Send the owner's browser to a connector's service, if that is what this address is. The
 * deployment knows a sign-in it started by its `state`, and is told the port to pass the
 * service's answer on to. The app then takes that answer to the deployment itself, in the
 * window that asked, which is signed in as whoever started it: the browser need not be.
 * False where the deployment does not know the address as a sign-in of this person's.
 */
async function connectInBrowser(asked: BrowserWindow, address: string): Promise<boolean> {
  const server = settings.server
  const state = new URL(address).searchParams.get("state")
  if (server === undefined || state === null || state === "") return false
  let known = false
  const answer = await connecting.connect(state, async (port) => {
    const told = await session.defaultSession.fetch(`${server}${CONNECTOR_BROWSER_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, port }),
    })
    if (!told.ok) throw new Error("not a connector's sign-in")
    known = true
    await shell.openExternal(address)
  })
  if (!known) return false
  if ("error" in answer || !alive(asked)) return true
  const back = new URL(CONNECTOR_CALLBACK_PATH, server)
  back.search = answer.query
  back.searchParams.set(CONNECTOR_FROM_APP, "1")
  void asked.loadURL(back.href)
  // The owner is in their browser. Bring them back to where the answer is.
  asked.show()
  asked.focus()
  if (MAC) app.focus({ steal: true })
  return true
}

/**
 * Show somewhere else on the web in a small window over the one that was sent there, with the
 * same cookies. When the service sends its visitor back to a page of the deployment, the small
 * window closes and the one that asked shows that page, as it would have had it gone itself.
 */
function showElsewhere(asked: BrowserWindow, address: string): void {
  const server = settings.server
  if (server === undefined) return
  const open = signIns.get(asked)
  if (alive(open)) {
    void open.loadURL(address)
    return open.focus()
  }
  const window = new BrowserWindow({
    ...over(asked, 520, 720),
    parent: asked,
    title: new URL(address).host,
    minimizable: false,
    fullscreenable: false,
    backgroundColor: canvas(),
    autoHideMenuBar: true,
    ...(MAC ? {} : { icon: icon()! }),
    // Nothing of the app's is given to a page that is not the deployment's.
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  window.setMenuBarVisibility(false)
  signIns.set(asked, window)
  window.on("closed", () => {
    if (signIns.get(asked) === window) signIns.delete(asked)
  })
  nameByAddress(window)
  // A service may show part of its sign-in in a window of its own, which answers this one.
  window.webContents.setWindowOpenHandler(({ url }) =>
    isWebAddress(url)
      ? { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } }
      : { action: "deny" },
  )
  window.webContents.on("did-create-window", nameByAddress)
  const back = (event: Electron.Event, to: string) => {
    const at = ours(to)
    if (at === undefined) return
    if (!cameBack(at, server)) {
      // Where a service answers. By the deployment's other address this window is nobody: it
      // answers where the one that asked is signed in.
      if (at === to) return
      event.preventDefault()
      void window.loadURL(at)
      return
    }
    event.preventDefault()
    // Not while it is still telling of where it was going.
    setImmediate(() => window.destroy())
    if (!alive(asked)) return
    void asked.loadURL(at)
    asked.show()
    asked.focus()
  }
  window.webContents.on("will-navigate", (event) => back(event, event.url))
  window.webContents.on("will-redirect", (event) => {
    if (event.isMainFrame) back(event, event.url)
  })
  void window.loadURL(address)
}

/**
 * Whether the deployment's window is to have no title bar. Its pages have to make room for the
 * window's buttons and say what it is dragged by, and a deployment older than that does
 * neither: the window is given its title bar back for as long as the app is set to that one.
 */
const insetWanted = () => NO_TITLE_BAR && settings.titleBarFor !== settings.server
/** The windows that were made with no title bar. */
const inset = new WeakSet<BrowserWindow>()
/** Whether the main window has no title bar to be seen: in full screen it has no buttons either. */
const mainInset = () => alive(mainWindow) && inset.has(mainWindow) && !mainWindow.isFullScreen()

/**
 * What a page that has finished loading does about the title bar. A page of the app says so
 * where it can be shown without one. If that is not how the window was made, the window is
 * made again the other way, and it is remembered. Any other page has made no room, so it
 * is given a strip along its top to be dragged by.
 */
async function fitTitleBar(window: BrowserWindow): Promise<void> {
  if (!NO_TITLE_BAR || !alive(window)) return
  const address = window.webContents.getURL()
  let fits: boolean | undefined
  if (ours(address) !== undefined) {
    // Only the app's own pages are asked: a file or a site an agent made is neither answer.
    const said = (await window.webContents
      .executeJavaScript(
        `document.querySelector('meta[name="application-name"][content="Do Computer"]') === null ? null : document.querySelector('meta[name="do-computer-title-bar"][content="inset"]') !== null`,
      )
      .catch(() => null)) as boolean | null
    if (said !== null) fits = said
  }
  if (!alive(window) || window !== mainWindow || window.webContents.getURL() !== address) return
  if (fits === undefined || fits === inset.has(window)) {
    if (fits !== true && inset.has(window)) void window.webContents.insertCSS(DRAG_STRIP)
    return
  }
  remember({ titleBarFor: fits ? undefined : settings.server })
  const bounds = window.getBounds()
  const shown = window.isVisible()
  mainWindow = undefined
  window.destroy()
  makeMain(address, { bounds, shown })
}

/** Show the deployment's window, making it if need be, on a page of the deployment if given. */
function showMain(address?: string): void {
  if (settings.server === undefined) return showWelcome()
  if (alive(mainWindow)) {
    if (address !== undefined) void mainWindow.loadURL(address)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  makeMain(address ?? home())
}

/** Make the deployment's window, where the one before it was if there was one. */
function makeMain(
  address: string,
  as: { bounds?: Electron.Rectangle; shown?: boolean } = {},
): void {
  const bare = insetWanted()
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    ...as.bounds,
    show: as.shown !== false,
    minWidth: 380,
    minHeight: 480,
    title: NAME,
    backgroundColor: canvas(),
    autoHideMenuBar: true,
    ...(bare ? { titleBarStyle: "hidden" as const, trafficLightPosition: TRAFFIC_LIGHTS } : {}),
    ...(MAC ? {} : { icon: ownIcon ?? icon()! }),
    webPreferences: webPreferences(),
  })
  if (bare) inset.add(window)
  mainWindow = window
  keepToServer(window)
  // Closing the window leaves the program running, with the daemon in it, until it is quit.
  window.on("close", (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.on("did-fail-load", (_event, code, _text, _url, isMainFrame) => {
    // -3 is a load that was replaced by another, which is no failure.
    if (isMainFrame && code !== -3) void window.loadFile(page("offline"))
  })
  window.webContents.on("did-finish-load", () => void fitTitleBar(window))
  // In full screen the window's buttons are gone, and the page takes back the room it made.
  for (const turned of ["enter-full-screen", "leave-full-screen"] as const) {
    window.on(turned as "enter-full-screen", () => {
      window.webContents.send(CHANNELS.titleBar, mainInset() ? "inset" : null)
    })
  }
  // Signing in is a change of page, and is what a pairing waits for.
  for (const moved of ["did-navigate", "did-navigate-in-page"] as const) {
    window.webContents.on(moved as "did-navigate", (_event, address) => {
      void confirmWhenSignedIn()
      void backIn(address)
    })
  }
  void window.loadURL(address)
}

function ownWindow(name: string, options: { width: number; height: number; title: string }) {
  const window = new BrowserWindow({
    ...options,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: canvas(),
    autoHideMenuBar: true,
    ...(MAC ? {} : { icon: icon()! }),
    webPreferences: webPreferences(),
  })
  window.setMenuBarVisibility(false)
  keepToServer(window)
  void window.loadFile(page(name))
  return window
}

/** Where the deployment is chosen: on the first run, and when its owner wants another. */
function showWelcome(): void {
  if (alive(welcomeWindow)) return welcomeWindow.focus()
  // Taller once the first run is over: the form then asks about this computer as well.
  const height = settings.welcomed ? 760 : 620
  welcomeWindow = ownWindow("welcome", { width: 480, height, title: NAME })
  welcomeWindow.on("closed", () => (welcomeWindow = undefined))
}

/** Using the app's own server from its owner's other devices. */
function showDevices(): void {
  if (!settings.local) return
  if (alive(devicesWindow)) return devicesWindow.focus()
  devicesWindow = ownWindow("devices", { width: 460, height: 800, title: "Other Devices" })
  devicesWindow.on("closed", () => (devicesWindow = undefined))
  // Tailscale may have been installed, or signed in to, since the app last looked.
  void lookForTailnet()
}

/** How this computer is shared with agents. */
function showComputer(): void {
  if (alive(computerWindow)) return computerWindow.focus()
  computerWindow = ownWindow("computer", { width: 460, height: 680, title: "This Computer" })
  computerWindow.on("closed", () => (computerWindow = undefined))
}

// ---------------------------------------------------------------------------------------------
// Sharing this computer

function daemon(): DaemonRunner {
  if (runner !== undefined) return runner
  const dir = path.join(app.getPath("userData"), "daemon")
  runner = new DaemonRunner({
    script: seedDaemon(here("daemon.cjs"), dir),
    dir,
    node: process.execPath,
    env: commandEnv,
    onChange: changed,
    abilities,
    onCall: (call) => screenOf().answer(call),
    onRevoked: () => {
      remember({ share: false })
      changed()
    },
  })
  return runner
}

/** What a command of this computer's is run with: its owner's PATH, once that is known. */
const commandEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  ...(commandPath === undefined ? {} : { PATH: commandPath }),
})

/** Whether a deployment answers at an address, and says that it is one. */
function healthy(server: string): Promise<boolean> {
  // An address nothing answers at can take a system a long while to give up on.
  return net
    .fetch(`${server}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    .then(async (response) => response.ok && (await response.json())?.ok === true)
    .catch(() => false)
}

async function startSharing(): Promise<void> {
  if (settings.server === undefined) return
  // Once: asking takes as long as the owner's shell takes to start.
  commandPath ??= (await loginPath()) ?? process.env.PATH
  if (settings.share && settings.server !== undefined) {
    daemon().start(settings.server, settings.readOnly)
  }
}

/**
 * Whether whoever is signed in to the window has an agent. Nobody signed in has none, and
 * neither does an account in its first moments: its first agent is made by the page it lands on.
 */
async function hasAgent(): Promise<boolean> {
  if (settings.server === undefined) return false
  try {
    const response = await session.defaultSession.fetch(`${settings.server}/api/agents`)
    if (!response.ok) return false
    const { agents } = (await response.json()) as { agents?: unknown[] }
    return Array.isArray(agents) && agents.length > 0
  } catch {
    return false
  }
}

/**
 * A pairing is confirmed on a page of the deployment, signed in, and that page is where the
 * agents that get the computer are chosen. When the owner has just asked to share this
 * computer, show them that page as soon as they are signed in and have an agent to choose.
 */
async function confirmWhenSignedIn(): Promise<void> {
  const sharing = runner?.sharing
  if (!showConfirm || sharing?.state !== "pairing") {
    clearInterval(confirmTimer)
    confirmTimer = undefined
    return
  }
  // Neither signing in nor a first agent being made is something the window tells of.
  confirmTimer ??= setInterval(() => void confirmWhenSignedIn(), 2_000)
  const address = sharing.verifyUrl
  if (!(await hasAgent())) return
  if (!showConfirm || runner?.sharing.state !== "pairing") return
  showConfirm = false
  if (isWebAddress(address)) showMain(address)
}

/**
 * Start the app at sign-in on Linux, or stop doing so. An AppImage runs from a folder that is
 * gone when it stops, so the file itself is what is started: `file`, where it has just moved.
 */
function linuxAutostart(on: boolean, file = process.env.APPIMAGE || process.execPath): void {
  setLinuxAutostart(on, {
    home: os.homedir(),
    configHome: process.env.XDG_CONFIG_HOME,
    exec: file,
  })
}

function setOpenAtLogin(on: boolean): void {
  remember({ openAtLogin: on })
  if (!state().canOpenAtLogin) return
  if (process.platform === "linux") {
    linuxAutostart(on)
  } else {
    app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_FLAG] })
  }
}

// ---------------------------------------------------------------------------------------------
// The app's own server

function local(): LocalServer {
  if (localServer !== undefined) return localServer
  const port = settings.localPort!
  localServer = new LocalServer({
    script: serverScript(),
    node: process.execPath,
    port,
    env: () => ({
      ...process.env,
      ...serverEnv({ port, dir: serverData(), key: ownerKey(serverData()), reachedAt }),
    }),
    onChange: changed,
  })
  return localServer
}

/** Whether the app's window is signed in to the deployment. */
async function signedIn(): Promise<boolean> {
  if (settings.server === undefined) return false
  try {
    return (await session.defaultSession.fetch(`${settings.server}/api/me`)).ok
  } catch {
    return false
  }
}

/**
 * Sign the app's window in to its own server as its owner, who has no password: the app says
 * who they are, with the key only it and the server have. With a name, the first time, that is
 * what they are called from then on. Resolves with what went wrong, in words to show.
 *
 * The server is asked from outside any page, and the window is given the cookies it answered
 * with: a page is never shown the key.
 */
async function signInWindow(name?: string): Promise<string | undefined> {
  const server = settings.server
  if (!settings.local || server === undefined) {
    return "This app shows a Do Computer somewhere else. Sign in to it there."
  }
  if (name === undefined && (await signedIn())) return undefined
  let response: Response
  try {
    response = await fetch(`${server}/api/auth/local/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: ownerKey(serverData()),
        ...(name === undefined ? {} : { name }),
      }),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
  } catch {
    return "Do Computer is not running on this computer yet. Try again in a moment."
  }
  // Nobody has said who they are here yet: the first run asks, and then says.
  if (response.status === 404 && name === undefined) return undefined
  if (!response.ok) {
    const said = (await response.json().catch(() => null)) as { message?: string } | null
    return said?.message ?? "This window could not be signed in. Try again."
  }
  for (const header of response.headers.getSetCookie()) {
    const cookie = cookieDetails(header, server)
    if (cookie !== undefined) await session.defaultSession.cookies.set(cookie)
  }
  return undefined
}

/**
 * The window came to the page that asks for a password, which on the app's own server nobody
 * has: its session ran out, or is one from before the server was reached at another address.
 * It is signed in again and shown where it was going.
 */
async function backIn(address: string): Promise<void> {
  const server = settings.server
  if (!settings.local || server === undefined || !onServer(address, server)) return
  if (new URL(address).pathname !== "/login") return
  if ((await signedIn()) || (await signInWindow()) !== undefined || !(await signedIn())) return
  if (alive(mainWindow) && settings.server === server) void mainWindow.loadURL(home())
}

/** Ask Tailscale how this computer stands with it. */
async function lookForTailnet(): Promise<void> {
  tailnetNow = await lookAtTailnet(findTailscale(process.platform, commandEnv()))
  changed()
}

/**
 * Have Tailscale serve the app's own server to its owner's other devices, and say where it is
 * then reached. Where it cannot, why not is kept to show.
 */
async function reach(): Promise<void> {
  const port = settings.localPort
  const bin = findTailscale(process.platform, commandEnv())
  tailnetNow = await lookAtTailnet(bin)
  reachedAt = undefined
  tailnetProblem = undefined
  if (port === undefined) return
  if (bin === undefined || tailnetNow.state !== "ready") {
    tailnetProblem =
      tailnetNow.state === "missing"
        ? "Tailscale is not installed on this computer."
        : tailnetNow.state === "stopped"
          ? "Tailscale is not connected. Open it on this computer and sign in."
          : "Your Tailscale network does not give its devices certificates yet."
    return
  }
  const wrong = await serve(bin, port)
  if (wrong !== undefined) tailnetProblem = wrong
  else reachedAt = tailnetAddress(tailnetNow.name, port)
}

/** Stop Tailscale serving the app's own server. Whatever else it serves here is left alone. */
async function unreach(): Promise<void> {
  const bin = findTailscale(process.platform, commandEnv())
  if (bin !== undefined && settings.localPort !== undefined) await unserve(bin, settings.localPort)
  reachedAt = undefined
  tailnetProblem = undefined
}

/**
 * Start the app's own server, served to its owner's other devices where they asked for that,
 * and sign the window in. Resolves with whether the server answers.
 */
async function startLocal(): Promise<boolean> {
  if (!settings.local || settings.localPort === undefined || !canRunLocally()) return false
  // Before it starts, so that it starts once: where it is reached is part of what it is told.
  if (settings.tailnet) await reach()
  local().start()
  const answers = await local().ready()
  if (answers) await signInWindow()
  return answers
}

/** The server was told where it is reached as it started. Told otherwise, it starts again. */
async function reachedElsewhere(): Promise<void> {
  if (localServer === undefined) return
  await localServer.restart()
  if (!(await localServer.ready())) return
  // What signed the window in goes by the address too.
  await signInWindow()
  if (alive(mainWindow) && !mainWindow.webContents.getURL().startsWith("file:")) {
    mainWindow.webContents.reload()
  }
}

/** Serve the app's own server to its owner's other devices, or stop. */
async function setTailnet(on: boolean): Promise<void> {
  if (!settings.local || tailnetBusy) return
  tailnetBusy = true
  changed()
  try {
    const before = reachedAt
    if (on) await reach()
    else await unreach()
    // Asked for and not to be had: the switch goes back, with why beside it.
    remember({ tailnet: on && reachedAt !== undefined })
    if (reachedAt !== before) await reachedElsewhere()
  } finally {
    tailnetBusy = false
    changed()
  }
}

/**
 * Tailscale was not ready when the app started, as at sign-in it may not be. Once it is, the
 * server is served as its owner asked.
 */
async function reachWhenReady(): Promise<void> {
  if (!settings.local || !settings.tailnet || reachedAt !== undefined || tailnetBusy) return
  if (localServer === undefined || localServer.serving.state !== "running") return
  tailnetBusy = true
  try {
    await reach()
    if (reachedAt !== undefined) await reachedElsewhere()
  } finally {
    tailnetBusy = false
    changed()
  }
}

/** The app is to show a server somewhere else: its own stops, and is no longer served. */
async function leaveLocal(): Promise<void> {
  if (settings.tailnet) await unreach()
  await localServer?.stop()
  localServer = undefined
}

/** A link that signs one other device of the owner's in, once, and the code that says it. */
async function deviceLink(): Promise<DeviceLink | { error: string }> {
  const server = settings.server
  if (!settings.local || server === undefined || reachedAt === undefined) {
    return { error: "Switch on reaching it from your other devices first." }
  }
  try {
    const response = await fetch(`${server}/api/auth/local/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: ownerKey(serverData()) }),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    const said = (await response.json().catch(() => null)) as {
      token?: string
      seconds?: number
      message?: string
    } | null
    if (response.status === 404) {
      return { error: "Finish setting up Do Computer in its window first." }
    }
    if (!response.ok || typeof said?.token !== "string") {
      return { error: said?.message ?? "A code could not be made. Try again." }
    }
    // After the #, which a device keeps to itself: it is not sent as part of an address.
    const link = `${reachedAt}/local/sign-in#${said.token}`
    const cells = toQR(link)
    return {
      link,
      cells: Array.from(cells),
      size: Math.round(Math.sqrt(cells.length)),
      seconds: said.seconds ?? 600,
    }
  } catch {
    return { error: "Do Computer is not running on this computer just now. Try again." }
  }
}

/** Whether any of its owner's Doods is in the middle of something, on the app's own server. */
async function anyWorking(): Promise<boolean> {
  if (settings.server === undefined) return false
  try {
    const response = await session.defaultSession.fetch(`${settings.server}/api/agents`)
    if (!response.ok) return false
    const { agents } = (await response.json()) as { agents?: { working?: boolean }[] }
    return Array.isArray(agents) && agents.some((agent) => agent.working === true)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------------------------
// Keeping itself up to date

/**
 * Why this copy of the app does not update itself, if it does not. One that does was packed
 * knowing where newer ones are published, which a release is (see `Pack it` in the Desktop
 * workflow): electron-builder leaves that beside the app, in app-update.yml. A run can be told
 * where to look instead, or, by naming nowhere, not to look.
 */
function notUpdating(): string | undefined {
  const told = process.env.DC_DESKTOP_UPDATES
  const packed = app.isPackaged && existsSync(path.join(process.resourcesPath, "app-update.yml"))
  if (told === "" || (told === undefined && !packed)) {
    return "Not a release: it stays as it is"
  }
  // The AppImage is one file, which a newer one can take the place of. An app unpacked from it,
  // or put in place by a package, is not the app's to replace.
  if (process.platform === "linux" && !process.env.APPIMAGE) {
    return "Only the AppImage updates itself"
  }
  return undefined
}

function updated(event: UpdateEvent): void {
  const before = JSON.stringify(update)
  update = afterUpdate(update, event)
  if (JSON.stringify(update) !== before) changed()
}

function lookForUpdate(): void {
  // One that is here already is not fetched again. It is this that is restarted as.
  if (update.state === "off" || update.state === "ready") return
  // What goes wrong is said as an event too, which is where it is heard.
  autoUpdater.checkForUpdates().catch(() => {})
}

/** The AppImage this app is, on Linux: the file a newer one takes the place of, or has. */
let appImage = process.env.APPIMAGE

/** Restart as the newer app that was fetched. `unseen`: with no window, as it was before. */
function restartToUpdate(unseen: boolean): void {
  if (update.state !== "ready") return
  if (unseen) remember({ restarted: Date.now() })
  // Closing a window otherwise only hides it, and the app would never get as far as quitting.
  quitting = true
  // On Windows the newer app is an installer: it is run without showing itself, and starts
  // the app when it is done. A Mac does both by itself, and is told nothing.
  if (process.platform !== "linux" || appImage === undefined) {
    return autoUpdater.quitAndInstall(true, true)
  }
  // The newer AppImage is put in place, and this app quits. Left to start it, electron-updater
  // starts it with nothing, and while this one is still here to be mistaken for it. So it is
  // started with what this one was started with, which on some desktops is what it takes to
  // start at all (--no-sandbox), and by a shell that waits until this one has gone. Electron's
  // own way to start again runs from inside the AppImage, which is gone by then. The shell
  // lets go of what it was handed open first: one of those is what keeps this AppImage
  // mounted for as long as anything holds it, which the newer app would for as long as it ran.
  autoUpdater.quitAndInstall(true, false)
  // What goes wrong putting it in place is said before that returns, and then nothing quits.
  if (update.state !== "ready") {
    quitting = false
    return
  }
  const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((arg) => arg !== HIDDEN_FLAG)
  spawn(
    "/bin/sh",
    [
      "-c",
      'exec 3<&- 4<&- 5<&- 6<&- 7<&- 8<&- 9<&-; while kill -0 "$0" 2>/dev/null; do sleep 0.2; done; exec "$@"',
      String(process.pid),
      appImage,
      ...args,
      ...(unseen ? [HIDDEN_FLAG] : []),
    ],
    { detached: true, stdio: "ignore" },
  ).unref()
}

/** Restart as the newer app without being asked, once nobody would notice: see `mayRestart`. */
async function restartWhenQuiet(): Promise<void> {
  const showing = [mainWindow, computerWindow, welcomeWindow, devicesWindow].some(
    (window) => alive(window) && window.isVisible(),
  )
  const quiet = {
    update,
    showing,
    usingScreen: usingScreen?.active === true,
    quietMs: Date.now() - (runner?.heard ?? 0),
  }
  if (!mayRestart(quiet)) return
  // The app's own server stops with it, and whatever a Dood is in the middle of there.
  if (settings.local && (await anyWorking())) return
  restartToUpdate(true)
}

function startUpdating(): void {
  const why = notUpdating()
  if (why !== undefined) {
    update = { state: "off", why }
    return
  }
  const told = process.env.DC_DESKTOP_UPDATES
  if (told !== undefined) {
    // What electron-builder leaves beside a release, written for this run. JSON is YAML too.
    const file = path.join(app.getPath("userData"), "app-update.yml")
    writeFileSync(file, `${JSON.stringify({ provider: "generic", url: told })}\n`)
    autoUpdater.updateConfigPath = file
    // A run from the source is looked after too, when it is told where to look: the tests'.
    autoUpdater.forceDevUpdateConfig = true
  }
  autoUpdater.on("checking-for-update", () => updated({ event: "checking" }))
  autoUpdater.on("update-available", (info) => updated({ event: "found", version: info.version }))
  autoUpdater.on("update-not-available", () => updated({ event: "none" }))
  autoUpdater.on("download-progress", (progress) =>
    updated({ event: "progress", percent: progress.percent }),
  )
  autoUpdater.on("update-downloaded", (info) =>
    updated({ event: "fetched", version: info.version }),
  )
  autoUpdater.on("error", (error) => updated({ event: "error", message: error.message }))
  // An AppImage named for its version is replaced by a file named for the newer one, and what
  // starts the app at sign-in has to name that file.
  autoUpdater.on("appimage-filename-updated", (file) => {
    appImage = file
    if (settings.openAtLogin && canOpenAtLogin()) linuxAutostart(true, file)
  })
  lookForUpdate()
  setInterval(lookForUpdate, UPDATE_EVERY_MS)
  setInterval(() => void restartWhenQuiet(), RESTART_LOOK_MS)
}

// ---------------------------------------------------------------------------------------------
// What the app's own pages ask for

/** Only the app's own pages may ask: files that came with it, not a page of any deployment. */
function own<Args extends unknown[], Result>(handler: (...args: Args) => Result) {
  const pages = pathToFileURL(here("pages")).href
  return (event: IpcMainInvokeEvent, ...args: Args) => {
    if (event.senderFrame?.url.startsWith(`${pages}/`) !== true) {
      throw new Error("Only the app's own pages can ask this.")
    }
    return handler(...args)
  }
}

/**
 * Whether whoever asks is the page the app answers: the top page of the main window, while it
 * is on the deployment. That window can be led to anywhere on the web, and is given nothing there.
 */
function fromServer(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (frame === null || frame.isDestroyed()) return false
  return mayUseBridge({
    mainWindow: alive(mainWindow) && event.sender === mainWindow.webContents,
    top: frame.parent === null,
    url: frame.url,
    server: settings.server,
  })
}

/** Only a page of the deployment, in the main window, may ask. */
function served<Args extends unknown[], Result>(handler: (...args: Args) => Result) {
  return (event: IpcMainInvokeEvent, ...args: Args) => {
    if (!fromServer(event)) throw new Error("Only a page of the deployment can ask this.")
    return handler(...args)
  }
}

/** What a page of the deployment is told as it loads. */
function pageInfo(): PageInfo {
  return {
    platform: process.platform,
    computer: computerName(os.hostname()),
    canOpenAtLogin: canOpenAtLogin(),
    welcomed: settings.welcomed,
    sharing: sharingNow(runner?.sharing ?? { state: "off" }),
    local: settings.local,
    ...(mainInset() ? { titleBar: "inset" as const } : {}),
  }
}

/** Sign in through the owner's browser, which comes back to this computer with a token. */
async function signIn(asked: unknown): Promise<SignInAnswer> {
  const server = settings.server
  if (server === undefined) return { error: "Choose a server first." }
  const answer = await browser.signIn(({ port, state }) => {
    const address = new URL("/desktop/sign-in", server)
    address.searchParams.set("port", String(port))
    address.searchParams.set("state", state)
    const through = provider(asked)
    if (through !== undefined) address.searchParams.set("provider", through)
    return shell.openExternal(address.href)
  })
  if ("token" in answer) {
    // The owner is in their browser. Bring them back to where the rest happens.
    showMain()
    if (MAC) app.focus({ steal: true })
  }
  return answer
}

/** What the daemon comes to, once it has got far enough for `read` to say, or `late` if it does not. */
function daemonComesTo<Answer>(
  read: (sharing: Sharing) => Answer | undefined,
  late: Answer,
): Promise<Answer> {
  return new Promise((resolve) => {
    const settle = (answer: Answer) => {
      clearTimeout(timer)
      waiting.delete(look)
      resolve(answer)
    }
    const look = () => {
      const answer = read(runner?.sharing ?? { state: "off" })
      if (answer !== undefined) settle(answer)
    }
    const timer = setTimeout(() => settle(late), SHARE_TIMEOUT_MS)
    waiting.add(look)
    look()
  })
}

/** What the daemon makes of being started, once it has got far enough to say. */
const paired = (): Promise<ShareAnswer> =>
  daemonComesTo(shareAnswer, { error: "This computer took too long to connect. Try again." })

/** The question about the screen that is before its owner now, if one is. */
let askingForScreen: Promise<ScreenAnswer> | undefined

/**
 * A page asked for agents to be let use the screen. Whether they may is its owner's to say, so
 * the app asks them, in a question that the page neither draws nor can answer.
 */
async function askForScreen(): Promise<ScreenAnswer> {
  const refusal = screenRefusal({
    unavailable: screenUnavailable(),
    sharing: sharingNow(runner?.sharing ?? { state: "off" }),
    readOnly: settings.readOnly,
  })
  if (refusal !== undefined) return { allowed: false, why: refusal }
  if (!settings.screen) {
    const question = {
      type: "question" as const,
      message: "Let Doods use this computer’s screen?",
      detail:
        "They would see the screen and use the mouse and keyboard, as you. You can watch them, pause them and stop them, and switch this off again under This Computer.",
      buttons: ["Allow", "Not Now"],
      defaultId: 0,
      cancelId: 1,
    }
    const { response } = alive(mainWindow)
      ? await dialog.showMessageBox(mainWindow, question)
      : await dialog.showMessageBox(question)
    if (response !== 0) return { allowed: false }
    remember({ screen: true })
    changed()
    // The daemon says what it can do as it connects, so it connects again to say otherwise.
    await runner?.restart()
    const connected = await daemonComesTo(
      (sharing) => (sharing.state === "connected" ? true : undefined),
      false,
    )
    if (!connected) {
      return { allowed: false, why: "This computer took too long to connect. Try again." }
    }
  }
  const missing = unpermitted()
  if (missing.length === 0) return { allowed: true }
  // The window about this computer says what macOS must allow, with a button for each.
  showComputer()
  return { allowed: true, missing }
}

/**
 * What a page of the deployment can ask: see page-bridge.ts. It is little, because a page is
 * whatever the deployment serves, and what agents may do on this computer is its owner's to say.
 */
function listenToServer(): void {
  ipcMain.on(CHANNELS.info, (event) => {
    event.returnValue = fromServer(event) ? pageInfo() : null
  })
  ipcMain.handle(CHANNELS.signIn, served(signIn))
  ipcMain.handle(
    CHANNELS.cancelSignIn,
    served(() => browser.cancel()),
  )
  ipcMain.handle(
    CHANNELS.share,
    served(async (options: { readOnly?: unknown }): Promise<ShareAnswer> => {
      // A page may ask this once, as part of the first run, where its owner is shown the
      // question and answers it: by the egg, or in the app if they have agents already. From
      // then on the decision to share this computer is made in the app's own pages, which no
      // deployment can change or press for them.
      if (settings.welcomed) {
        return {
          error: "Doods are given this computer in the app's own window, under This Computer.",
        }
      }
      // The page that asked confirms the pairing itself. The window is not taken from it.
      showConfirm = false
      remember({ share: true, readOnly: options?.readOnly === true })
      await runner?.stop()
      await startSharing()
      return paired()
    }),
  )
  ipcMain.handle(
    CHANNELS.finish,
    served((options: { openAtLogin?: unknown }) => {
      remember({ welcomed: true })
      if (typeof options?.openAtLogin === "boolean") setOpenAtLogin(options.openAtLogin)
      changed()
    }),
  )
  ipcMain.handle(
    CHANNELS.screen,
    served(() => {
      // One question at a time, however often a page asks.
      askingForScreen ??= askForScreen().finally(() => (askingForScreen = undefined))
      return askingForScreen
    }),
  )
  ipcMain.handle(CHANNELS.icon, served(showIcon))
  ipcMain.handle(CHANNELS.tray, served(showTray))
  ipcMain.handle(
    CHANNELS.signInHere,
    served(async (asked: unknown): Promise<HereAnswer> => {
      const name = ownerName(asked)
      if (name === undefined) return { error: "Say what you are called." }
      const wrong = await signInWindow(name)
      return wrong === undefined ? { ok: true } : { error: wrong }
    }),
  )
  ipcMain.handle(
    CHANNELS.pairedAs,
    served(() => pairedAs(runner?.sharing ?? { state: "off" })),
  )
}

/**
 * Use the deployment that was chosen, with what was said about this computer on the same
 * form. On a first run only the deployment is heeded: its welcome asks the rest, and nothing
 * is shared before it has.
 */
async function settleIn(choice: { share?: unknown; openAtLogin?: unknown }): Promise<void> {
  makeMenu()
  if (!settings.welcomed) {
    remember({ share: false })
    await runner?.stop()
    welcomeWindow?.close()
    showMain(home())
    return
  }
  remember({ share: choice.share === true })
  setOpenAtLogin(choice.openAtLogin === true)
  if (!settings.share) await runner?.stop()
  showConfirm = settings.share
  welcomeWindow?.close()
  showMain(settings.server)
  void startSharing()
}

/** Run Do Computer on this computer, and show that. Resolves with why it could not be. */
async function runHere(choice: {
  tailnet?: unknown
  share?: unknown
  openAtLogin?: unknown
}): Promise<string | undefined> {
  if (!canRunLocally()) return "This copy of the app does not bring Do Computer with it."
  const before = settings
  const port = settings.localPort ?? (await pickPort())
  const server = localAddress(port)
  if (settings.server !== undefined && settings.server !== server) {
    // This computer is paired with the deployment it is leaving, and a daemon has one.
    await daemon().forget()
  }
  remember({ server, local: true, localPort: port, tailnet: choice.tailnet === true })
  if (!(await startLocal())) {
    const detail = localServer?.lines.at(-1)
    await localServer?.stop()
    localServer = undefined
    // As it was: the deployment it had, if it had one, is still there to go back to.
    settings = before
    saveSettings(settingsFile(), settings)
    return `Do Computer could not be started on this computer${detail === undefined ? "." : `: ${detail}`}`
  }
  // Asked for and not to be had: it is said in the window about other devices, and tried there.
  if (settings.tailnet && reachedAt === undefined) remember({ tailnet: false })
  await settleIn(choice)
  return undefined
}

/**
 * The app runs Do Computer itself: that is started first, and then shown, and this computer
 * shared with it as before. Where it does not start, the window says so and keeps trying.
 */
async function openLocal(): Promise<void> {
  commandPath ??= (await loginPath()) ?? process.env.PATH
  await startLocal()
  if (!startedHidden()) showMain()
  void startSharing()
}

/**
 * A first run. An app that knows its deployment, and finds it there, opens straight on its
 * welcome. One that does not asks for the address first.
 */
async function firstRun(): Promise<void> {
  const server = serverAddress(suggested())
  const found = server !== undefined && (await healthy(server))
  // Its owner may have opened the app again meanwhile, and answered the form.
  if (settings.server !== undefined) return
  if (!found) return showWelcome()
  remember({ server, share: false })
  welcomeWindow?.close()
  showMain()
}

function listen(): void {
  ipcMain.handle("state", own(state))
  ipcMain.handle(
    "connect",
    own(
      async (choice: {
        local?: unknown
        server?: unknown
        tailnet?: unknown
        share?: unknown
        openAtLogin?: unknown
      }) => {
        if (choice?.local === true) return runHere(choice)
        const server = serverAddress(typeof choice?.server === "string" ? choice.server : "")
        if (server === undefined) return "That is not an address."
        if (settings.local && server === settings.server) {
          return "That is this app’s own Do Computer. Choose “On this computer” to keep using it."
        }
        if (!(await healthy(server))) {
          return `There is no Do Computer at ${server}, or it cannot be reached.`
        }
        if (settings.server !== undefined && settings.server !== server) {
          // This computer is paired with the deployment it is leaving, and a daemon has one.
          await daemon().forget()
        }
        // What the app's own server kept stays where it is, for coming back to.
        if (settings.local) await leaveLocal()
        if (alive(devicesWindow)) devicesWindow.close()
        remember({ server, local: false, tailnet: false })
        await settleIn(choice)
        return undefined
      },
    ),
  )
  ipcMain.handle("devices", own(showDevices))
  ipcMain.handle("tailnet-look", own(lookForTailnet))
  ipcMain.handle(
    "tailnet-set",
    own((on: unknown) => setTailnet(on === true)),
  )
  ipcMain.handle("device-link", own(deviceLink))
  ipcMain.handle(
    "copy",
    own((text: unknown) => {
      if (typeof text === "string" && text.length < 4_000) clipboard.writeText(text)
    }),
  )
  ipcMain.handle(
    "open",
    own((what: unknown) => {
      // Only ever one of these two, whatever a page asks for.
      if (what === "tailscale") void shell.openExternal("https://tailscale.com/download")
      if (what === "tailscale-https") {
        void shell.openExternal("https://login.tailscale.com/admin/dns")
      }
    }),
  )
  ipcMain.handle(
    "share",
    own(async (on: unknown, readOnly: unknown) => {
      if (on !== true) {
        remember({ share: false })
        await runner?.stop()
        return
      }
      // Asked for before pairing, read-only is the daemon's to remember from then on.
      remember({ share: true, readOnly: readOnly === true })
      showConfirm = true
      await runner?.stop()
      await startSharing()
    }),
  )
  ipcMain.handle(
    "confirm",
    own(() => {
      const sharing = runner?.sharing
      if (sharing?.state === "pairing" && isWebAddress(sharing.verifyUrl)) {
        showMain(sharing.verifyUrl)
      }
    }),
  )
  ipcMain.handle(
    "allow",
    own(async (what: unknown, on: unknown) => {
      if (what !== "screen" && what !== "browser") return
      remember({ [what]: on === true })
      changed()
      // The daemon says what it can do as it connects, so it connects again to say otherwise.
      await runner?.restart()
    }),
  )
  ipcMain.handle(
    "permit",
    own(async (what: unknown) => {
      if (!MAC) return
      // Accessibility is asked for by macOS itself, in a window of its own. Recording the
      // screen has no such question that can be put twice, so its owner is shown where it is.
      if (what === "accessibility") systemPreferences.isTrustedAccessibilityClient(true)
      else if (what === "screenRecording") {
        await shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        )
      } else if (what === "fullDiskAccess") {
        // Nor is there a question for this one. macOS offers to open the app again once it is given.
        await shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        )
      }
      changed()
    }),
  )
  ipcMain.handle(
    "open-at-login",
    own((on: unknown) => {
      setOpenAtLogin(on === true)
      changed()
    }),
  )
  ipcMain.handle(
    "change-server",
    own(() => showWelcome()),
  )
  ipcMain.handle(
    "update",
    own(() => {
      if (update.state === "ready") restartToUpdate(false)
      else lookForUpdate()
    }),
  )
  ipcMain.handle(
    "retry",
    own(() => {
      if (alive(mainWindow) && settings.server !== undefined) {
        void mainWindow.loadURL(home())
      }
    }),
  )
}

// ---------------------------------------------------------------------------------------------
// The tray and the menus

/** The pair of pictures a page of the deployment last asked the tray to show, if it asked. */
let ownTray: { on: Electron.NativeImage; off: Electron.NativeImage } | undefined

/** A picture a page drew for the tray, at twice a tray's size, as the tray wants it. */
function trayPicture(address: string): Electron.NativeImage | undefined {
  const large = nativeImage.createFromDataURL(address)
  if (large.isEmpty() || !trayFits(large.getSize())) return undefined
  // Linux draws the picture at whatever size its panel is, so it is given the large one.
  if (process.platform === "linux") return large
  // Elsewhere it is one picture at both sizes, for a screen of either kind.
  const image = nativeImage.createEmpty()
  const small = large.resize({ width: TRAY_SIDE, height: TRAY_SIDE, quality: "best" })
  image.addRepresentation({ scaleFactor: 1, dataURL: small.toDataURL() })
  image.addRepresentation({ scaleFactor: 2, dataURL: address })
  return image
}

/**
 * Show a page's pictures in the tray, its owner's own agent, or the usual ones again. They
 * last as long as the app runs, as the picture the app itself is shown by does.
 */
function showTray(asked: unknown): void {
  const pictures = trayPictures(asked)
  if (pictures === undefined) return
  if (pictures === null) ownTray = undefined
  else {
    const [on, off] = [trayPicture(pictures.on), trayPicture(pictures.off)]
    if (on === undefined || off === undefined) return
    ownTray = { on, off }
  }
  drawn = ""
  drawTray()
}

function trayImage(on: boolean) {
  if (ownTray !== undefined) return on ? ownTray.on : ownTray.off
  // Linux draws the picture at whatever size its panel is, so it is given the large one.
  const file = `tray${on ? "" : "-off"}${process.platform === "linux" ? "@2x" : ""}.png`
  return nativeImage.createFromPath(here("assets", file))
}

/** What the tray last showed, so that it is drawn again only when that changed. */
let drawn = ""

function drawTray(): void {
  if (tray === undefined) return
  const now = state()
  const shared = settings.share
  // The daemon says something with every command an agent runs. A menu that is open stays put.
  const newer = update.state === "ready" ? update.version : undefined
  const showing = JSON.stringify([
    now.headline,
    shared,
    settings.openAtLogin,
    settings.server,
    settings.local,
    newer,
  ])
  if (showing === drawn) return
  drawn = showing
  tray.setImage(trayImage(now.sharing.state === "connected"))
  tray.setToolTip(`${NAME}: ${now.headline}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${NAME}`, click: () => showMain() },
      { type: "separator" },
      { label: now.headline, enabled: false },
      {
        label: "Let Doods use this computer",
        type: "checkbox",
        checked: shared,
        enabled: settings.server !== undefined,
        click: () => {
          // Letting them takes a choice or two, which are made in the window. Stopping takes none.
          if (shared) {
            remember({ share: false })
            void runner?.stop()
          } else showComputer()
          // The menu ticked the item itself, which is not yet true. Draw it as things are.
          drawn = ""
          drawTray()
        },
      },
      { label: "This Computer…", click: showComputer },
      ...(settings.local ? [{ label: "Other Devices…", click: showDevices }] : []),
      { type: "separator" },
      {
        label: "Open at sign-in",
        type: "checkbox",
        checked: settings.openAtLogin,
        enabled: now.canOpenAtLogin,
        click: (item) => {
          setOpenAtLogin(item.checked)
          changed()
        },
      },
      { type: "separator" },
      ...(newer === undefined
        ? []
        : [{ label: `Restart to Update to ${newer}`, click: () => restartToUpdate(false) }]),
      { label: `Quit ${NAME}`, click: () => app.quit() },
    ]),
  )
}

function makeTray(): void {
  try {
    tray = new Tray(trayImage(false))
  } catch {
    // A desktop with no tray. The app is still reached by starting it again.
    return
  }
  // On Windows the menu is on the other button, and this one is expected to open the app.
  if (process.platform === "win32") tray.on("click", () => showMain())
  drawTray()
}

function makeMenu(): void {
  const history = (step: "goBack" | "goForward") => () => {
    if (alive(mainWindow)) mainWindow.webContents.navigationHistory[step]()
  }
  const template: MenuItemConstructorOptions[] = [
    ...(MAC ? [{ role: "appMenu" } as const] : []),
    {
      label: "File",
      submenu: [
        { label: "This Computer…", accelerator: "CmdOrCtrl+,", click: showComputer },
        // Where the app runs Do Computer itself: there is nothing to reach on another's server.
        ...(settings.local ? [{ label: "Other Devices…", click: showDevices }] : []),
        { label: "Change Server…", click: showWelcome },
        { type: "separator" },
        MAC ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Back", accelerator: MAC ? "Cmd+[" : "Alt+Left", click: history("goBack") },
        { label: "Forward", accelerator: MAC ? "Cmd+]" : "Alt+Right", click: history("goForward") },
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------------------------------------------------------------------------------------
// Starting and stopping

/** What a page may do with this computer. A page of the deployment may notify and listen. */
function limitPermissions(): void {
  const allowed = new Set(["notifications", "media", "clipboard-sanitized-write", "fullscreen"])
  session.defaultSession.setPermissionRequestHandler((contents, permission, answer) => {
    const from = contents.getURL()
    answer(
      from.startsWith("file:") ||
        (settings.server !== undefined &&
          onServer(from, settings.server) &&
          allowed.has(permission)),
    )
  })
}

if (process.env.APPIMAGE_EXIT_AFTER_INSTALL === "true") {
  // An AppImage that took an older one's place as that one quit is run once, by the old one,
  // for whatever a new one sets up on its first run. This one sets up nothing, and its owner
  // quit the app: it does not start.
  app.exit(0)
} else if (!app.requestSingleInstanceLock()) {
  // It is running already, perhaps with no window showing. That one shows itself.
  app.quit()
} else {
  app.on("second-instance", () => showMain())
  // macOS also says this as the app starts, before there is anything to show a window with.
  app.on("activate", () => {
    if (app.isReady()) showMain()
  })
  // The tray is what ends the program, not its last window closing.
  app.on("window-all-closed", () => {})
  // Every page gets a right-click menu: spelling corrections, cut, copy and paste.
  app.on("web-contents-created", (_event, contents) => {
    withContextMenu(contents, (items) => {
      const window = BrowserWindow.fromWebContents(contents) ?? undefined
      Menu.buildFromTemplate(items).popup({ window })
    })
  })
  app.on("before-quit", () => {
    quitting = true
    // The daemon ends with the program either way; this is so that it ends first.
    void runner?.stop()
    void localServer?.stop()
    overlay?.dispose()
    void screenDriver?.dispose()
  })
  void app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("computer.do.desktop")
    settings = loadSettings(settingsFile())
    limitPermissions()
    listen()
    listenToServer()
    makeMenu()
    makeTray()
    if (settings.server === undefined) void firstRun()
    else if (settings.local) void openLocal()
    else if (!startedHidden()) showMain()
    if (!settings.local) void startSharing()
    setInterval(() => void reachWhenReady(), TAILNET_LOOK_MS)
    void probeDriver()
    startUpdating()
  })
}
