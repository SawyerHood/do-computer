import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node"
import { afterAll, describe, expect, it } from "vitest"
import { fileBlobs, NodeActorNamespace, openNodeAppDatabase } from "../src/node/index.ts"
import { type SocketLike } from "../src/node/index.ts"
import { type PreviewPage, previewIn } from "../src/preview.ts"
import {
  CONFORMANCE_AUTO_RESPONSE,
  conformanceActor,
  registerAppDatabaseConformance,
  registerHostConformance,
  registerSocketConformance,
  type TestSocket,
} from "../src/testing.ts"

const directory = mkdtempSync(join(tmpdir(), "dc-runtime-"))
const open = () =>
  new NodeActorNamespace({
    directory: join(directory, "actors"),
    factory: conformanceActor,
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    socketAutoResponse: CONFORMANCE_AUTO_RESPONSE,
  })

/** An in-memory socket: the server end has the shape of a `ws` socket, the client end is the test's. */
function socketPair(): { server: SocketLike; client: TestSocket } {
  const listeners = {
    message: [] as ((data: unknown, binary: boolean) => void)[],
    close: [] as ((code: number, reason: unknown) => void)[],
  }
  const inbox: string[] = []
  const waiting: ((message: string) => void)[] = []
  const closed = Promise.withResolvers<number>()
  let state = 1
  const server: SocketLike = {
    get readyState() {
      return state
    },
    send: (data) => {
      const next = waiting.shift()
      if (next) next(data)
      else inbox.push(data)
    },
    close: (code = 1000) => {
      if (state !== 1) return
      state = 3
      closed.resolve(code)
      for (const listener of listeners.close) listener(code, "")
    },
    on: (event: string, listener: never) => {
      if (event === "message" || event === "close") listeners[event].push(listener)
      return server
    },
  }
  const client: TestSocket = {
    send: (data) =>
      queueMicrotask(() => listeners.message.forEach((listener) => listener(data, false))),
    close: (code = 1000) => {
      if (state !== 1) return
      state = 3
      queueMicrotask(() => listeners.close.forEach((listener) => listener(code, "")))
    },
    next: () => {
      const ready = inbox.shift()
      return ready === undefined
        ? new Promise((resolve) => waiting.push(resolve))
        : Promise.resolve(ready)
    },
    closed: closed.promise,
  }
  return { server, client }
}

let namespace = open()
let counter = 0
afterAll(() => namespace.close())

registerHostConformance({ describe, it, expect }, "Node", {
  namespace: () => namespace,
  uniqueName: () => `agent:${++counter}`,
})

registerSocketConformance({ describe, it, expect }, "Node", {
  namespace: () => namespace,
  uniqueName: () => `agent:${++counter}`,
  connect: async (name, tag) => {
    const { server, client } = socketPair()
    await namespace.connect(name, server, new Request(`http://actor/connect?tag=${tag}`))
    return client
  },
})

registerAppDatabaseConformance({ describe, it, expect }, "Node", async () => {
  return openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-app-")), "app.sqlite")).app
})

describe("Node: an actor unloaded under its sockets", () => {
  it("is loaded again by what a socket says, and finds its sockets and their notes", async () => {
    const name = `agent:${++counter}`
    const { server, client } = socketPair()
    await namespace.connect(name, server, new Request("http://actor/connect?tag=x"))
    await client.next()
    client.send("keep:mine")
    expect(await client.next()).toBe("kept")
    await namespace.evict(name)
    // Nothing of the actor is in memory now. The socket is still there, and so is its note.
    client.send("notes")
    expect(await client.next()).toBe("notes:mine")
    const sockets = await namespace.get(name).fetch(new Request("http://actor/sockets"))
    expect(await sockets.json()).toEqual({ count: 1 })
    // One that is not loaded is not there to unload.
    await namespace.evict(`agent:${++counter}`)
    client.close(1000)
  })
})

describe("Node: restart", () => {
  const call = async <T>(name: string, path: string) =>
    (await (await namespace.get(name).fetch(new Request(`http://actor${path}`))).json()) as T

  it("keeps an actor's data and re-arms its alarm after a restart", async () => {
    const name = "agent:restart"
    await call(name, "/put?key=k&value=kept")
    await call(name, "/alarm/set?in=200")
    await namespace.close()

    namespace = open()
    expect((await call<{ value: string }>(name, "/get?key=k")).value).toBe("kept")
    // Not started yet: the alarm is recorded but no timer is armed.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect((await call<{ fired: unknown[] }>(name, "/alarm/fired")).fired.length).toBe(0)

    namespace.start()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((await call<{ fired: unknown[] }>(name, "/alarm/fired")).fired.length).toBe(1)
  })

  it("retries an alarm whose handler rejects", async () => {
    let attempts = 0
    const failing = new NodeActorNamespace({
      directory: join(directory, "failing"),
      factory: (host) => ({
        fetch: async () => {
          await host.setAlarm(host.now())
          return new Response("ok")
        },
        alarm: async () => {
          if (++attempts === 1) throw new Error("first attempt fails")
        },
      }),
      blobs: () => fileBlobs(join(directory, "failing-blobs")),
      onError: () => {},
    })
    try {
      await failing.get("a").fetch(new Request("http://actor/"))
      const deadline = Date.now() + 8_000
      while (attempts < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(attempts).toBe(2)
    } finally {
      await failing.close()
    }
  }, 10_000)
})

describe("Node: database facade", () => {
  it("is the facade pi-durable ships", async () => {
    const database = await openNodeSqliteDatabase(":memory:")
    await database.exec("CREATE TABLE t (v TEXT)")
    await database.close()
    expect(BACKGROUND_CONTEXT).toBeDefined()
  })
})

describe("a preview of a page", () => {
  it("is a JPEG of the part asked for, which is a fraction of a PNG of it", async () => {
    const shots: unknown[] = []
    const page: PreviewPage = {
      setViewport: async () => {},
      on: () => {},
      setContent: async () => {},
      goto: async () => null,
      emulateMediaFeatures: async () => {},
      // Every width is 900px tall.
      evaluate: async () => 900,
      screenshot: async (options) => {
        shots.push(options)
        return "/9j/AA=="
      },
    }
    const seen = await previewIn(page, { html: "<p>hi</p>", width: 640, widths: [360], most: 500 })
    expect(shots).toEqual([
      {
        type: "jpeg",
        quality: 80,
        encoding: "base64",
        clip: { x: 0, y: 0, width: 640, height: 500 },
      },
    ])
    expect(seen).toMatchObject({ picture: "/9j/AA==", mimeType: "image/jpeg", pictured: 500 })
  })
})
