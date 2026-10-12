import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ChatState,
  ChatSummary,
  LibraryFile,
  LibraryListing,
  LibraryVersion,
  ToolPart,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { justBashSandbox } from "@do-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterAll, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"
import { cleanLibraryPath, isLibraryPath } from "../src/library.ts"
import { createLocalProcessSandbox } from "@do-computer/sandbox/testing"
import { type Base, type Listed, listFolder, plan, type Stored } from "../src/library-sync.ts"

const directory = mkdtempSync(join(tmpdir(), "dc-library-sync-"))
const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
const models = createModels()
models.setProvider(faux.provider)
/** Failures that did not fail a request. None are expected. */
const reports: unknown[] = []
const agents = new NodeActorNamespace({
  directory: join(directory, "agents"),
  blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
  factory: (host) =>
    createAgentActor(host, {
      models,
      defaultModel: "test/model",
      modelOptions: [
        { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
      ],
      keepAliveMs: 100,
      onReport: (error) => reports.push(error),
      sandbox: (host) => justBashSandbox({ id: host.name, database: host.sql }),
    }),
})
afterAll(async () => {
  await agents.close()
  expect(reports).toEqual([])
})

const request = (path: string, init?: RequestInit) =>
  agents.get("agent-1").fetch(new Request(`http://actor${path}`, init))

async function call<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await request(path, {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
  })
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

let chat: ChatSummary

/** Have the agent run these tool calls one after another, and return the chat afterwards. */
async function agentDoes(
  ...calls: [tool: string, args: Parameters<typeof fauxToolCall>[1]][]
): Promise<ChatState> {
  faux.setResponses([
    ...calls.map(([tool, args]) =>
      fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }),
    ),
    fauxAssistantMessage("Done."),
  ])
  const before = (await call<ChatState>(`/chats/${chat.id}`)).messages.length
  await call(`/chats/${chat.id}/messages`, "POST", { text: "go", requestId: crypto.randomUUID() })
  const deadline = Date.now() + 8_000
  for (;;) {
    const state = await call<ChatState>(`/chats/${chat.id}`)
    if (!state.busy && state.messages.length > before + 1) return state
    if (Date.now() > deadline) throw new Error("run did not finish")
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}
const bash = (command: string) => agentDoes(["bash", { command }])
const lastTool = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).findLast((part): part is ToolPart => part.type === "tool")!
const listing = () => call<LibraryListing>("/library")
const fileAt = async (path: string) => (await listing()).files.find((file) => file.path === path)
const text = async (file: LibraryFile) => (await request(`/library/${file.id}`)).text()
const view = async (path: string, headers?: Record<string, string>) =>
  request(`/view/${(await listing()).view}/${path}`, { headers })

describe("paths", () => {
  it("accepts folders and plain names, and nothing hidden or inherited", () => {
    expect(isLibraryPath("reports/2026/q3.md")).toBe(true)
    expect(isLibraryPath("a file with spaces.html")).toBe(true)
    for (const bad of ["", "/a", "a//b", "a/", ".env", "a/.git/config", "a/../b", "constructor"]) {
      expect(isLibraryPath(bad), bad).toBe(false)
    }
  })

  it("makes what somebody typed into a path, or refuses it", () => {
    expect(cleanLibraryPath(" /notes//plan.md ")).toBe("notes/plan.md")
    expect(cleanLibraryPath("notes\\plan.md")).toBe("notes/plan.md")
    expect(cleanLibraryPath("../../etc/passwd")).toBeUndefined()
    expect(cleanLibraryPath("  ")).toBeUndefined()
  })
})

