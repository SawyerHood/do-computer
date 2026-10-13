import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LibraryFile, LibraryListing } from "@do-computer/protocol"
import type { BlobRange, BlobStore } from "@do-computer/runtime"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor, createLibraryActor, LIBRARY_SITE_HEADER } from "../src/index.ts"

const STYLE = '<style id="dc-visual-theme">'

/** Each time a file's bytes were asked of where they are kept: which part, and how much came. */
type Read = { key: string; range: BlobRange | undefined; bytes: number }

type World = {
  agents: NodeActorNamespace
  libraries: NodeActorNamespace
  reads: Read[]
}
const worlds: World[] = []

/** A blob store that notes what is read from it. */
function watched(blobs: BlobStore, reads: Read[]): BlobStore {
  return {
    put: (key, data, metadata) => blobs.put(key, data, metadata),
    head: (key) => blobs.head(key),
    delete: (key) => blobs.delete(key),
    list: (prefix) => blobs.list(prefix),
    async get(key, options) {
      const object = await blobs.get(key, options)
      if (object === undefined) return undefined
      return {
        ...object,
        async bytes() {
          const bytes = await object.bytes()
          reads.push({ key, range: options?.range, bytes: bytes.length })
          return bytes
        },
      }
    },
  }
}

/** `shared`: the agent is in a workspace that keeps the library. Otherwise it keeps its own. */
function open(shared = true): World {
  const root = mkdtempSync(join(tmpdir(), "dc-ranges-"))
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const reads: Read[] = []
  const libraries = new NodeActorNamespace({
    directory: join(root, "libraries"),
    blobs: (name) =>
      watched(fileBlobs(join(root, "library-blobs", encodeURIComponent(name))), reads),
    factory: (host) => createLibraryActor(host),
  })
  const agents = new NodeActorNamespace({
    directory: join(root, "agents"),
    blobs: (name) => watched(fileBlobs(join(root, "blobs", encodeURIComponent(name))), reads),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        computers: { kinds: [], default: "", create: () => undefined },
        ...(shared ? { library: async () => libraries.get("workspace-1") } : {}),
      }),
  })
  agents.start()
  const world = { agents, libraries, reads }
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

async function put(
  world: World,
  path: string,
  content: Uint8Array<ArrayBuffer> | string,
  type: string,
): Promise<LibraryFile> {
  const response = await request(world, `/library?path=${encodeURIComponent(path)}`, {
    method: "POST",
    body: content,
    headers: { "content-type": type },
  })
  expect(response.status).toBe(201)
  return (await response.json()) as LibraryFile
}

/** A film of a thousand bytes, each one telling where it is. */
const FILM = new Uint8Array(1000).map((_, index) => index % 251)
const part = (from: number, to: number) => [...FILM.slice(from, to + 1)]
const bytesOf = async (response: Response) => [...new Uint8Array(await response.arrayBuffer())]

async function withFilm(world: World): Promise<LibraryFile> {
  const init = await request(world, "/init", {
    method: "POST",
    body: JSON.stringify({ ownerId: "user-1" }),
    headers: { "content-type": "application/json" },
  })
  expect(init.ok).toBe(true)
  const file = await put(world, "films/clip.mp4", FILM, "video/mp4")
  // What was read to keep it is not what is being counted.
  world.reads.length = 0
  return file
}

/** A file as the app's viewer asks for it: by the address that stands in for a session. */
const viewed = async (world: World, path: string, headers?: Record<string, string>) => {
  const listing = (await (await request(world, "/library")).json()) as LibraryListing
  return request(world, `/view/${listing.view}/${path}`, { headers })
}

/** A site's file, as the gateway asks the library for it once it has let someone in. */
const served = (world: World, root: string, rest: string, headers?: Record<string, string>) =>
  world.libraries.get("workspace-1").fetch(
    new Request(`http://library/site/${rest}`, {
      headers: { ...headers, [LIBRARY_SITE_HEADER]: encodeURIComponent(root) },
    }),
  )

