import type { BrowserIO, ScreenIO } from "@do-computer/computers/daemon"
import type { ComputerAdapterStatus } from "@do-computer/protocol"
import { nodeBrowserIO } from "@do-computer/computers/browser"
import { appScreen } from "../screen.ts"
import { commands } from "./command.ts"
import { executable, linuxDriver, LINUX_TOOLS, ScreenNotReady, type LinuxOptions } from "./linux.ts"
import { nativeScreen } from "./native-screen.ts"
import { discoverSession } from "./session.ts"

export const SCREEN_ADAPTERS = ["auto", "ipc", "hyprland", "x11", "none"] as const
export type ScreenAdapterName = (typeof SCREEN_ADAPTERS)[number]
export type AdapterReport = {
  adapter: string
  enabled: boolean
  available: boolean
  ready: boolean
  reason?: string
  tools?: string[]
  actions?: string[]
}
export type SelectedScreen = {
  screen?: ScreenIO
  report: AdapterReport
  rediscover?: boolean
  refresh?(): Promise<void>
  dispose(): void
}
const desktopActions = [
  "screenshot",
  "click",
  "double_click",
  "right_click",
  "move",
  "drag",
  "scroll",
  "type",
  "key",
  "wait",
]
export function adapterStatus(report: AdapterReport): ComputerAdapterStatus {
  return {
    name: report.adapter,
    state: !report.available
      ? "unsupported"
      : !report.enabled
        ? "disabled"
        : !report.ready
          ? "blocked"
          : "ready",
    reason: report.reason ?? (!report.enabled ? "Disabled by the owner." : undefined),
    tools: report.tools,
    actions: report.actions,
  }
}

export function screenRefusal(report: AdapterReport): string {
  const status = adapterStatus(report)
  if (status.state === "disabled")
    return `Screen sharing is disabled by its owner. ${report.adapter === "ipc" ? "Its owner can enable it in the desktop app and check daemon --screen=auto if it was explicitly disabled there." : "Its owner can enable it locally with --screen=auto or --enable-screen."} Screen sharing must not be enabled without the owner\'s consent.`
  if (status.state === "ready") return "The screen adapter is starting. Retry shortly."
  return `Screen sharing is ${status.state === "blocked" ? "available but currently blocked" : "unsupported here"} (${status.name}). ${status.reason ?? "Run --doctor on this computer for diagnostics."}`
}
class ProbeTimeout extends Error {}

