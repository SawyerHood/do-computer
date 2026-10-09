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
 */
import * as os from "node:os"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import {
  app,
  BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  nativeTheme,
  net,
  session,
  shell,
  Tray,
} from "electron"
import type { AppState } from "./api.ts"
import { HIDDEN_FLAG, setLinuxAutostart } from "./autostart.ts"
import { DaemonRunner, seedDaemon } from "./daemon.ts"
import { loginPath } from "./login-path.ts"
import { isWebAddress, onServer, serverAddress } from "./server.ts"
import { loadSettings, type Settings, saveSettings } from "./settings.ts"
import { headline } from "./status.ts"

/** The deployment the app was built for, if it was built for one. Otherwise it asks. */
declare const DEFAULT_SERVER: string

const NAME = "Do Computer"
const MAC = process.platform === "darwin"
const here = (...parts: string[]) => path.join(__dirname, ...parts)
const page = (name: string) => here("pages", `${name}.html`)

// A run with a folder of its own: the tests', or a second copy beside the first.
if (process.env.DC_DESKTOP_DATA) app.setPath("userData", process.env.DC_DESKTOP_DATA)
else app.setName(NAME)

const settingsFile = () => path.join(app.getPath("userData"), "settings.json")
let settings: Settings = { share: false, readOnly: false, openAtLogin: false }
const remember = (change: Partial<Settings>) => {
  settings = { ...settings, ...change }
  saveSettings(settingsFile(), settings)
}

let mainWindow: BrowserWindow | undefined
let computerWindow: BrowserWindow | undefined
let welcomeWindow: BrowserWindow | undefined
let tray: Tray | undefined
let runner: DaemonRunner | undefined
let quitting = false
/** The PATH commands run with, once it has been asked for. */
let commandPath: string | undefined
/** Set when the owner has just asked to share this computer, so the page to confirm on is shown. */
let showConfirm = false
let confirmTimer: ReturnType<typeof setInterval> | undefined

const alive = (window: BrowserWindow | undefined): window is BrowserWindow =>
  window !== undefined && !window.isDestroyed()

/** The app started by itself at sign-in, where nobody asked to see it. */
const startedHidden = () =>
  process.argv.includes(HIDDEN_FLAG) || (MAC && app.getLoginItemSettings().wasOpenedAtLogin)

// ---------------------------------------------------------------------------------------------
// State, as the app's pages and the tray show it

function state(): AppState {
  const sharing = runner?.sharing ?? { state: "off" }
  return {
    ...(settings.server === undefined ? {} : { server: settings.server }),
    suggestedServer: settings.server ?? (process.env.DC_DESKTOP_SERVER || DEFAULT_SERVER),
    sharing,
    headline: headline(sharing),
    readOnly: settings.readOnly,
    openAtLogin: settings.openAtLogin,
    canOpenAtLogin: app.isPackaged || process.env.DC_DESKTOP_AUTOSTART === "1",
    log: runner?.lines ?? [],
    platform: process.platform,
  }
}

function changed(): void {
  const now = state()
  for (const window of [computerWindow, welcomeWindow, mainWindow]) {
    if (alive(window) && window.webContents.getURL().startsWith("file:")) {
      window.webContents.send("state", now)
    }
  }
  drawTray()
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

/** Links that lead away from the deployment open in the browser, where its owner is at home. */
function keepToServer(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (settings.server !== undefined && onServer(url, settings.server)) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } }
    }
    if (isWebAddress(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
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
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 480,
    title: NAME,
    backgroundColor: canvas(),
    autoHideMenuBar: true,
    ...(MAC ? {} : { icon: icon()! }),
    webPreferences: webPreferences(),
  })
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
  // Signing in is a change of page, and is what a pairing waits for.
  window.webContents.on("did-navigate", () => void confirmWhenSignedIn())
  window.webContents.on("did-navigate-in-page", () => void confirmWhenSignedIn())
  void window.loadURL(address ?? settings.server)
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
  welcomeWindow = ownWindow("welcome", { width: 480, height: 560, title: NAME })
  welcomeWindow.on("closed", () => (welcomeWindow = undefined))
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
    env: () => ({ ...process.env, ...(commandPath === undefined ? {} : { PATH: commandPath }) }),
    onChange: changed,
    onRevoked: () => remember({ share: false }),
  })
  return runner
}

