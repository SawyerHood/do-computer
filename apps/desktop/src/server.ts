/**
 * The address of a deployment as someone typed it, made into the one the app uses: its origin,
 * with `https://` where no scheme was given, and `http://` for this machine itself. Undefined
 * when it is no address.
 */
export function serverAddress(typed: string): string | undefined {
  const text = typed.trim()
  if (text === "") return undefined
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(text)
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http${local ? "" : "s"}://${text}`,
    )
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    if (url.hostname === "") return undefined
    return url.origin
  } catch {
    return undefined
  }
}

/** Whether an address is a page of the deployment, as opposed to somewhere else on the web. */
export function onServer(address: string, server: string): boolean {
  try {
    return new URL(address).origin === new URL(server).origin
  } catch {
    return false
  }
}

/**
 * A page of the deployment, at the address the app's window goes to it by. The app's own server
 * may be reached at a second address, which is the one it hands out and sends people back to;
 * the window is signed in at the first, and stays there. Undefined for anywhere else.
 */
export function atServer(address: string, server: string, also?: string): string | undefined {
  if (onServer(address, server)) return address
  if (also === undefined || !onServer(address, also)) return undefined
  const { pathname, search, hash } = new URL(address)
  return `${new URL(server).origin}${pathname}${search}${hash}`
}

/** Whether an address is one a browser can be sent to. */
export function isWebAddress(address: string): boolean {
  try {
    const { protocol } = new URL(address)
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}

/**
 * Whether a sign-in that went somewhere else has come back: to a page of the deployment, and
 * not to one of the addresses under `/api/` that a service answers at, which lead to a page.
 */
export function cameBack(address: string, server: string): boolean {
  return onServer(address, server) && !new URL(address).pathname.startsWith("/api/")
}
