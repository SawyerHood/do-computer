import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type ApprovalsState,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  isSiteShare,
  isVisual,
  type LibraryFile,
  type LibraryListing,
  readSse,
  reduceChat,
  sharedSite,
  type SiteSummary,
  type ToolPart,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
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

/** Agents of one workspace, which keeps a library for them and has no machine at all. */
function open(): World {
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

  it("says why, for something that cannot be a site", async () => {
    const world = open()
    const chat = await setup(world)
    await put(world, "notes/todo.md", "- one")
    await put(world, "drafts/a.html", "<p>a</p>")
    for (const [path, reason] of [
      ["notes/todo.md", "is not a page"],
      ["drafts", "has no index.html"],
      ["nowhere", "There is no nowhere in the library"],
    ] as const) {
      const part = await use(world, chat.id, "share", { action: "publish", path })
      expect(part.status).toBe("error")
      expect(part.output).toContain(reason)
    }
    expect(world.sites).toEqual([])
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
        title: "Make a shared page public",
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

    const style = await served(world, "sites/plan", "style.css")
    expect(style.headers.get("content-type")).toBe("text/css; charset=utf-8")
    expect(await style.text()).toBe("h1{color:teal}")
    // A folder within it is its own front page, at an address that ends in a slash.
    const folder = await served(world, "sites/plan", "more")
    expect(folder.status).toBe(302)
    expect(folder.headers.get("location")).toBe("more/")
    expect(await (await served(world, "sites/plan", "more/")).text()).toBe("<p>more</p>")

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
    expect(await (await served(world, "visuals/signups.html", "")).text()).toBe(PAGE)
    // What is beside it is not part of the site.
    expect((await served(world, "visuals/signups.html", "churn.html")).status).toBe(404)
    expect((await served(world, "visuals/signups.html", "../visuals/churn.html")).status).toBe(404)
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
