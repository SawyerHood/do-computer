/**
 * The Exact app (apps/do-exact), served by this server itself where `DC_EXACT_APP` names a web
 * build of it (`pnpm build:exact`), so that it is at the app's own origin and has its session.
 *
 * Its files are at `/x/`. Its pages are at the React app's own addresses (`/a/:agentId`, …),
 * since Exact reads a page's route from the whole path and knows no prefix. So whoever opens
 * `/x/` (or `/x/a/…`) is given a cookie that says so and sent to that address, and from then on
 * a page they open there is the Exact app's, until they open `/x/off`. Nothing else is changed:
 * the API, the sockets and every other page are the same for both, and without the cookie, or
 * without `DC_EXACT_APP`, every page is the React app's.
 */

/** Where the Exact app's files are. */
export const EXACT_PREFIX = "/x/"
/** The cookie that says which app someone opens a page in. It picks an app and is no secret. */
export const EXACT_COOKIE = "dc-app"

/** A web build of the Exact app, as `exact web-build --out` writes it. */
export type ExactBuild = {
  /** A file of it by its path within, or undefined where there is none. */
  read(path: string): Promise<Uint8Array | undefined>
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  // Compiled by the browser as it arrives only when it is said to be what it is.
  wasm: "application/wasm",
  ttf: "font/ttf",
  otf: "font/otf",
  woff2: "font/woff2",
  png: "image/png",
  svg: "image/svg+xml",
  md: "text/markdown; charset=utf-8",
}

/** A route of the build's (`routes.json`) as a pattern for a path. */
const pattern = (route: string) =>
  new RegExp(
    `^${route
      .split("/")
      .map((part) => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("/")}$`,
  )

/** The patterns of the build's routes, read once. */
const routesOf = new WeakMap<ExactBuild, Promise<RegExp[]>>()
function routes(build: ExactBuild): Promise<RegExp[]> {
  let found = routesOf.get(build)
  if (found === undefined) {
    found = build.read("routes.json").then((bytes) => {
      if (bytes === undefined) return []
      const { routes } = JSON.parse(new TextDecoder().decode(bytes)) as {
        routes: { pattern: string; notfound?: boolean }[]
      }
      return routes
        .filter((route) => route.notfound !== true)
        .map((route) => pattern(route.pattern))
    })
    routesOf.set(build, found)
  }
  return found
}

/** The path within the build a request names, or undefined where it names none that may be served. */
function fileOf(path: string): string | undefined {
  let parts: string[]
  try {
    parts = path.split("/").map(decodeURIComponent)
  } catch {
    return undefined
  }
  // Nothing hidden (the build's own records), and nothing that would leave the folder.
  if (parts.some((part) => part === "" || part.startsWith(".") || /[\\\0]/.test(part)))
    return undefined
  return parts.join("/")
}

/** Whether a request is a browser opening a page, not a script asking for something. */
const opensPage = (request: Request) =>
  request.method === "GET" &&
  (request.headers.get("sec-fetch-mode") === "navigate" ||
    (!request.headers.has("sec-fetch-mode") &&
      (request.headers.get("accept") ?? "").includes("text/html")))

const chose = (request: Request) =>
  (request.headers.get("cookie") ?? "").split(/;\s*/).includes(`${EXACT_COOKIE}=exact`)

function cookie(request: Request, on: boolean): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""
  return `${EXACT_COOKIE}=${on ? "exact" : ""}; Path=/; Max-Age=${on ? 365 * 24 * 60 * 60 : 0}; SameSite=Lax; HttpOnly${secure}`
}

/** The page every route of the app starts from, its files found under the prefix. */
async function shell(build: ExactBuild): Promise<Response> {
  const bytes = await build.read("index.html")
  if (bytes === undefined) return new Response("The Exact app is not built.", { status: 404 })
  const page = new TextDecoder()
    .decode(bytes)
    .replace(/<base\s+href=["']\/["']\s*\/?>/i, `<base href="${EXACT_PREFIX}">`)
  return new Response(page, {
    headers: { "content-type": TYPES.html!, "cache-control": "no-store", vary: "cookie" },
  })
}

/**
 * Answer what is the Exact app's: its files, `/x/` itself, and the pages of someone who chose
 * it. Anything else is handed to `next` as it came. With no build, everything is.
 */
export async function answerExactApp(
  request: Request,
  build: ExactBuild | undefined,
  next: (request: Request) => Response | Promise<Response>,
): Promise<Response> {
  if (build === undefined) return next(request)
  const url = new URL(request.url)
  const within =
    url.pathname === EXACT_PREFIX.slice(0, -1)
      ? ""
      : url.pathname.startsWith(EXACT_PREFIX)
        ? url.pathname.slice(EXACT_PREFIX.length)
        : undefined
  if (within === undefined) {
    if (!chose(request) || !opensPage(request)) return next(request)
    return (await routes(build)).some((route) => route.test(url.pathname))
      ? shell(build)
      : next(request)
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } })
  }
  if (within === "off") {
    return new Response(null, {
      status: 303,
      headers: { location: "/", "set-cookie": cookie(request, false) },
    })
  }
  const file = within === "" ? undefined : fileOf(within)
  const bytes = file === undefined ? undefined : await build.read(file)
  if (bytes !== undefined) {
    const type = TYPES[file!.split(".").pop() ?? ""] ?? "application/octet-stream"
    return new Response(request.method === "HEAD" ? null : (bytes as BodyInit), {
      headers: {
        "content-type": type,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      },
    })
  }
  if (!opensPage(request)) return new Response("Not found", { status: 404 })
  // `/x/` and `/x/<a page>`: the app is chosen, and the page opened at its own address.
  const page = `/${within}`
  const known = (await routes(build)).some((route) => route.test(page))
  return new Response(null, {
    status: 303,
    headers: {
      location: known ? `${page}${url.search}` : "/",
      "set-cookie": cookie(request, true),
    },
  })
}
