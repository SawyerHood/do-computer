import { getPlatform } from "#platform"
import { LIBRARY_SITE_HEADER, remoteLibrary, SiteError } from "@durable-computer/agent"
import { isPersonalWorkspace, sitePath, siteRoot, siteTitleFor } from "@durable-computer/protocol"
import { agentFor, fail, json } from "./agents.ts"
import { getUser, type SessionUser } from "./auth.ts"
import {
  changeSite,
  shareSite,
  siteById,
  type SiteRow,
  sitesOf,
  stopSite,
} from "./site-directory.ts"
import { roleIn } from "./teams.ts"

/** The sites of the workspace an agent is in, for someone who may use the agent. */
export async function listSites(user: SessionUser, agentId: string): Promise<Response> {
  const access = await agentFor(user, agentId)
  if (access === undefined) return fail(404, "Agent not found")
  return json({ sites: await sitesOf(getPlatform().db, access.workspaceId) })
}

/** Someone shares a page or a folder of the library as a site. */
export async function createSite(
  user: SessionUser,
  request: Request,
  agentId: string,
): Promise<Response> {
  const access = await agentFor(user, agentId)
  if (access === undefined) return fail(404, "Agent not found")
  const input = (await request.json().catch(() => ({}))) as { path?: unknown; title?: unknown }
  if (typeof input.path !== "string") return fail(400, "path is required")
  const { db, libraries } = getPlatform()
  const files = await remoteLibrary(libraries.get(access.workspaceId)).list()
  const root = siteRoot(
    files.map((file) => file.path),
    input.path,
  )
  if ("error" in root) return fail(400, root.error)
  try {
    const site = await shareSite(db, access.workspaceId, {
      path: root.path,
      title:
        typeof input.title === "string" && input.title.trim() !== ""
          ? input.title
          : siteTitleFor(root.path),
      userId: user.id,
    })
    return json({ site }, 201)
  } catch (error) {
    if (error instanceof SiteError) return fail(409, error.message)
    throw error
  }
}

/** Someone changes a site's title, or who can open it. */
export async function updateSite(
  user: SessionUser,
  request: Request,
  agentId: string,
  siteId: string,
): Promise<Response> {
  const access = await agentFor(user, agentId)
  if (access === undefined) return fail(404, "Agent not found")
  const input = (await request.json().catch(() => ({}))) as { public?: unknown; title?: unknown }
  const site = await changeSite(getPlatform().db, access.workspaceId, siteId, {
    ...(typeof input.public === "boolean" ? { public: input.public } : {}),
    ...(typeof input.title === "string" ? { title: input.title } : {}),
  })
  return site === undefined ? fail(404, "Site not found") : json({ site })
}

/** Someone stops sharing a site. */
export async function removeSite(
  user: SessionUser,
  agentId: string,
  siteId: string,
): Promise<Response> {
  const access = await agentFor(user, agentId)
  if (access === undefined) return fail(404, "Agent not found")
  return (await stopSite(getPlatform().db, access.workspaceId, siteId))
    ? json({ ok: true })
    : fail(404, "Site not found")
}

/** How long an address for a site's files stays the same. It works for up to twice as long. */
const WINDOW_MS = 6 * 60 * 60 * 1000
/** What marks the part of an address that stands in for the permission to open a site. */
const KEY_MARK = "~"

const encoder = new TextEncoder()

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
}

/** Compares in the same time whatever the two hold, so the time taken says nothing of either. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

/**
 * What stands in for the permission to open a site, in the addresses its files are served at. A
 * site's page runs apart from the app and is sent nobody's session, so whether its reader may
 * open the site is decided once, for the page around it, and the files are then asked for with
 * this. It is the same for a few hours, so a page being read does not reload, and is signed
 * with a secret of the site's own, so it opens nothing else.
 */
export async function siteKey(row: Pick<SiteRow, "id" | "secret">, now = Date.now()) {
  const window = Math.floor(now / WINDOW_MS).toString(36)
  return `${window}-${await sign(row.secret, `site:${row.id}:${window}`)}`
}

async function opens(row: SiteRow, key: string, now = Date.now()): Promise<boolean> {
  const dash = key.indexOf("-")
  if (dash === -1) return false
  const window = key.slice(0, dash)
  const current = Math.floor(now / WINDOW_MS)
  if (window !== current.toString(36) && window !== (current - 1).toString(36)) return false
  return same(key.slice(dash + 1), await sign(row.secret, `site:${row.id}:${window}`))
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  )

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
}

/**
 * The page a site's address shows: nothing but a frame the size of the window, with the site
 * in it. The site runs in the frame, apart from the app, so that a page an agent wrote, which
 * anyone may have had a hand in, cannot act as whoever is reading it.
 */
