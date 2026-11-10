/** What a client app from another origin may send, and may read of a reply. */
const ALLOWED = {
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept",
  // The session a sign-in hands a client that keeps no cookie.
  "access-control-expose-headers": "set-auth-token",
  "access-control-max-age": "600",
} as const

/**
 * Answer a request from a client app that is served from another origin (`DC_CLIENT_ORIGINS`)
 * so that a browser lets its page read the reply. Any other request is answered as it was.
 *
 * Credentials are not allowed: a browser then sends such a request no cookie, and the client
 * says who it is with `Authorization: Bearer`, which a page on some other site cannot.
 */
export async function answerClientOrigin(
  request: Request,
  origins: readonly string[],
  next: (request: Request) => Response | Promise<Response>,
): Promise<Response> {
  const origin = request.headers.get("origin")
  if (origin === null || !origins.includes(origin)) return next(request)
  const allow = { ...ALLOWED, "access-control-allow-origin": origin, vary: "origin" }
  // A browser asks before it sends anything that is not a plain form's.
  if (request.method === "OPTIONS" && request.headers.has("access-control-request-method")) {
    return new Response(null, { status: 204, headers: allow })
  }
  const response = await next(request)
  // A WebSocket's answer is not a reply a page reads, and cannot be made again.
  if (response.status === 101) return response
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(allow)) headers.set(name, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