async function startSharing(): Promise<void> {
  if (settings.server === undefined) return
  // Once: asking takes as long as the owner's shell takes to start.
  commandPath ??= (await loginPath()) ?? process.env.PATH
  if (settings.share && settings.server !== undefined) {
    daemon().start(settings.server, settings.readOnly)
  }
}

async function signedIn(): Promise<boolean> {
  if (settings.server === undefined) return false
  try {
    return (await session.defaultSession.fetch(`${settings.server}/api/me`)).ok
  } catch {
    return false
  }
}

/**
 * A pairing is confirmed on a page of the deployment, signed in. When the owner has just asked
 * to share this computer, show them that page as soon as they are.
 */
async function confirmWhenSignedIn(): Promise<void> {
  const sharing = runner?.sharing
  if (!showConfirm || sharing?.state !== "pairing") {
    clearInterval(confirmTimer)
    confirmTimer = undefined
    return
  }
  // Signing in with a password changes no address the window tells of, so also look now and then.
  confirmTimer ??= setInterval(() => void confirmWhenSignedIn(), 2_000)
  const address = sharing.verifyUrl
  if (!(await signedIn())) return
  if (!showConfirm || runner?.sharing.state !== "pairing") return
  showConfirm = false
  if (isWebAddress(address)) showMain(address)
}

function setOpenAtLogin(on: boolean): void {
  remember({ openAtLogin: on })
  if (!state().canOpenAtLogin) return
  if (process.platform === "linux") {
    setLinuxAutostart(on, {
      home: os.homedir(),
      configHome: process.env.XDG_CONFIG_HOME,
      // An AppImage runs from a folder that is gone when it stops. The file itself is what stays.
      exec: process.env.APPIMAGE || process.execPath,
    })
  } else {
    app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_FLAG] })
  }
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

function listen(): void {
  ipcMain.handle("state", own(state))
  ipcMain.handle(
    "connect",
    own(async (choice: { server?: unknown; share?: unknown; openAtLogin?: unknown }) => {
      const server = serverAddress(typeof choice?.server === "string" ? choice.server : "")
      if (server === undefined) return "That is not an address."
      const healthy = await net
        .fetch(`${server}/api/health`)
        .then(async (response) => response.ok && (await response.json())?.ok === true)
        .catch(() => false)
      if (!healthy) return `There is no Do Computer at ${server}, or it cannot be reached.`
      if (settings.server !== undefined && settings.server !== server) {
        // This computer is paired with the deployment it is leaving, and a daemon has one.
        await daemon().forget()
      }
      remember({ server, share: choice.share === true })
      setOpenAtLogin(choice.openAtLogin === true)
      if (!settings.share) await runner?.stop()
      showConfirm = settings.share
      welcomeWindow?.close()
      showMain(server)
      void startSharing()
      return undefined
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
    "retry",
    own(() => {
      if (alive(mainWindow) && settings.server !== undefined) {
        void mainWindow.loadURL(settings.server)
      }
    }),
  )
}

// ---------------------------------------------------------------------------------------------
// The tray and the menus

function trayImage(on: boolean) {
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
  const showing = JSON.stringify([now.headline, shared, settings.openAtLogin, settings.server])
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
        label: "Let agents use this computer",
        type: "checkbox",
        checked: shared,
        enabled: settings.server !== undefined,
        click: () => {
          // Letting them takes a choice or two, which are made in the window. Stopping takes none.
          if (shared) {
            remember({ share: false })
            void runner?.stop()
          } else showComputer()
        },
      },
      { label: "This Computer…", click: showComputer },
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

if (!app.requestSingleInstanceLock()) {
  // It is running already, perhaps with no window showing. That one shows itself.
  app.quit()
} else {
  app.on("second-instance", () => showMain())
  app.on("activate", () => showMain())
  // The tray is what ends the program, not its last window closing.
  app.on("window-all-closed", () => {})
  app.on("before-quit", () => {
    quitting = true
    // The daemon ends with the program either way; this is so that it ends first.
    void runner?.stop()
  })
  void app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("computer.do.desktop")
    settings = loadSettings(settingsFile())
    limitPermissions()
    listen()
    makeMenu()
    makeTray()
    if (settings.server === undefined) showWelcome()
    else if (!startedHidden()) showMain()
    void startSharing()
  })
}
