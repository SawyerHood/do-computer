import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type ApprovalsState,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  isShownPart,
  isSiteShare,
  isVisual,
  type LibraryFile,
  type LibraryListing,
  PAGE_THEME_VERSION,
  readSse,
  readVisualHeights,
  SITE_LISTING_HEADER,
  type SiteListing,
  reduceChat,
  sharedSite,
  type SiteSummary,
  THEME_TOKEN_NAMES,
  type ToolPart,
} from "@do-computer/protocol"
import { type PagePreviewer, PreviewError, type PreviewRequest } from "@do-computer/runtime"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import {
  createAgentActor,
  createLibraryActor,
  LIBRARY_SITE_HEADER,
  type SiteDirectory,
} from "../src/index.ts"

const STYLE = '<style id="dc-visual-theme">'
const count = (text: string, part: string) => text.split(part).length - 1

type World = {
  agents: NodeActorNamespace
  libraries: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  sites: SiteSummary[]
  reports: unknown[]
}
const worlds: World[] = []

/** The sites of the one workspace there is, kept as a host would keep them. */
function directory(sites: SiteSummary[]): SiteDirectory {
  let made = 0
  return {
    list: async () => [...sites],
    async publish(agentId, input) {
      const existing = sites.find((site) => site.path === input.path)
      if (existing !== undefined) return existing
      const site: SiteSummary = {
        id: `site${++made}`,
        path: input.path,
        title: input.title,
        public: false,
        agentId,
        userId: null,
        createdAt: made,
        updatedAt: made,
      }
      sites.unshift(site)
      return site
    },
    async setPublic(_agentId, siteId, open) {
      const site = sites.find((entry) => entry.id === siteId)
      if (site !== undefined) site.public = open
      return site
    },
    async remove(_agentId, siteId) {
      const index = sites.findIndex((entry) => entry.id === siteId)
      if (index !== -1) sites.splice(index, 1)
      return index !== -1
    },
  }
}

/**
 * Agents of one workspace, which keeps a library for them and has no machine at all. With
 * `previewer`, the server has a browser for them to look at a page with.
 */
function open(previewer?: PagePreviewer): World {
  const root = mkdtempSync(join(tmpdir(), "dc-sharing-"))
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
  const sites: SiteSummary[] = []
  const libraries = new NodeActorNamespace({
    directory: join(root, "libraries"),
    blobs: (name) => fileBlobs(join(root, "library-blobs", encodeURIComponent(name))),
    factory: (host) => createLibraryActor(host),
    onError: (error) => reports.push(error),
  })
  const agents = new NodeActorNamespace({
    directory: join(root, "agents"),
    blobs: (name) => fileBlobs(join(root, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        computers: { kinds: [], default: "", create: () => undefined },
        library: async () => libraries.get("workspace-1"),
        sites: directory(sites),
        appUrl: "https://app.example",
        ...(previewer === undefined ? {} : { pagePreviewer: previewer }),
        onReport: (error) => reports.push(error),
      }),
    onError: (error) => reports.push(error),
  })
  agents.start()
  const world = { agents, libraries, faux, sites, reports }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) {
    await world.agents.close().catch(() => {})
    await world.libraries.close().catch(() => {})
  }
})

const request = (world: World, path: string, init?: RequestInit) =>
  world.agents.get("agent-1").fetch(new Request(`http://actor${path}`, init))

