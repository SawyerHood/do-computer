import { useCallback, useEffect, useState } from "react"
import { client } from "./client.ts"

/**
 * Whether this browser shows notifications from the app:
 * - `unsupported`: it cannot.
 * - `install`: it could, once the app is on the Home Screen. An iPhone or iPad only delivers
 *   notifications to a site that was added there.
 * - `blocked`: the user said no to the browser, which only they can take back.
 * - `off`, `on`: it can, and is or is not subscribed.
 */
export type NotificationsState = "unsupported" | "install" | "blocked" | "off" | "on"

const WORKER = "/sw.js"

function supported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/** An iPhone or iPad, including an iPad that says it is a Mac. */
function isAppleMobile(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
}

/** Opened from the Home Screen or as an installed app, and not in a browser's tab. */
export function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function toBase64Url(buffer: ArrayBuffer | null): string {
  if (buffer === null) return ""
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

async function subscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(WORKER)
  return (await registration?.pushManager.getSubscription()) ?? null
}

async function readState(): Promise<NotificationsState> {
  if (!supported()) return isAppleMobile() && !isInstalled() ? "install" : "unsupported"
  if (Notification.permission === "denied") return "blocked"
  if (Notification.permission !== "granted") return "off"
  return (await subscription()) === null ? "off" : "on"
}

async function subscribe(registration: ServiceWorkerRegistration): Promise<PushSubscription> {
  const { key } = await client.pushKey()
  const existing = await registration.pushManager.getSubscription()
  // A subscription made for another key, as after the server's data was started afresh, can
  // never be sent to. It is given up for one that can.
  if (existing !== null && toBase64Url(existing.options?.applicationServerKey ?? null) === key) {
    return existing
  }
  await existing?.unsubscribe()
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromBase64Url(key),
  })
}

/**
 * Start the service worker and, where this browser is already subscribed, tell the server it is
 * the signed-in account's. Run once the app is open: whoever signs in on a browser that has
 * notifications on is the one who gets them.
 */
export async function syncNotifications(): Promise<void> {
  if (!supported()) return
  try {
    const registration = await navigator.serviceWorker.register(WORKER)
    if (Notification.permission !== "granted") return
    if ((await registration.pushManager.getSubscription()) === null) return
    await client.registerBrowser((await subscribe(registration)).toJSON())
  } catch {
    // Notifications are a courtesy. The app works without them.
  }
}

/** Ask the browser's leave and subscribe. Has to be called from a tap or a click. */
async function turnOn(): Promise<void> {
  const answer = await Notification.requestPermission()
  if (answer !== "granted") return
  await navigator.serviceWorker.register(WORKER)
  const registration = await navigator.serviceWorker.ready
  await client.registerBrowser((await subscribe(registration)).toJSON())
}

async function turnOff(): Promise<void> {
  const current = await subscription()
  if (current === null) return
  await current.unsubscribe()
  await client.unregisterPush(current.endpoint)
}

/**
 * Stop notifying this browser for the account that is signing out. The browser keeps its
 * subscription, so the next sign-in on it has notifications without asking again.
 */
export async function forgetNotifications(): Promise<void> {
  try {
    if (!supported()) return
    const current = await subscription()
    if (current !== null) await client.unregisterPush(current.endpoint)
  } catch {
    // Signing out goes ahead regardless.
  }
}

/** Notifications on this browser: whether they are on, and turning them on and off. */
export function useNotifications(): {
  /** Undefined until the browser has been asked. */
  state: NotificationsState | undefined
  busy: boolean
  error: string | undefined
  /** What a test said: whether the push service took the notification. */
  tested: boolean | undefined
  enable: () => void
  disable: () => void
  test: () => void
} {
  const [state, setState] = useState<NotificationsState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [tested, setTested] = useState<boolean>()
  useEffect(() => {
    void readState().then(setState, () => setState("unsupported"))
  }, [])
  const run = useCallback((work: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    setTested(undefined)
    void work()
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "That did not work."),
      )
      .then(readState)
      .then(setState, () => undefined)
      .finally(() => setBusy(false))
  }, [])
  return {
    state,
    busy,
    error,
    tested,
    enable: useCallback(() => run(turnOn), [run]),
    disable: useCallback(() => run(turnOff), [run]),
    test: useCallback(
      () =>
        run(async () => {
          const current = await subscription()
          if (current === null) return
          // The server may have lost the subscription; it is given again before it is tried.
          await client.registerBrowser(current.toJSON())
          setTested((await client.testPush(current.endpoint)).ok)
        }),
      [run],
    ),
  }
}