/** Includes filesystem and metadata discovery; a bad probe must not prevent the daemon connecting. */
async function probe<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new ProbeTimeout("Screen adapter probe timed out")
          controller.abort(error)
          reject(error)
        }, 10_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function selectScreen(options: {
  enabled: boolean
  adapter?: ScreenAdapterName
  embedded: boolean
  env: NodeJS.ProcessEnv
  wakeDisplay?: boolean
  platform?: NodeJS.Platform
  input?: NodeJS.ReadableStream
  print?: (line: string) => void
  linux?: Partial<LinuxOptions>
}): Promise<SelectedScreen> {
  let env = options.env
  let discoveryReason: string | undefined
  let discoveryBlocked = false
  const platform = options.platform ?? process.platform
  let adapter = options.adapter ?? "auto"
  const report: AdapterReport = {
    adapter,
    enabled: options.enabled && adapter !== "none",
    available: false,
    ready: false,
  }
  const result: SelectedScreen = { report, dispose() {} }
  if (!(SCREEN_ADAPTERS as readonly string[]).includes(adapter)) {
    report.reason = `Unknown screen adapter: ${adapter}`
    return result
  }
  if (adapter === "none") {
    report.available = true
    report.reason = "Screen adapter is explicitly disabled."
    return result
  }
  if (!options.embedded && platform === "linux" && adapter !== "ipc") {
    try {
      const discovered = await probe((signal) =>
        discoverSession(env, options.linux?.run ?? commands(env), options.linux?.uid, signal),
      )
      env = discovered.env
      discoveryReason = discovered.reason
      discoveryBlocked = discovered.blocked === true
    } catch (error) {
      discoveryReason = (error as Error).message
      discoveryBlocked = true
    }
  }
  if (adapter === "auto") {
    if (options.embedded) adapter = "ipc"
    else if (env.WAYLAND_DISPLAY && (env.HYPRLAND_INSTANCE_SIGNATURE || !discoveryBlocked))
      adapter = env.HYPRLAND_INSTANCE_SIGNATURE ? "hyprland" : "none"
    else if (env.DISPLAY && !env.WAYLAND_DISPLAY && !discoveryBlocked) adapter = "x11"
    else {
      if (platform === "linux" && (options.linux?.uid ?? process.getuid?.()) !== 0) {
        const installed = await probe(async (signal) => {
          const candidates: ("hyprland" | "x11")[] = []
          for (const id of ["hyprland", "x11"] as const) {
            let found = true
            for (const tool of LINUX_TOOLS[id]) {
              signal.throwIfAborted()
              if (!(await (options.linux?.has?.(tool) ?? executable(tool, env)))) {
                found = false
                break
              }
            }
            if (found) candidates.push(id)
          }
          return candidates
        }).catch(() => [])
        report.available = installed.length > 0
        if (installed.length) {
          report.tools = [...new Set(installed.flatMap((id) => [...LINUX_TOOLS[id]]))]
          report.actions = desktopActions
        }
        report.reason = installed.length
          ? `${discoveryReason ?? "No graphical session is available."} Installed adapters: ${installed.join(", ")}.`
          : `No installed native screen backend was found. Hyprland needs ${LINUX_TOOLS.hyprland.join("/")}; X11 needs ${LINUX_TOOLS.x11.join("/")}.${discoveryReason ? ` ${discoveryReason}` : ""}`
      } else
        report.reason = discoveryReason ?? "This platform requires the desktop-app screen adapter."
      return result
    }
  }
  report.adapter = adapter
  if (adapter === "none") {
    report.reason = `No supported backend for this Wayland compositor; portal support is not implemented.${discoveryReason ? ` ${discoveryReason}` : ""}`
    return result
  }
  try {
    if (adapter === "ipc") {
      if (!options.embedded)
        throw new Error(
          "The IPC adapter requires a desktop-app parent, not just a screen environment flag.",
        )
      const ipc = appScreen(options.print ?? console.log, options.input ?? process.stdin)
      result.dispose = () => ipc.dispose()
      try {
        const status = await ipc.inspect(options.enabled)
        report.available = status.available
        report.enabled = options.enabled && status.enabled
        report.ready = status.available
        report.reason = status.reason
        if (report.enabled && report.available) result.screen = ipc
        else ipc.dispose()
      } catch (error) {
        ipc.dispose()
        throw error
      }
    } else {
      if (platform !== "linux") throw new Error(`${adapter} is available only on Linux`)
      result.rediscover =
        !env.XDG_SESSION_ID ||
        (adapter === "hyprland"
          ? !env.WAYLAND_DISPLAY || !env.XDG_RUNTIME_DIR || !env.HYPRLAND_INSTANCE_SIGNATURE
          : !env.DISPLAY)
      report.tools = [...LINUX_TOOLS[adapter]]
      report.actions = desktopActions
      const driver = linuxDriver(adapter, {
        env,
        run: commands(env),
        wakeDisplay: options.wakeDisplay,
        ...options.linux,
      })
      result.refresh = async () => {
        try {
          await probe((signal) => driver.probe(signal))
          report.available = true
          report.ready = true
          report.reason = undefined
        } catch (error) {
          report.available = error instanceof ScreenNotReady || error instanceof ProbeTimeout
          report.ready = false
          report.reason = error instanceof Error ? error.message : String(error)
        }
      }
      await result.refresh()
      if (report.available && options.enabled) {
        const native = nativeScreen(driver)
        result.screen = native
        result.dispose = () => native.dispose()
      }
    }
  } catch (error) {
    report.reason = error instanceof Error ? error.message : String(error)
  }
  return result
}

/** Browser permission and backend choice never depend on a display session. */
export function selectBrowser(options: {
  enabled: boolean
  adapter?: "dev-browser"
  dir: string
  log: (message: string) => void
}): { browser?: BrowserIO; report: AdapterReport } {
  const factories = { "dev-browser": () => nodeBrowserIO({ dir: options.dir, log: options.log }) }
  const adapter = options.adapter ?? "dev-browser"
  if (!Object.hasOwn(factories, adapter))
    return {
      report: {
        adapter,
        enabled: options.enabled,
        available: false,
        ready: false,
        reason: "Unknown browser adapter",
      },
    }
  return {
    ...(options.enabled ? { browser: factories[adapter]() } : {}),
    report: { adapter, enabled: options.enabled, available: true, ready: true, tools: ["CDP"] },
  }
}