async function call<T>(world: World, path: string, method = "GET", payload?: unknown): Promise<T> {
  const text = typeof payload === "string"
  const response = await request(world, path, {
    method,
    body: payload === undefined ? undefined : text ? payload : JSON.stringify(payload),
    headers:
      payload === undefined
        ? undefined
        : { "content-type": text ? "text/plain" : "application/json" },
  })
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error ?? ""}`)
  return result
}

async function converse(world: World, chatId: string, text: string): Promise<ChatState> {
  const response = await request(world, `/chats/${chatId}/events`)
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  let state = EMPTY_CHAT
  let started = false
  for await (const event of readSse<ChatEvent>(response.body!)) {
    state = reduceChat(state, event)
    started ||= state.busy
    if (started && !state.busy) break
  }
  return state
}

/** Have the agent call one tool, and return the call as the chat then shows it. */
async function use(
  world: World,
  chatId: string,
  name: string,
  args: Record<string, string>,
): Promise<ToolPart> {
  world.faux.setResponses([
    fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ])
  const state = await converse(world, chatId, `${name} ${JSON.stringify(args).slice(0, 40)}`)
  return state.messages
    .flatMap((message) => message.parts)
    .findLast((part): part is ToolPart => part.type === "tool")!
}

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  await call(world, "/", "PATCH", { name: "Scout" })
  return call<ChatSummary>(world, "/chats", "POST", {})
}

const put = (world: World, path: string, content: string) =>
  call<LibraryFile>(world, `/library?path=${encodeURIComponent(path)}`, "POST", content)

/** Ask the workspace's library for a site's file, as the gateway does once it has let someone in. */
const served = (world: World, root: string | undefined, rest: string) =>
  world.libraries.get("workspace-1").fetch(
    new Request(`http://library/site/${rest}`, {
      headers: root === undefined ? {} : { [LIBRARY_SITE_HEADER]: encodeURIComponent(root) },
    }),
  )

const PAGE =
  "<!doctype html><html><head><title>Signups</title></head><body><svg></svg></body></html>"

describe("a visual", () => {
  it("is kept in the library as a page in the app's colors, and is what the chat shows", async () => {
    const world = open()
    const chat = await setup(world)
    const part = await use(world, chat.id, "visual", { title: "Signups by week, Q3", html: PAGE })
    expect(part.status).toBe("done")
    expect(isVisual(part)).toBe(true)
    const file = part.details as unknown as LibraryFile
    expect(file).toMatchObject({
      path: "visuals/signups-by-week-q3.html",
      source: "agent",
      agentId: "agent-1",
      chatId: chat.id,
      contentType: "text/html",
    })
    // The agent is told the person has it, and not to say it again.
    expect(part.output).toContain("Shown to the person in the chat")
    const kept = await (await request(world, `/library/${file.id}`)).text()
    expect(kept).toContain('<style id="dc-visual-theme">')
    expect(kept).toContain("<body><svg></svg></body>")
    // It needed no machine: this workspace has none.
    expect(world.reports).toEqual([])
  })

  it("is a page of its own each time, whatever it is called", async () => {
    const world = open()
    const chat = await setup(world)
    await use(world, chat.id, "visual", { title: "Signups", html: PAGE })
    await use(world, chat.id, "visual", { title: "Signups", html: PAGE.replace("svg", "table") })
    const { files } = await call<LibraryListing>(world, "/library")
    expect(files.map((file) => file.path).sort()).toEqual([
      "visuals/signups-2.html",
      "visuals/signups.html",
    ])
  })

  it("is refused with the reason when there is no page", async () => {
    const world = open()
    const chat = await setup(world)
    const empty = await use(world, chat.id, "visual", { title: "Nothing", html: "  " })
    expect(empty.status).toBe("error")
    expect(empty.output).toContain("needs a page")
    expect((await call<LibraryListing>(world, "/library")).files).toEqual([])
  })
})

