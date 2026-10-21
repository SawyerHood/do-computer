import { SCREEN_ADAPTERS, type ScreenAdapterName } from "./adapters/index.ts"

/** What a run of the daemon was asked for on its command line. */
export type Arguments = {
  /** The deployment to pair with. Only needed the first time; after that it is remembered. */
  server: string | undefined
  /** What the agent should call this computer. */
  name: string | undefined
  readOnly: boolean
  installService: boolean
  /** Whether to keep itself up to date, where the command line says. Otherwise as it was. */
  autoUpdate: boolean | undefined
  /** Whether agents may use a browser here, where the command line says. Otherwise as it was. */
  browser: boolean | undefined
  screen: boolean | undefined
  wakeDisplay: boolean | undefined
  screenAdapter: ScreenAdapterName | undefined
  browserAdapter: "dev-browser" | undefined
  doctor: boolean
  unpair: boolean
  version: boolean
  help: boolean
}

/**
 * Reads the command line. The server is the first argument that is an address, wherever it is
 * put, except the word after `--name`: someone could name their computer like one.
 */
export function parseArguments(args: readonly string[]): Arguments {
  const nameAt = args.indexOf("--name")
  const named = nameAt === -1 ? undefined : nameAt + 1
  const value = (flag: string) => {
    const assigned = args.find((arg) => arg.startsWith(`${flag}=`))
    if (assigned !== undefined) return assigned.slice(flag.length + 1)
    const at = args.indexOf(flag)
    if (at === -1) return undefined
    const next = args[at + 1]
    if (!next || next.startsWith("--")) throw new Error(`${flag} needs a value`)
    return next
  }
  // `--screen` and `--browser` read alike: `--flag=MODE`, `--flag MODE`, or the bare flag, which
  // turns the thing on. A following option or server address is never taken as the mode, so
  // `--browser https://server` and `--screen https://server` both mean "on" with that server.
  const mode = (flag: string): string | undefined => {
    const assigned = args.find((arg) => arg.startsWith(`${flag}=`))
    if (assigned !== undefined) return assigned.slice(flag.length + 1)
    const at = args.indexOf(flag)
    if (at === -1) return undefined
    const next = args[at + 1]
    return next !== undefined && !next.startsWith("-") && !/^https?:\/\//.test(next) ? next : ""
  }
  const screenMode = mode("--screen")
  const screenModes: Record<string, ScreenAdapterName> = {
    auto: "auto",
    off: "none",
    wayland: "hyprland",
    hyprland: "hyprland",
    x11: "x11",
    embedded: "ipc",
    ipc: "ipc",
  }
  if (screenMode && !Object.hasOwn(screenModes, screenMode))
    throw new Error(`Unknown screen mode: ${screenMode}`)
  const browserMode = mode("--browser")
  if (browserMode && !["auto", "off", "dev-browser"].includes(browserMode))
    throw new Error(`Unknown browser mode: ${browserMode}`)
  const screenAdapter =
    value("--screen-adapter") ?? (screenMode ? screenModes[screenMode] : undefined)
  if (
    screenAdapter !== undefined &&
    !(SCREEN_ADAPTERS as readonly string[]).includes(screenAdapter)
  )
    throw new Error(`Unknown screen adapter: ${screenAdapter}`)
  const browserAdapter = value("--browser-adapter")
  if (browserAdapter !== undefined && browserAdapter !== "dev-browser")
    throw new Error(`Unknown browser adapter: ${browserAdapter}`)
  const server = args.find((arg, index) => /^https?:\/\//.test(arg) && index !== named)
  return {
    server: server?.replace(/\/+$/, ""),
    name: named === undefined ? undefined : args[named],
    readOnly: args.includes("--read-only"),
    installService: args.includes("--install-service"),
    autoUpdate: args.includes("--no-auto-update")
      ? false
      : args.includes("--auto-update")
        ? true
        : undefined,
    browser:
      args.includes("--no-browser") || browserMode === "off"
        ? false
        : args.includes("--browser") || browserMode !== undefined
          ? true
          : undefined,
    screen:
      args.includes("--no-screen") || screenMode === "off"
        ? false
        : args.includes("--enable-screen") || screenMode !== undefined
          ? true
          : undefined,
    wakeDisplay: args.includes("--no-wake-display")
      ? false
      : args.includes("--wake-display")
        ? true
        : undefined,
    screenAdapter: screenAdapter as ScreenAdapterName | undefined,
    browserAdapter: browserAdapter as "dev-browser" | undefined,
    doctor: args.includes("--doctor"),
    unpair: args.includes("--unpair"),
    version: args.includes("--version"),
    help: args.includes("--help") || args.includes("-h"),
  }
}

/** The screen and browser settings a daemon remembers. */
type ScreenSettings = {
  screen?: boolean
  wakeDisplay?: boolean
  screenAdapter?: ScreenAdapterName
  browserAdapter?: "dev-browser"
}

/**
 * The saved settings with what the command line said about the screen and browser adapters.
 * Turning the screen on (--enable-screen, or a bare --screen) undoes an earlier --screen=off,
 * which saved the adapter as "none"; naming an adapter replaces it outright.
 */
export function withScreenArguments<T extends ScreenSettings>(config: T, asked: Arguments): T {
  const next = { ...config }
  if (asked.screen !== undefined) next.screen = asked.screen
  if (asked.wakeDisplay !== undefined) next.wakeDisplay = asked.wakeDisplay
  if (asked.browserAdapter !== undefined) next.browserAdapter = asked.browserAdapter
  if (asked.screenAdapter !== undefined) next.screenAdapter = asked.screenAdapter
  else if (asked.screen === true && next.screenAdapter === "none") delete next.screenAdapter
  return next
}