describe("listing the folder on a machine with real programs", () => {
  it("reads the whole tree with one command, leaving out what is not a document", async () => {
    const sandbox = createLocalProcessSandbox()
    const folder = `${sandbox.home}/library`
    expect(await listFolder(sandbox, folder)).toEqual(new Map())
    await sandbox.exec(
      "mkdir -p library/a/b library/node_modules/x library/.git && printf 12345 > 'library/a/b/deep file.md' && printf 1 > library/top.txt && printf 1 > library/.env && printf 1 > library/node_modules/x/i.js && printf 1 > library/.git/HEAD && ln -s top.txt library/link.txt",
    )
    let commands = 0
    const counted = {
      ...sandbox,
      exec: (...args: Parameters<typeof sandbox.exec>) => (commands++, sandbox.exec(...args)),
    }
    const listed = await listFolder(counted, folder)
    expect(commands).toBe(1)
    expect([...listed.keys()].sort()).toEqual(["a/b/deep file.md", "top.txt"])
    expect(listed.get("a/b/deep file.md")!.size).toBe(5)

    // The same file reads the same twice, and differently once it is rewritten.
    const again = await listFolder(sandbox, folder)
    expect(again.get("top.txt")).toEqual(listed.get("top.txt"))
    await new Promise((resolve) => setTimeout(resolve, 20))
    await sandbox.exec("printf 2 > library/top.txt")
    expect((await listFolder(sandbox, folder)).get("top.txt")!.mtimeMs).toBeGreaterThan(
      listed.get("top.txt")!.mtimeMs,
    )
  })
})

describe("planning a pass", () => {
  const listed = (size: number, mtimeMs: number): Listed => ({ size, mtimeMs })
  const run = (
    folder: Record<string, Listed>,
    stored: Record<string, Stored>,
    base: Record<string, Base>,
  ) => plan(new Map(Object.entries(folder)), new Map(Object.entries(stored)), base)
  const agreed: Base = { id: "f", rev: 1, size: 10, mtimeMs: 100 }

  it("does nothing while both sides are as they were", () => {
    expect(
      run({ "a.md": listed(10, 100) }, { "a.md": { id: "f", rev: 1 } }, { "a.md": agreed }),
    ).toEqual([])
  })

  it("takes in what is new or changed in the folder", () => {
    expect(run({ "a.md": listed(10, 100) }, {}, {})).toEqual([{ do: "pull", path: "a.md" }])
    expect(
      run({ "a.md": listed(12, 200) }, { "a.md": { id: "f", rev: 1 } }, { "a.md": agreed }),
    ).toEqual([{ do: "pull", path: "a.md" }])
  })

  it("writes out what is new or changed in the library", () => {
    expect(run({}, { "a.md": { id: "f", rev: 0 } }, {})).toEqual([{ do: "push", path: "a.md" }])
    expect(
      run({ "a.md": listed(10, 100) }, { "a.md": { id: "f", rev: 2 } }, { "a.md": agreed }),
    ).toEqual([{ do: "push", path: "a.md" }])
  })

  it("follows a deletion on either side, unless the other side changed meanwhile", () => {
    expect(run({}, { "a.md": { id: "f", rev: 1 } }, { "a.md": agreed })).toEqual([
      { do: "drop", path: "a.md" },
    ])
    expect(run({ "a.md": listed(10, 100) }, {}, { "a.md": agreed })).toEqual([
      { do: "unlink", path: "a.md" },
    ])
    // Deleted in the folder, edited in the library: the edit is kept, and written back.
    expect(run({}, { "a.md": { id: "f", rev: 2 } }, { "a.md": agreed })).toEqual([
      { do: "push", path: "a.md" },
    ])
    // Deleted in the library, changed in the folder: that is new work, and is taken in.
    expect(run({ "a.md": listed(11, 300) }, {}, { "a.md": agreed })).toEqual([
      { do: "pull", path: "a.md" },
    ])
    expect(run({}, {}, { "a.md": agreed })).toEqual([{ do: "forget", path: "a.md" }])
  })

  it("lets the folder win where both changed", () => {
    expect(
      run({ "a.md": listed(12, 200) }, { "a.md": { id: "f", rev: 2 } }, { "a.md": agreed }),
    ).toEqual([{ do: "pull", path: "a.md" }])
  })
})

