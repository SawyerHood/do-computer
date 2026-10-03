const MAX_REDIRECTS = 5

/** `fetch`, as far as the guard needs it. */
export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export type GuardOptions = {
  /** Also allow plain http, to public hosts. For an agent's own requests, not for credentials. */
  readonly allowHttp?: boolean
  /**
   * Look a host name up, where the runtime can. A public name that points at a private address
   * is then refused too, which reading the name alone cannot do.
   */
  readonly resolve?: (hostname: string) => Promise<readonly string[]>
}

/** Thrown for an address the server refuses to call on a user's or an agent's word. */
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

/** Reject an address the server may not call for someone; returns it parsed otherwise. */
export function checkAddress(
  input: string | URL,
  allowPrivate: boolean,
  options: GuardOptions = {},
): URL {
  const url = new URL(String(input))
  if (allowPrivate) {
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new BlockedAddressError(`${url.protocol} addresses are not supported.`)
    return url
  }
  if (url.protocol !== "https:" && !(options.allowHttp === true && url.protocol === "http:")) {
    throw new BlockedAddressError(
      options.allowHttp === true
        ? `${url.protocol} addresses are not supported.`
        : "The address must start with https://.",
    )
  }
  if (isPrivateHost(url.hostname))
    throw new BlockedAddressError(
      `${url.hostname} is on a private network, which this server does not connect to.`,
    )
  return url
}

/** `checkAddress`, and where host names can be looked up, a check of what the name points at. */
async function review(input: string | URL, options: GuardOptions): Promise<URL> {
  const url = checkAddress(input, false, options)
  const literal = url.hostname.startsWith("[") || /^[\d.]+$/.test(url.hostname)
  if (options.resolve !== undefined && !literal) {
    const addresses = await options.resolve(url.hostname).catch(() => [])
    const inside = addresses.find((address) =>
      isPrivateHost(address.includes(":") ? `[${address}]` : address),
    )
    if (inside !== undefined) {
      throw new BlockedAddressError(
        `${url.hostname} points at a private network (${inside}), which this server does not connect to.`,
      )
    }
  }
  return url
}

/**
 * `fetch` for addresses that come from a user or from the agent: connectors, skills installed
 * from a URL, and what an agent fetches from the built-in computer. The server makes these calls
 * from inside its own network, so every request, including each redirect and every address a
 * service's sign-in metadata points to, is checked against the same rule instead of trusting the
 * first address alone.
 */
export function guardedFetch(
  inner: Fetch,
  allowPrivate: boolean,
  options: GuardOptions = {},
): Fetch {
  if (allowPrivate) return inner
  return async (input, init) => {
    let url = await review(input, options)
    let request: RequestInit = { ...init, redirect: "manual" }
    for (let hop = 0; ; hop++) {
      const response = await inner(url, request)
      const location = response.headers.get("location")
      if (response.status < 300 || response.status >= 400 || location === null) return response
      // The caller asked to see redirects for itself; it will come back here for the next hop.
      if (init?.redirect === "manual") return response
      if (hop === MAX_REDIRECTS) throw new BlockedAddressError("Too many redirects.")
      await response.body?.cancel().catch(() => {})
      url = await review(new URL(location, url), options)
      // 307 and 308 repeat the request; the others turn into a plain GET, as browsers do.
      if (response.status !== 307 && response.status !== 308) {
        const headers = new Headers(request.headers)
        headers.delete("content-type")
        request = { ...request, method: "GET", body: undefined, headers }
      }
    }
  }
}
