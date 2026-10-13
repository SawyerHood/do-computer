import { useSyncExternalStore } from "react"

/**
 * The sites whose pictures, films and sounds are loaded without asking. A reply can name
 * something at any address, and loading it tells that address who is reading and whatever the
 * address itself was written to carry, so nothing is loaded from a site the reader has not
 * said yes to. Kept in this browser.
 */

const KEY = "dc-shown-hosts"
const CHANGED = "dc-shown-hosts-changed"

const read = (): string => {
  try {
    return localStorage.getItem(KEY) ?? ""
  } catch {
    // A browser that keeps nothing asks each time.
    return ""
  }
}

const watch = (changed: () => void) => {
  window.addEventListener(CHANGED, changed)
  window.addEventListener("storage", changed)
  return () => {
    window.removeEventListener(CHANGED, changed)
    window.removeEventListener("storage", changed)
  }
}

/** The host of a web address, or undefined where it is not one. */
export function hostOf(address: string): string | undefined {
  try {
    const url = new URL(address, window.location.href)
    return url.protocol === "http:" || url.protocol === "https:" ? url.host : undefined
  } catch {
    return undefined
  }
}

/** Whether what is at `host` is loaded without asking: the app's own address always is. */
export function useShownHost(host: string | undefined): boolean {
  const kept = useSyncExternalStore(watch, read, () => "")
  if (host === undefined) return false
  return host === window.location.host || kept.split("\n").includes(host)
}

/** From now on, load what is at `host` without asking. */
export function alwaysShow(host: string) {
  const hosts = new Set(read().split("\n").filter(Boolean))
  hosts.add(host)
  try {
    localStorage.setItem(KEY, [...hosts].join("\n"))
  } catch {
    // Not kept, then: it is shown this once.
  }
  window.dispatchEvent(new Event(CHANGED))
}