/** Every way one part is asked for, and the first and last byte each is. */
const FORMS: [range: string, from: number, to: number][] = [
  ["bytes=0-0", 0, 0],
  ["bytes=100-163", 100, 163],
  ["bytes=990-", 990, 999],
  ["bytes=-10", 990, 999],
  // What runs past the end stops at the end, and more than there is is all there is.
  ["bytes=990-5000", 990, 999],
  ["bytes=-5000", 0, 999],
  ["bytes=0-", 0, 999],
]

describe("a part of a library file", () => {
  it("is what the app's own address sends, still only as a download", async () => {
    const world = open()
    const file = await withFilm(world)
    const whole = await request(world, `/library/${file.id}`)
    expect(whole.status).toBe(200)
    expect(whole.headers.get("accept-ranges")).toBe("bytes")
    expect(await bytesOf(whole)).toEqual([...FILM])
    for (const [range, from, to] of FORMS) {
      const response = await request(world, `/library/${file.id}`, { headers: { range } })
      expect(response.status, range).toBe(206)
      expect(response.headers.get("content-range"), range).toBe(`bytes ${from}-${to}/1000`)
      expect(response.headers.get("content-length"), range).toBe(String(to - from + 1))
      expect(response.headers.get("accept-ranges"), range).toBe("bytes")
      expect(await bytesOf(response), range).toEqual(part(from, to))
      // Everything that keeps a file from running as a page is as it is on the whole file.
      for (const name of [
        "content-type",
        "content-disposition",
        "x-content-type-options",
        "content-security-policy",
        "cache-control",
        "etag",
      ]) {
        expect(response.headers.get(name), `${range} ${name}`).toBe(whole.headers.get(name))
      }
      expect(response.headers.get("content-type")).toBe("application/octet-stream")
      expect(response.headers.get("content-disposition")).toBe(
        "attachment; filename*=UTF-8''clip.mp4",
      )
      expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'")
    }
  })

  it("is what the address a file is viewed at sends, as the film it is", async () => {
    const world = open()
    await withFilm(world)
    const whole = await viewed(world, "films/clip.mp4")
    expect(whole.status).toBe(200)
    expect(whole.headers.get("accept-ranges")).toBe("bytes")
    for (const [range, from, to] of FORMS) {
      const response = await viewed(world, "films/clip.mp4", { range })
      expect(response.status, range).toBe(206)
      expect(response.headers.get("content-range"), range).toBe(`bytes ${from}-${to}/1000`)
      expect(response.headers.get("content-length"), range).toBe(String(to - from + 1))
      expect(await bytesOf(response), range).toEqual(part(from, to))
      for (const name of [
        "content-type",
        "x-content-type-options",
        "content-security-policy",
        "referrer-policy",
        "cache-control",
        "etag",
      ]) {
        expect(response.headers.get(name), `${range} ${name}`).toBe(whole.headers.get(name))
      }
      expect(response.headers.get("content-type")).toBe("video/mp4")
      expect(response.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts allow-popups allow-forms allow-modals",
      )
      expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    }
  })

  it("is what a shared site sends for one of its files", async () => {
    const world = open()
    await withFilm(world)
    const response = await served(world, "films", "clip.mp4", { range: "bytes=10-19" })
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe("bytes 10-19/1000")
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(await bytesOf(response)).toEqual(part(10, 19))
    // And for a file that is the one thing shared.
    const alone = await served(world, "films/clip.mp4", "", { range: "bytes=-3" })
    expect(alone.status).toBe(206)
    expect(await bytesOf(alone)).toEqual(part(997, 999))
  })

  it("is all that is read from where the file is kept", async () => {
    const world = open()
    const file = await withFilm(world)
    await bytesOf(
      await request(world, `/library/${file.id}`, { headers: { range: "bytes=64-127" } }),
    )
    await bytesOf(await viewed(world, "films/clip.mp4", { range: "bytes=-100" }))
    await bytesOf(await served(world, "films", "clip.mp4", { range: "bytes=900-" }))
    expect(world.reads.map(({ range, bytes }) => ({ range, bytes }))).toEqual([
      { range: { offset: 64, length: 64 }, bytes: 64 },
      { range: { offset: 900, length: 100 }, bytes: 100 },
      { range: { offset: 900, length: 100 }, bytes: 100 },
    ])
    // With no part asked for, it is all read, as it was before.
    world.reads.length = 0
    await bytesOf(await viewed(world, "films/clip.mp4"))
    expect(world.reads.map(({ range, bytes }) => ({ range, bytes }))).toEqual([
      { range: undefined, bytes: 1000 },
    ])
  })

  it("is refused, with the size of the file, when no byte of the file is in it", async () => {
    const world = open()
    const file = await withFilm(world)
    for (const range of ["bytes=1000-", "bytes=1000-1001", "bytes=5000-6000", "bytes=-0"]) {
      for (const response of [
        await request(world, `/library/${file.id}`, { headers: { range } }),
        await viewed(world, "films/clip.mp4", { range }),
        await served(world, "films", "clip.mp4", { range }),
      ]) {
        expect(response.status, range).toBe(416)
        expect(response.headers.get("content-range"), range).toBe("bytes */1000")
        expect(response.headers.get("x-content-type-options"), range).toBe("nosniff")
        expect(response.headers.get("content-security-policy"), range).toContain("sandbox")
        expect(await bytesOf(response), range).toEqual([])
      }
    }
    // Nothing was read to say so.
    expect(world.reads).toEqual([])
  })

  it("is the whole file instead, when what is asked is not one part of this copy", async () => {
    const world = open()
    const file = await withFilm(world)
    const etag = (await request(world, `/library/${file.id}`)).headers.get("etag")!
    const viewedEtag = (await viewed(world, "films/clip.mp4")).headers.get("etag")!
    const wholes: Record<string, string>[] = [
      // Several parts at once.
      { range: "bytes=0-1,5-6" },
      // A part of a copy the browser had, which is not the one kept now.
      { range: "bytes=0-9", "if-range": '"another.0"' },
      { range: "bytes=0-9", "if-range": "Wed, 21 Oct 2026 07:28:00 GMT" },
      // Not bytes, not numbers, or backwards.
      { range: "lines=0-9" },
      { range: "bytes=a-b" },
      { range: "bytes=-" },
      { range: "bytes=9-0" },
    ]
    for (const headers of wholes) {
      for (const response of [
        await request(world, `/library/${file.id}`, { headers }),
        await viewed(world, "films/clip.mp4", headers),
      ]) {
        expect(response.status, JSON.stringify(headers)).toBe(200)
        expect(response.headers.get("content-range"), JSON.stringify(headers)).toBeNull()
        expect(response.headers.get("content-length")).toBe("1000")
        expect(await bytesOf(response)).toEqual([...FILM])
      }
    }
    // The copy the browser has some of is this one: it is sent the rest.
    const rest = await request(world, `/library/${file.id}`, {
      headers: { range: "bytes=500-", "if-range": etag },
    })
    expect(rest.status).toBe(206)
    expect(await bytesOf(rest)).toEqual(part(500, 999))
    const viewedRest = await viewed(world, "films/clip.mp4", {
      range: "bytes=500-",
      "if-range": viewedEtag,
    })
    expect(viewedRest.status).toBe(206)
    expect(await bytesOf(viewedRest)).toEqual(part(500, 999))
  })

  it("is not sent to a browser that has the file already", async () => {
    const world = open()
    const file = await withFilm(world)
    const etag = (await request(world, `/library/${file.id}`)).headers.get("etag")!
    const again = await request(world, `/library/${file.id}`, {
      headers: { range: "bytes=0-9", "if-none-match": etag },
    })
    expect(again.status).toBe(304)
    const viewedEtag = (await viewed(world, "films/clip.mp4")).headers.get("etag")!
    const viewedAgain = await viewed(world, "films/clip.mp4", {
      range: "bytes=0-9",
      "if-none-match": viewedEtag,
    })
    expect(viewedAgain.status).toBe(304)
  })

  it("is a part of an earlier revision, where that is what is asked for", async () => {
    const world = open()
    const file = await withFilm(world)
    const shorter = new Uint8Array(40).fill(7)
    const written = await request(world, `/library/${file.id}`, { method: "PUT", body: shorter })
    expect(written.ok).toBe(true)
    const now = await request(world, `/library/${file.id}`, { headers: { range: "bytes=-4" } })
    expect(now.headers.get("content-range")).toBe("bytes 36-39/40")
    expect(await bytesOf(now)).toEqual([7, 7, 7, 7])
    const before = await request(world, `/library/${file.id}?rev=${file.rev}`, {
      headers: { range: "bytes=-4" },
    })
    expect(before.status).toBe(206)
    expect(before.headers.get("content-range")).toBe("bytes 996-999/1000")
    expect(await bytesOf(before)).toEqual(part(996, 999))
    // What the film was is past the end of what it is now.
    const past = await request(world, `/library/${file.id}`, { headers: { range: "bytes=500-" } })
    expect(past.status).toBe(416)
    expect(past.headers.get("content-range")).toBe("bytes */40")
  })

  it("is the whole of a file with nothing in it", async () => {
    const world = open()
    await withFilm(world)
    await put(world, "films/empty.mp4", new Uint8Array(0), "video/mp4")
    const response = await viewed(world, "films/empty.mp4", { range: "bytes=0-9" })
    expect(response.status).toBe(200)
    expect(await bytesOf(response)).toEqual([])
  })

  it("is sent from a library an agent keeps for itself", async () => {
    const world = open(false)
    const file = await withFilm(world)
    const response = await request(world, `/library/${file.id}`, {
      headers: { range: "bytes=2-5" },
    })
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe("bytes 2-5/1000")
    expect(await bytesOf(response)).toEqual(part(2, 5))
    const page = await viewed(world, "films/clip.mp4", { range: "bytes=-2" })
    expect(page.status).toBe(206)
    expect(await bytesOf(page)).toEqual(part(998, 999))
    expect(world.reads.map(({ range }) => range)).toEqual([
      { offset: 2, length: 4 },
      { offset: 998, length: 2 },
    ])
  })
})