describe("looking at a page before it is shown", () => {
  /** A browser that draws nothing, and notes what it was asked to. */
  function browser(answer?: Error) {
    const asked: PreviewRequest[] = []
    const previewer: PagePreviewer = {
      async preview(request) {
        asked.push(request)
        if (answer !== undefined) throw answer
        return {
          png: "aGVsbG8=",
          width: request.width,
          pictured: 120,
          heights: request.widths.map((width) => [width, width < 500 ? 300 : 120] as const),
          console: [
            { level: "log", text: "drew 3 cards" },
            { level: "error", text: "notThere is not defined" },
          ],
        }
      },
    }
    return { asked, previewer }
  }
  const LOUD = PAGE.replace("<body>", "<body><style>p{color:#ff0000}</style>")

  it("gives the agent how tall the page is, what it wrote and what failed, and keeps nothing", async () => {
    const { asked, previewer } = browser()
    const world = open(previewer)
    const chat = await setup(world)
    const part = await use(world, chat.id, "visual_preview", { html: LOUD })
    expect(part.status).toBe("done")
    expect(part.output).toContain("At 680px wide the page is 120px tall.")
    expect(part.output).toContain(
      "120px tall on a computer (680px wide) and 300px on a phone (360px wide)",
    )
    expect(part.output).toContain("[log] drew 3 cards\n[error] notThere is not defined")
    // What will look out of place is to be fixed now, while nobody has seen it.
    expect(part.output).toContain("To fix before you draw it:\n- Colors are written out (#ff0000)")
    // The browser was given the page as a chat shows it, to measure where a reply is read.
    expect(asked).toHaveLength(1)
    expect(asked[0]!.width).toBe(680)
    expect(asked[0]!.widths).toEqual([320, 360, 440, 560, 680, 760])
    expect(asked[0]!.html).toContain(
      'sandbox="allow-scripts allow-popups allow-forms allow-modals"',
    )
    expect(asked[0]!.html).toContain("data-dc-inline")
    // The app's address is named, for the typefaces a page is given to load from.
    expect(asked[0]!.html).toContain("https://app.example/")
    // Nothing is shown to the person, and nothing is kept.
    expect(isVisual(part)).toBe(false)
    expect(isShownPart(part)).toBe(false)
    expect((await call<LibraryListing>(world, "/library")).files).toEqual([])
    expect(world.reports).toEqual([])
  })

  it("gives a page drawn as it was looked at the room it was measured to take", async () => {
    const world = open(browser().previewer)
    const chat = await setup(world)
    await use(world, chat.id, "visual_preview", { html: PAGE })
    const drawn = await use(world, chat.id, "visual", { title: "Signups", html: PAGE })
    expect(isVisual(drawn)).toBe(true)
    expect(readVisualHeights((drawn.details as { heights?: unknown }).heights)).toEqual([
      [320, 300],
      [360, 300],
      [440, 300],
      [560, 120],
      [680, 120],
      [760, 120],
    ])
    // One that was changed after it was looked at was not measured as it is.
    const changed = await use(world, chat.id, "visual", {
      title: "Signups again",
      html: PAGE.replace("svg", "table"),
    })
    expect((changed.details as { heights?: unknown }).heights).toBeUndefined()
  })

  it("does not ask the browser for a page that would not work in the chat", async () => {
    const { asked, previewer } = browser()
    const world = open(previewer)
    const chat = await setup(world)
    const part = await use(world, chat.id, "visual_preview", {
      html: "<p>x</p><script>localStorage.setItem('a', '1')</script>",
    })
    expect(part.status).toBe("error")
    expect(part.output).toContain("has no storage")
    expect(asked).toEqual([])
  })

  it("tells the agent to draw without looking when the browser cannot be had", async () => {
    const world = open(browser(new PreviewError("No browser could be had just now.")).previewer)
    const chat = await setup(world)
    const part = await use(world, chat.id, "visual_preview", { html: PAGE })
    expect(part.status).toBe("error")
    expect(part.output).toBe(
      "The page could not be looked at: No browser could be had just now. Draw it without looking.",
    )
    expect(world.reports).toEqual([])
  })

  it("is not offered where the server has no browser", async () => {
    const world = open()
    const chat = await setup(world)
    const part = await use(world, chat.id, "visual_preview", { html: PAGE })
    expect(part.status).toBe("error")
    expect(part.output).not.toContain("At 680px wide")
  })
})

