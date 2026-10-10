/** What counts calls: Cloudflare's rate limiting binding, or a stand-in for it. */
export type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> }

/**
 * What a request is counted as, or undefined where it is not counted.
 *
 * Counted are the calls anyone can make without an account, each of which costs something that
 * every user shares: signing in or up hashes a password and writes to the database, and a
 * computer asking to be paired takes one of a fixed number of places. Everything else is
 * either read-only or asked by someone signed in, whose account is what bounds it.
 *
 * They are counted by address, the only thing known about whoever is asking. Many people can
 * share one, so the limit has to be far above what a household or an office does by hand.
 */
export function limitedAs(request: Request): string | undefined {
  if (request.method !== "POST") return undefined
  // Set by Cloudflare, and not something a client can set for itself there. Where there is no
  // Cloudflare in front there is nothing to count by.
  const address = request.headers.get("cf-connecting-ip")
  if (address === null || address === "") return undefined
  const { pathname } = new URL(request.url)
  if (pathname === "/api/computers/pair/start") return `pair:${address}`
  if (pathname.startsWith("/api/auth/")) return `auth:${address}`
  return undefined
}

/**
 * The answer to a request that is over its limit, or undefined to let it through. A limiter
 * that fails lets everything through: it is a guard against abuse, not something sign-in
 * should depend on.
 */
export async function overLimit(
  request: Request,
  limiter: Limiter | undefined,
): Promise<Response | undefined> {
  if (limiter === undefined) return undefined
  const key = limitedAs(request)
  if (key === undefined) return undefined
  const allowed = await limiter.limit({ key }).then(
    (outcome) => outcome.success,
    () => true,
  )
  if (allowed) return undefined
  const message = "Too many tries from this network. Wait a minute and try again."
  // `error` is what the app's own calls read, and `message` what the sign-in library's do.
  return Response.json(
    { error: message, message, code: "rate_limited" },
    { status: 429, headers: { "retry-after": "60" } },
  )
}