describe("a page of the library, asked for in part", () => {
  const PAGE =
    '<!doctype html><html lang="en"><head><title>Q3</title></head>' +
    "<body><div class=card>Revenue</div></body></html>"

  it("is served whole, in the app's look, and does not say it can be had in parts", async () => {
    const world = open()
    await withFilm(world)
    await put(world, "reports/q3.html", PAGE, "text/html")
    for (const response of [
      await viewed(world, "reports/q3.html", { range: "bytes=0-9" }),
      await served(world, "reports", "q3.html", { range: "bytes=0-9" }),
      await served(world, "reports/q3.html", "", { range: "bytes=5000-" }),
    ]) {
      expect(response.status).toBe(200)
      expect(response.headers.get("accept-ranges")).toBeNull()
      expect(response.headers.get("content-range")).toBeNull()
      const page = await response.text()
      expect(Number(response.headers.get("content-length"))).toBe(
        new TextEncoder().encode(page).length,
      )
      expect(page).toContain(STYLE)
      expect(page).toContain("<body><div class=card>Revenue</div></body></html>")
    }
  })

  it("is handed over whole from the app's own address, with the look or as it was written", async () => {
    const world = open()
    await withFilm(world)
    const file = await put(world, "reports/q3.html", PAGE, "text/html")
    const written = await request(world, `/library/${file.id}`, { headers: { range: "bytes=0-9" } })
    expect(written.status).toBe(200)
    expect(written.headers.get("accept-ranges")).toBeNull()
    expect(written.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(await written.text()).toBe(PAGE)
    const dressed = await request(world, `/library/${file.id}?look`, {
      headers: { range: "bytes=0-9" },
    })
    expect(dressed.status).toBe(200)
    expect(dressed.headers.get("accept-ranges")).toBeNull()
    expect(await dressed.text()).toContain(STYLE)
  })
})