describe("sharing a site", () => {
  it("gives a folder of the library an address the workspace can open", async () => {
    const world = open()
    const chat = await setup(world)
    await put(world, "sites/plan/index.html", "<h1>Plan</h1>")
    await put(world, "sites/plan/style.css", "h1{color:teal}")
    const part = await use(world, chat.id, "share", {
      action: "publish",
      path: "~/library/sites/plan/index.html",
      title: "Launch plan",
    })
    expect(part.status).toBe("done")
    expect(isSiteShare(part)).toBe(true)
    expect(sharedSite(part)).toMatchObject({
      path: "sites/plan",
      title: "Launch plan",
      public: false,
      agentId: "agent-1",
    })
    expect(part.output).toContain("https://app.example/s/site1")
    expect(part.output).toContain("people in this workspace, signed in")
    // The same place again is the same site.
    const again = await use(world, chat.id, "share", { action: "publish", path: "sites/plan" })
    expect(sharedSite(again).id).toBe("site1")
    expect(world.sites.length).toBe(1)
    const listed = await use(world, chat.id, "share", { action: "list" })
    expect(listed.output).toContain("Launch plan: https://app.example/s/site1 (sites/plan")
  })

  it("names a site after its place where it is given no title", async () => {
    const world = open()
    const chat = await setup(world)
    await put(world, "visuals/signups-q3.html", PAGE)
    const part = await use(world, chat.id, "share", {
      action: "publish",
      path: "visuals/signups-q3.html",
    })
    expect(sharedSite(part)).toMatchObject({ path: "visuals/signups-q3.html", title: "Signups q3" })
  })

  it("shares any file, and a folder with no front page of its own", async () => {
    const world = open()
    const chat = await setup(world)
    await put(world, "notes/todo.md", "- one")
    await put(world, "drafts/a.html", "<p>a</p>")
    const file = await use(world, chat.id, "share", { action: "publish", path: "notes/todo.md" })
    expect(sharedSite(file)).toMatchObject({ path: "notes/todo.md", title: "Todo" })
    const folder = await use(world, chat.id, "share", { action: "publish", path: "drafts" })
    expect(sharedSite(folder)).toMatchObject({ path: "drafts", title: "Drafts" })
    const missing = await use(world, chat.id, "share", { action: "publish", path: "nowhere" })
    expect(missing.status).toBe("error")
    expect(missing.output).toContain("There is no nowhere in the library")
    expect(world.sites.length).toBe(2)
  })

  it("asks a person before making a site public, and does it once they say yes", async () => {
    const world = open()
    const chat = await setup(world)
    await put(world, "sites/plan/index.html", "<h1>Plan</h1>")
    await use(world, chat.id, "share", { action: "publish", path: "sites/plan", title: "Plan" })
    const refused = await use(world, chat.id, "share", { action: "public", site: "Plan" })
    expect(refused.status).toBe("error")
    expect(world.sites[0]!.public).toBe(false)
    const { pending, subjects } = await call<ApprovalsState>(world, "/approvals")
    expect(pending).toMatchObject([
      {
        title: "Make something shared public",
        detail: "Plan\nAnyone who has the link could open it.",
      },
    ])
    // It is among what a rule can be set for, and so is sharing with the workspace.
    expect(subjects.map((subject) => subject.id)).toEqual(
      expect.arrayContaining(["tool:share", "tool:share_public", "tool:visual"]),
    )
    await call(world, `/approvals/${pending[0]!.id}`, "POST", { decision: "once" })
    const allowed = await use(world, chat.id, "share", { action: "public", site: "Plan" })
    expect(allowed.status).toBe("done")
    expect(sharedSite(allowed).public).toBe(true)
    expect(allowed.output).toContain("anyone who has the link")
    // Closing it again is nothing to ask about, by its address this time.
    const closed = await use(world, chat.id, "share", {
      action: "private",
      site: "https://app.example/s/site1",
    })
    expect(sharedSite(closed).public).toBe(false)
  })

  it("stops sharing a site, and leaves its files", async () => {
    const world = open()
    const chat = await setup(world)
    await put(world, "sites/plan/index.html", "<h1>Plan</h1>")
    await use(world, chat.id, "share", { action: "publish", path: "sites/plan" })
    const stopped = await use(world, chat.id, "share", { action: "stop", site: "sites/plan" })
    expect(stopped.status).toBe("done")
    expect(isSiteShare(stopped)).toBe(false)
    expect(world.sites).toEqual([])
    expect((await call<LibraryListing>(world, "/library")).files.length).toBe(1)
    const unknown = await use(world, chat.id, "share", { action: "stop", site: "sites/plan" })
    expect(unknown.status).toBe("error")
  })
})