describe("the library folder", () => {
  it("takes what the agent writes there into the library, folders and all", async () => {
    await call("/init", "POST", { ownerId: "user-1" })
    chat = await call<ChatSummary>("/chats", "POST", {})
    await bash(
      "mkdir -p library/trip && printf '# Lisbon\\n' > library/trip/plan.md && printf 'x' > library/.hidden && mkdir -p library/node_modules/a && printf 'y' > library/node_modules/a/index.js",
    )
    const { files } = await listing()
    // Hidden files and dependency folders are not documents.
    expect(files.map((file) => file.path)).toEqual(["trip/plan.md"])
    expect(files[0]).toMatchObject({
      name: "plan.md",
      source: "agent",
      contentType: "text/markdown",
      size: 9,
      rev: 0,
    })
    expect(await text(files[0]!)).toBe("# Lisbon\n")
  })

  it("takes a program's output the same way as a file written by hand", async () => {
    await bash("for n in 1 2 3; do printf 'row %s\\n' $n > library/trip/day-$n.txt; done")
    const paths = (await listing()).files.map((file) => file.path).sort()
    expect(paths).toEqual(["trip/day-1.txt", "trip/day-2.txt", "trip/day-3.txt", "trip/plan.md"])
  })

  it("keeps what a file held when the agent changes it", async () => {
    const before = (await fileAt("trip/plan.md"))!
    await agentDoes(["write", { path: "library/trip/plan.md", content: "# Lisbon\n\nDay 1\n" }])
    const after = (await fileAt("trip/plan.md"))!
    expect(after).toMatchObject({ id: before.id, rev: 1, updatedBy: "agent", size: 16 })
    const { versions } = await call<{ versions: LibraryVersion[] }>(`/library/${after.id}/versions`)
    expect(versions).toMatchObject([{ rev: 0, size: 9, by: "agent" }])
    expect(await (await request(`/library/${after.id}?rev=0`)).text()).toBe("# Lisbon\n")
  })

  it("puts a file the user adds into the folder before the agent next looks", async () => {
    const uploaded = await request("/library?name=notes.md&dir=trip", {
      method: "POST",
      body: "bring an umbrella\n",
    })
    expect(((await uploaded.json()) as LibraryFile).path).toBe("trip/notes.md")
    // From a chat, with no folder named, a file goes with the uploads.
    await request(`/library?name=photo.txt&chat=${chat.id}`, { method: "POST", body: "pixels" })
    const state = await bash("cat library/trip/notes.md library/uploads/photo.txt")
    expect(lastTool(state).output).toBe("bring an umbrella\npixels")
    // Reading them changed nothing, so nothing is written back.
    expect((await fileAt("trip/notes.md"))!.rev).toBe(0)
  })

  it("gives the agent the user's edit, and refuses an edit made from an old copy", async () => {
    const file = (await fileAt("trip/plan.md"))!
    const saved = await request(`/library/${file.id}?rev=${file.rev}`, {
      method: "PUT",
      body: "# Lisbon\n\nDay 1, edited by me\n",
    })
    expect(saved.status).toBe(200)
    expect((await saved.json()) as LibraryFile).toMatchObject({ rev: 2, updatedBy: "user" })
    expect(lastTool(await bash("cat library/trip/plan.md")).output).toBe(
      "# Lisbon\n\nDay 1, edited by me\n",
    )

    const stale = await request(`/library/${file.id}?rev=${file.rev}`, {
      method: "PUT",
      body: "old",
    })
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as { code: string }).code).toBe("conflict")
    expect((await fileAt("trip/plan.md"))!.rev).toBe(2)
  })

  it("puts a file back to an earlier content", async () => {
    const file = (await fileAt("trip/plan.md"))!
    const reverted = await call<LibraryFile>(`/library/${file.id}/revert`, "POST", { rev: 0 })
    expect(reverted.rev).toBe(3)
    expect(lastTool(await bash("cat library/trip/plan.md")).output).toBe("# Lisbon\n")
  })

  it("follows a rename on the computer without losing the file's history", async () => {
    const before = (await fileAt("trip/plan.md"))!
    await bash("mkdir -p library/lisbon && mv library/trip/plan.md library/lisbon/itinerary.md")
    const after = (await fileAt("lisbon/itinerary.md"))!
    expect(after.id).toBe(before.id)
    expect(await fileAt("trip/plan.md")).toBeUndefined()
    expect((await listing()).deleted).toEqual([])
  })

  it("keeps a file the agent deletes where the user can bring it back", async () => {
    await bash("rm library/trip/day-1.txt")
    expect(await fileAt("trip/day-1.txt")).toBeUndefined()
    const { deleted } = await listing()
    expect(deleted).toMatchObject([{ path: "trip/day-1.txt", deletedBy: "agent" }])

    const restored = await call<LibraryFile>(`/library/deleted/${deleted[0]!.id}/restore`, "POST")
    expect(restored.path).toBe("trip/day-1.txt")
    expect(lastTool(await bash("cat library/trip/day-1.txt")).output).toBe("row 1\n")
  })

  it("removes from the folder what the user deletes, and moves what they move", async () => {
    await call(`/library/${(await fileAt("trip/day-2.txt"))!.id}`, "DELETE")
    const moved = await call<LibraryFile>(
      `/library/${(await fileAt("trip/day-3.txt"))!.id}`,
      "PATCH",
      {
        path: "archive/third day.txt",
      },
    )
    expect(moved).toMatchObject({ path: "archive/third day.txt", name: "third day.txt" })
    const state = await bash("ls library/trip; cat 'library/archive/third day.txt'")
    expect(lastTool(state).output).toBe("day-1.txt\nnotes.md\nrow 3\n")
    await expect(call(`/library/${moved.id}`, "PATCH", { path: "trip/notes.md" })).rejects.toThrow(
      "already a file",
    )
  })

  it("shows the user a file from the folder without keeping a second copy", async () => {
    const state = await agentDoes(
      ["write", { path: "library/report.md", content: "# Report\n" }],
      ["send_file", { path: "library/report.md" }],
    )
    const sent = lastTool(state)
    expect(sent).toMatchObject({ name: "send_file", status: "done" })
    expect(sent.details).toMatchObject({ path: "report.md", source: "agent" })
    const reports = (await listing()).files.filter((file) => file.name === "report.md")
    expect(reports.map((file) => file.id)).toEqual([(sent.details as unknown as LibraryFile).id])
  })

  it("tells the agent, once, about a file the library cannot take", async () => {
    const state = await bash("printf 'x' > 'library/constructor'")
    expect(lastTool(state).output).toContain("was not added to the user's library")
    expect(lastTool(await bash("true")).output ?? "").not.toContain("was not added")
  })
})

