/**
 * A cookie as a server set it, in the words Electron takes one in. The app signs its own
 * window in by asking its own server from outside any page, and gives the window what the
 * server answered with.
 */
export type CookieDetails = {
  url: string
  name: string
  value: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict"
  /** In seconds since 1970. Absent: it lasts as long as the app runs. */
  expirationDate?: number
}

const SAME_SITE = { none: "no_restriction", lax: "lax", strict: "strict" } as const

/** One `Set-Cookie` header for a page at `url`, or undefined when it is not one. */
export function cookieDetails(
  header: string,
  url: string,
  now = Date.now(),
): CookieDetails | undefined {
  const [pair, ...attributes] = header.split(";")
  const at = pair?.indexOf("=") ?? -1
  if (pair === undefined || at < 1) return undefined
  const details: CookieDetails = {
    url,
    name: pair.slice(0, at).trim(),
    // As it was sent: whatever it stands for is the server's to read back.
    value: pair.slice(at + 1).trim(),
    path: "/",
    secure: false,
    httpOnly: false,
    sameSite: "unspecified",
  }
  let expires: number | undefined
  let maxAge: number | undefined
  for (const attribute of attributes) {
    const [name = "", ...rest] = attribute.split("=")
    const value = rest.join("=").trim()
    switch (name.trim().toLowerCase()) {
      case "path":
        if (value.startsWith("/")) details.path = value
        break
      case "secure":
        details.secure = true
        break
      case "httponly":
        details.httpOnly = true
        break
      case "samesite":
        details.sameSite = SAME_SITE[value.toLowerCase() as keyof typeof SAME_SITE] ?? "unspecified"
        break
      case "max-age":
        if (/^-?\d+$/.test(value)) maxAge = Number(value)
        break
      case "expires": {
        const when = Date.parse(value)
        if (!Number.isNaN(when)) expires = when / 1000
        break
      }
    }
  }
  // How long it lasts from now says more than a date does, where a server gave both.
  const until = maxAge === undefined ? expires : now / 1000 + maxAge
  if (until !== undefined) details.expirationDate = until
  return details
}