describe("a site's files", () => {
  it("are served from the folder it shares, and from nowhere else", async () => {
    const world = open()
    await setup(world)
    await put(
      world,
      "sites/plan/index.html",
      '<link rel="stylesheet" href="style.css"><h1>Plan</h1>',
    )
    await put(world, "sites/plan/style.css", "h1{color:teal}")
    await put(world, "sites/plan/more/index.html", "<p>more</p>")
    await put(world, "sites/other/index.html", "<p>other</p>")
    await put(world, "secret.html", "<p>secret</p>")

    const front = await served(world, "sites/plan", "")
    expect(front.status).toBe(200)
    expect(await front.text()).toContain("<h1>Plan</h1>")
    expect(front.headers.get("content-type")).toBe("text/html; charset=utf-8")
    // It runs apart from the app, and a link it opens in a new tab is an ordinary page.
    const policy = front.headers.get("content-security-policy") ?? ""
    expect(policy).toMatch(/^sandbox /)
    expect(policy).toContain("allow-scripts")
    expect(policy).toContain("allow-popups-to-escape-sandbox")
    expect(policy).not.toContain("allow-same-origin")
    expect(policy).not.toContain("allow-top-navigation")
    expect(front.headers.get("referrer-policy")).toBe("no-referrer")
    // A page of the site may read the site's files, which a page's own origin would not let it.
    expect(front.headers.get("access-control-allow-origin")).toBe("*")

    const style = await served(world, "sites/plan", "style.css")
    expect(style.headers.get("content-type")).toBe("text/css; charset=utf-8")
    expect(await style.text()).toBe("h1{color:teal}")
    // A folder within it is its own front page, at an address that ends in a slash.
    const folder = await served(world, "sites/plan", "more")
    expect(folder.status).toBe(302)
    expect(folder.headers.get("location")).toBe("more/")
    expect(await (await served(world, "sites/plan", "more/")).text()).toMatch(/<p>more<\/p>$/)

    for (const outside of ["../other/index.html", "..%2Fother%2Findex.html", "../../secret.html"]) {
      expect((await served(world, "sites/plan", outside)).status).toBe(404)
    }
    expect((await served(world, "sites/plan", "missing.html")).status).toBe(404)
    // Without the gateway saying which site, there is nothing to serve.
    expect((await served(world, undefined, "")).status).toBe(404)
    expect((await served(world, "sites/gone", "")).status).toBe(404)
  })

  it("are one page, for a site that shares a page", async () => {
    const world = open()
    await setup(world)
    await put(world, "visuals/signups.html", PAGE)
    await put(world, "visuals/churn.html", "<p>churn</p>")
    expect(await (await served(world, "visuals/signups.html", "")).text()).toContain(
      "<title>Signups</title></head><body><svg></svg></body></html>",
    )
    // What is beside it is not part of the site.
    expect((await served(world, "visuals/signups.html", "churn.html")).status).toBe(404)
    expect((await served(world, "visuals/signups.html", "../visuals/churn.html")).status).toBe(404)
  })

  it("are listed, for a folder with no front page of its own", async () => {
    const world = open()
    await setup(world)
    await put(world, "drafts/b.md", "# B")
    await put(world, "drafts/a.html", "<p>a</p>")
    await put(world, "drafts/pics/one.svg", "<svg/>")
    await put(world, "drafts/pics/deep/two.svg", "<svg/>")
    await put(world, "draftsman.md", "not in it")
    const list = await served(world, "drafts", "")
    expect(list.status).toBe(200)
    expect(list.headers.get(SITE_LISTING_HEADER)).toBe("1")
    expect(list.headers.get("content-security-policy")).toMatch(/^sandbox /)
    // Folders first, then files, by name: only what is directly inside.
    expect((await list.json()) as SiteListing).toMatchObject({
      folder: "",
      entries: [
        { name: "pics", kind: "folder" },
        { name: "a.html", kind: "file", size: 8 },
        { name: "b.md", kind: "file", size: 3 },
      ],
    })
    // A folder within it is a list too, at an address that ends in a slash.
    const inner = await served(world, "drafts", "pics")
    expect(inner.status).toBe(302)
    expect(inner.headers.get("location")).toBe("pics/")
    expect((await (await served(world, "drafts", "pics/")).json()) as SiteListing).toMatchObject({
      folder: "pics",
      entries: [
        { name: "deep", kind: "folder" },
        { name: "one.svg", kind: "file" },
      ],
    })
    // Its files are served as what they are, and a file that is not a page is not marked a list.
    const document = await served(world, "drafts", "b.md")
    expect(await document.text()).toBe("# B")
    expect(document.headers.get("content-type")).toBe("text/markdown; charset=utf-8")
    expect(document.headers.get(SITE_LISTING_HEADER)).toBeNull()
    expect((await served(world, "drafts", "nothing/")).status).toBe(404)
  })

  it("are a document's pictures too, where the document is what is shared", async () => {
    const world = open()
    await setup(world)
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>'
    await put(
      world,
      "notes/plan.md",
      "# Plan\n\n![chart](chart.svg) ![logo](../brand/logo.svg) [numbers](data.csv) [page](page.html)",
    )
    await put(world, "notes/chart.svg", SVG)
    await put(world, "notes/unused.svg", SVG)
    await put(world, "notes/data.csv", "week,signups")
    await put(world, "notes/page.html", "<p>page</p>")
    await put(world, "brand/logo.svg", SVG)
    await put(world, "brand/list.md", "![chart](../notes/unused.svg)")
    const picture = (root: string, path: string) =>
      served(world, root, `?picture=${encodeURIComponent(path)}`)

    const chart = await picture("notes/plan.md", "notes/chart.svg")
    expect(chart.status).toBe(200)
    expect(chart.headers.get("content-type")).toBe("image/svg+xml")
    expect(chart.headers.get("content-security-policy")).toMatch(/^sandbox /)
    expect(await chart.text()).toBe(SVG)
    // One in another folder, which the document reaches by its own path.
    expect((await picture("notes/plan.md", "brand/logo.svg")).status).toBe(200)
    // Not a picture it does not refer to, though it is beside it.
    expect((await picture("notes/plan.md", "notes/unused.svg")).status).toBe(404)
    // Not what it links to that is no picture, whatever it is.
    expect((await picture("notes/plan.md", "notes/data.csv")).status).toBe(404)
    expect((await picture("notes/plan.md", "notes/page.html")).status).toBe(404)
    expect((await picture("notes/plan.md", "notes/plan.md")).status).toBe(404)
    expect((await picture("notes/plan.md", "nowhere.svg")).status).toBe(404)
    // The document itself is still what its address answers with.
    expect(await (await served(world, "notes/plan.md", "")).text()).toContain("# Plan")
    // What is shared that is not a document brings nothing with it.
    expect((await picture("notes/chart.svg", "notes/unused.svg")).status).toBe(404)
    expect((await picture("notes/page.html", "notes/chart.svg")).status).toBe(404)
    // And in a shared folder a picture is asked for by its own address, as any file is.
    const folder = await picture("notes", "brand/logo.svg")
    expect(folder.headers.get(SITE_LISTING_HEADER)).toBe("1")
  })

  it("are one file of any kind, for a site that shares a file", async () => {
    const world = open()
    await setup(world)
    await put(world, "notes/todo.md", "- one")
    await put(world, "notes/other.md", "- two")
    expect(await (await served(world, "notes/todo.md", "")).text()).toBe("- one")
    expect((await served(world, "notes/todo.md", "other.md")).status).toBe(404)
  })

  it("are not sent again to a browser that has them", async () => {
    const world = open()
    await setup(world)
    await put(world, "sites/plan/index.html", "<h1>Plan</h1>")
    const first = await served(world, "sites/plan", "")
    const etag = first.headers.get("etag")!
    const again = await world.libraries.get("workspace-1").fetch(
      new Request("http://library/site/", {
        headers: { [LIBRARY_SITE_HEADER]: "sites%2Fplan", "if-none-match": etag },
      }),
    )
    expect(again.status).toBe(304)
  })
})