describe("viewing files as pages", () => {
  it("serves a page and what it links to, sandboxed, to whoever has the address", async () => {
    await agentDoes(
      ["bash", { command: "mkdir -p library/site" }],
      [
        "write",
        {
          path: "library/site/index.html",
          content: '<link rel="stylesheet" href="style.css"><h1>Hi</h1>',
        },
      ],
      ["write", { path: "library/site/style.css", content: "h1{color:teal}" }],
    )
    const page = await view("site/index.html")
    expect(page.status).toBe(200)
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8")
    // Runs scripts, but with an origin of its own: it is not the app, though the app serves it.
    const policy = page.headers.get("content-security-policy")!
    expect(policy).toContain("sandbox")
    expect(policy).not.toContain("allow-same-origin")
    expect(page.headers.get("referrer-policy")).toBe("no-referrer")
    expect(page.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await page.text()).toContain("<h1>Hi</h1>")

    const style = await view("site/style.css")
    expect(style.headers.get("content-type")).toBe("text/css; charset=utf-8")
    expect(await style.text()).toBe("h1{color:teal}")
  })

  it("serves a folder as its index page, from an address its links resolve against", async () => {
    const redirect = await view("site")
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get("location")).toBe("site/")
    expect(await (await view("site/")).text()).toContain("<h1>Hi</h1>")
  })

  it("answers nothing without the right address", async () => {
    const { view: token } = await listing()
    expect((await request(`/view/${token}x/site/index.html`)).status).toBe(404)
    expect((await request("/view/nonsense/site/index.html")).status).toBe(404)
    expect((await view("site/missing.html")).status).toBe(404)
  })

  it("does not send again a file the browser already has", async () => {
    const first = await view("site/style.css")
    const again = await view("site/style.css", { "if-none-match": first.headers.get("etag")! })
    expect(again.status).toBe(304)
  })

  it("hands a link from a page to a document back to the app to open", async () => {
    const response = await view("report.md", { "sec-fetch-dest": "iframe" })
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(await response.text()).toContain('"dc-library-open","path":"report.md"')
    // Asked for as itself, it is the document.
    expect(await (await view("report.md")).text()).toBe("# Report\n")
  })
})
