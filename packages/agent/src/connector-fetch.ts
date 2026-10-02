import type { McpFetch } from "@earendil-works/pi-mcp"

const MAX_REDIRECTS = 5

/** Thrown for an address the server refuses to call on a user's behalf. */
export class BlockedAddressError extends Error {}

function privateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false
  const [a, b] = parts as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

/**
 * Whether `hostname` names this machine or a private network: loopback, link-local (where cloud
 * metadata services live), the private ranges, and names that only resolve inside a network.
 * It judges the name as written; a public name that resolves to a private address is not caught.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  if (host.startsWith("[")) {
    const address = host.slice(1, -1)
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address)
    if (mapped) return privateIpv4(mapped[1]!)
    // Loopback, unspecified, IPv4-mapped in hex, unique local (fc00::/7), link-local (fe80::/10).
    return (
      address === "::1" ||
      address === "::" ||
      address.startsWith("::ffff:") ||
      /^f[cd]/.test(address) ||
      /^fe[89ab]/.test(address)
    )
  }
  if (/^[\d.]+$/.test(host)) return privateIpv4(host)
  return (
    host === "localhost" ||
    !host.includes(".") ||
    /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)
  )
}

/** Reject an address a connector may not use; returns it parsed otherwise. */
export function checkConnectorAddress(input: string | URL, allowPrivate: boolean): URL {
  const url = new URL(String(input))
  if (allowPrivate) {
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new BlockedAddressError(`${url.protocol} addresses are not supported.`)
    return url
  }
  if (url.protocol !== "https:")
    throw new BlockedAddressError("A connector's address must start with https://.")
  if (isPrivateHost(url.hostname))
    throw new BlockedAddressError(
      `${url.hostname} is on a private network, which this server does not connect to.`,
    )
  return url
}

/**
 * `fetch` for connectors. A connector's address comes from a user and the server calls it, so
 * every request, including each redirect and every address the service's sign-in metadata points
 * to, is checked against the same rule instead of trusting the first address alone.
 */
export function guardedFetch(inner: McpFetch, allowPrivate: boolean): McpFetch {
  if (allowPrivate) return inner
  return async (input, init) => {
    let url = checkConnectorAddress(input, false)
    let request: RequestInit = { ...init, redirect: "manual" }
    for (let hop = 0; ; hop++) {
      const response = await inner(url, request)
      const location = response.headers.get("location")
      if (response.status < 300 || response.status >= 400 || location === null) return response
      if (hop === MAX_REDIRECTS) throw new BlockedAddressError("Too many redirects.")
      await response.body?.cancel().catch(() => {})
      url = checkConnectorAddress(new URL(location, url), false)
      // 307 and 308 repeat the request; the others turn into a plain GET, as browsers do.
      if (response.status !== 307 && response.status !== 308) {
        const headers = new Headers(request.headers)
        headers.delete("content-type")
        request = { ...request, method: "GET", body: undefined, headers }
      }
    }
  }
}