/** What the model is sent at its next request: its instructions and its tools. */
async function told(world: World, chatId: string): Promise<string> {
  let sent = ""
  world.faux.setResponses([
    (context) => {
      sent = JSON.stringify(context)
      return fauxAssistantMessage("ok")
    },
  ])
  await converse(world, chatId, "hi")
  return sent
}

/** A page as an agent writes one to the library, asking for the app's own page. */
const DOCUMENT =
  '<!doctype html><html lang="en" data-dc-page><head><title>Q3</title>' +
  "<style>.card{background:var(--card);border:1px solid var(--border)}</style></head>" +
  "<body><div class=card>Revenue</div></body></html>"

describe("a page of the library", () => {
  /** A file as the app's viewer asks for it: by the address that stands in for a session. */
  const viewed = async (world: World, path: string, headers?: Record<string, string>) =>
    request(world, `/view/${(await call<LibraryListing>(world, "/library")).view}/${path}`, {
      headers,
    })

  it("is served in the app's look, though it is kept as it was written", async () => {
    const world = open()
    await setup(world)
    const file = await put(world, "reports/q3.html", DOCUMENT)
    // What is kept is what was written: the look is put in when the page is served.
    expect(await (await request(world, `/library/${file.id}`)).text()).toBe(DOCUMENT)
    const response = await viewed(world, "reports/q3.html")
    const page = await response.text()
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(Number(response.headers.get("content-length"))).toBe(
      new TextEncoder().encode(page).length,
    )
    expect(count(page, STYLE)).toBe(1)
    expect(page.indexOf(STYLE)).toBeLessThan(page.indexOf(".card{"))
    // Every variable is there, in light and in dark, and what the agent wrote is all still there.
    for (const name of THEME_TOKEN_NAMES) expect(page).toContain(`${name}:`)
    expect(page).toContain(':where(:root[data-dc-theme="dark"])')
    expect(page).toContain('<html lang="en" data-dc-page>')
    expect(page).toContain("<body><div class=card>Revenue</div></body></html>")
    // Whoever is sent its link is served the same.
    expect(count(await (await served(world, "reports/q3.html", "")).text(), STYLE)).toBe(1)
  })

  it("takes the look with it when it is downloaded, and only when that is asked", async () => {
    const world = open()
    await setup(world)
    const file = await put(world, "reports/q3.html", DOCUMENT)
    const taken = await request(world, `/library/${file.id}?look`)
    const page = await taken.text()
    expect(count(page, STYLE)).toBe(1)
    expect(page).toContain("@media (prefers-color-scheme:dark)")
    expect(page.replace(/<style id="dc-visual-theme">.*?<\/script>/s, "")).toBe(DOCUMENT)
    // It is handed over as a file, never run where the app is.
    expect(taken.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(taken.headers.get("content-type")).toBe("application/octet-stream")
    expect(taken.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'")
    // Anything else is what was kept, whatever is asked.
    const note = await put(world, "notes/plan.md", "# Plan <head></head>")
    expect(await (await request(world, `/library/${note.id}?look`)).text()).toBe(
      "# Plan <head></head>",
    )
  })

  it("is still apart from the app, and is sent nothing of whoever opens it", async () => {
    const world = open()
    await setup(world)
    await put(world, "reports/q3.html", DOCUMENT)
    const response = await viewed(world, "reports/q3.html", { cookie: "session=secret" })
    const policy = response.headers.get("content-security-policy") ?? ""
    expect(policy).toMatch(/^sandbox /)
    expect(policy).not.toContain("allow-same-origin")
    expect(policy).not.toContain("allow-top-navigation")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    // A viewed page may not read the files beside it: its address opens the whole library.
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(response.headers.get("set-cookie")).toBeNull()
    const page = await response.text()
    // What is put in is the same for everyone: nothing of the session, the agent or the address.
    expect(page).not.toContain("secret")
    expect(page).not.toContain("agent-1")
    expect(page).not.toContain((await call<LibraryListing>(world, "/library")).view)
    expect(page).toBe(await (await viewed(world, "reports/q3.html")).text())
  })

  it("is given the look whether or not it asked, and nothing but a page is", async () => {
    const world = open()
    await setup(world)
    await put(world, "plain.html", "<h1>Plain</h1>")
    await put(world, "data.json", '{"html":"<head></head>"}')
    await put(world, "style.css", ":root{--background:red}")
    const plain = await (await viewed(world, "plain.html")).text()
    expect(count(plain, STYLE)).toBe(1)
    expect(plain.endsWith("</head><h1>Plain</h1>")).toBe(true)
    // It did not ask for the app's page, so it is not marked as one that did.
    expect(plain).not.toContain("<html")
    expect(await (await viewed(world, "data.json")).text()).toBe('{"html":"<head></head>"}')
    expect(await (await viewed(world, "style.css")).text()).toBe(":root{--background:red}")
  })

  it("is asked for again when the look changes, and not while it is the same", async () => {
    const world = open()
    await setup(world)
    const file = await put(world, "reports/q3.html", DOCUMENT)
    const first = await viewed(world, "reports/q3.html")
    expect(first.headers.get("etag")).toBe(`"${file.id}.${file.rev}.${PAGE_THEME_VERSION}"`)
    const again = await viewed(world, "reports/q3.html", {
      "if-none-match": first.headers.get("etag")!,
    })
    expect(again.status).toBe(304)
    // A browser that kept the page from before the look was what it is now is sent it anew.
    const stale = await viewed(world, "reports/q3.html", {
      "if-none-match": `"${file.id}.${file.rev}.older"`,
    })
    expect(stale.status).toBe(200)
  })

  it("has the look as it is now, for a visual kept with it", async () => {
    const world = open()
    const chat = await setup(world)
    const part = await use(world, chat.id, "visual", { title: "Signups", html: PAGE })
    const file = part.details as unknown as LibraryFile
    const kept = await (await request(world, `/library/${file.id}`)).text()
    // The file is whole by itself, and says it is a visual.
    expect(kept).toContain('<html data-dc-page="visual">')
    expect(count(kept, STYLE)).toBe(1)
    const page = await (await viewed(world, "visuals/signups.html")).text()
    expect(page).toBe(kept)
  })
})

describe("what an agent is told about pages", () => {
  it("is how a page should look, with the variables it is given, for a visual and a document", async () => {
    const world = open()
    const chat = await setup(world)
    const sent = await told(world, chat.id)
    // Once, for every kind of page.
    expect(count(sent, "The app gives every page it shows its own design tokens")).toBe(1)
    for (const name of [
      "--background",
      "--muted-foreground",
      "--primary-foreground",
      "--chart-6",
    ]) {
      expect(sent).toContain(name)
    }
    expect(sent).toContain("Width: the page is read at 320px and at 1200px")
    expect(sent).toContain("load nothing from a CDN")
    // A document asks for the app's own page; a visual is part of the reply.
    expect(sent).toContain("data-dc-page")
    expect(sent).toContain("put no card, frame or heading banner around the whole page")
  })
})