function framePage(row: SiteRow, source: string): Response {
  const title = escapeHtml(row.title)
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>html,body{height:100%;margin:0}iframe{display:block;width:100%;height:100vh;height:100dvh;border:0}</style></head><body><iframe src="${escapeHtml(source)}" title="${title}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads" allow="fullscreen; clipboard-write"></iframe></body></html>`,
    {
      headers: {
        ...PAGE_HEADERS,
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'self'",
      },
    },
  )
}

/** A page of the app's own in place of a site: there is none, or its reader may not open it. */
function wordPage(
  status: number,
  words: { title: string; line: string; action?: { label: string; href: string } },
): Response {
  const action =
    words.action === undefined
      ? ""
      : `<a href="${escapeHtml(words.action.href)}">${escapeHtml(words.action.label)}</a>`
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(words.title)}</title><style>:root{color-scheme:light dark;--canvas:#f8fbfb;--ink:#282c2d;--accent:#2d7377}@media (prefers-color-scheme:dark){:root{--canvas:#121415;--ink:#dfe3e4;--accent:#3a8084}}html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--canvas);color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}main{max-width:26rem;padding:2rem;text-align:center}small{display:block;margin-bottom:1.25rem;font-size:.8125rem;letter-spacing:.02em;opacity:.55}h1{margin:0 0 .5rem;font-size:1.125rem;font-weight:600}p{margin:0;opacity:.7}a{display:inline-block;margin-top:1.5rem;padding:.5rem 1rem;border-radius:.5rem;background:var(--accent);color:#fff;font-weight:500;text-decoration:none}</style></head><body><main><small>Do Computer</small><h1>${escapeHtml(words.title)}</h1><p>${escapeHtml(words.line)}</p>${action}</main></body></html>`,
    {
      status,
      headers: {
        ...PAGE_HEADERS,
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    },
  )
}

const gone = () =>
  wordPage(404, {
    title: "There is no page here.",
    line: "The link may be mistyped, or the page may no longer be shared.",
  })

/** The name of the workspace a site is shared with, where it has one: a team's. */
async function sharedWith(workspaceId: string): Promise<string | undefined> {
  if (isPersonalWorkspace(workspaceId)) return undefined
  const row = await getPlatform().db.get<{ name: string }>(
    "SELECT name FROM dc_workspaces WHERE id = ?",
    workspaceId,
  )
  return row?.name
}

/**
 * `GET /s/:site/...`: a site, to whoever may open it.
 *
 * The address itself, with or without a page's path after it, answers with a frame, once its
 * reader is known to be allowed: anyone for a public site, and otherwise someone signed in who
 * is in the site's workspace. What the frame loads, and everything those pages load, are the
 * addresses that carry a key after the site's id, and are answered by the workspace's library
 * from the page or folder the site shares.
 */
export async function serveSite(request: Request, siteId: string): Promise<Response> {
  const { db, libraries } = getPlatform()
  const row = await siteById(db, siteId)
  if (row === undefined) return gone()
  const url = new URL(request.url)
  const base = sitePath(siteId)
  const rest = url.pathname.slice(base.length)
  if (rest.startsWith(`/${KEY_MARK}`)) {
    const missing = () => new Response("Not found", { status: 404 })
    const slash = rest.indexOf("/", 1)
    const key = decodeURIComponent(slash === -1 ? rest.slice(2) : rest.slice(2, slash))
    if (!(await opens(row, key))) return missing()
    // The front page's links are relative to the site, so its address has to end in a slash.
    if (slash === -1) {
      return new Response(null, {
        status: 302,
        headers: { location: `${url.pathname}/${url.search}` },
      })
    }
    const headers: Record<string, string> = { [LIBRARY_SITE_HEADER]: encodeURIComponent(row.path) }
    const cached = request.headers.get("if-none-match")
    if (cached !== null) headers["if-none-match"] = cached
    const response = await libraries
      .get(row.workspace_id)
      .fetch(
        new Request(`http://library/site${rest.slice(slash)}`, { headers, signal: request.signal }),
      )
    // The library answers in JSON, for the app. This is read by a browser.
    return response.status === 404 ? missing() : response
  }
  if (row.public !== 1) {
    const user = await getUser(request)
    if (user === undefined) {
      return wordPage(401, {
        title: "This page is shared with one workspace only.",
        line: "Sign in with an account that is in it to open the page.",
        action: {
          label: "Sign in",
          href: `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
        },
      })
    }
    if ((await roleIn(db, user.id, row.workspace_id)) === undefined) {
      const name = await sharedWith(row.workspace_id)
      return wordPage(403, {
        title: "This page is shared with one workspace only.",
        line: `You are signed in as ${user.email}, which is not in ${name === undefined ? "it" : `the ${name} workspace`}. Ask whoever sent you the link to make the page public, or to invite you.`,
      })
    }
  }
  return framePage(
    row,
    `${base}/${KEY_MARK}${await siteKey(row)}${rest === "" ? "/" : rest}${url.search}`,
  )
}
