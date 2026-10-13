import { atom, getDefaultStore, useAtomValue } from "jotai"
import { serverAtom } from "@/lib/session"
import { storage } from "@/lib/storage"
import { isShownHost, withHost } from "./logic"

/**
 * The sites whose pictures are loaded without asking. A reply can name something at any
 * address, and loading it tells that address who is reading and whatever the address itself was
 * written to carry, so nothing is loaded from a site the reader has not said yes to. Kept on
 * this device.
 */

const KEY = "dc.shown-hosts"

const keptAtom = atom(storage.get(KEY) ?? "")

/** Whether what is at `host` is loaded without asking: the app's own deployment always is. */
export function useShownHost(host: string): boolean {
  return isShownHost(host, useAtomValue(serverAtom), useAtomValue(keptAtom))
}

/** From now on, load what is at `host` without asking. */
export function alwaysShow(host: string): void {
  const store = getDefaultStore()
  const kept = withHost(store.get(keptAtom), host)
  storage.set(KEY, kept)
  store.set(keptAtom, kept)
}
