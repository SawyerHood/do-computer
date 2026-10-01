import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node"
import { afterAll, describe, expect, it } from "vitest"
import { fileBlobs, NodeActorNamespace, openNodeAppDatabase } from "../src/node/index.ts"
import {
  conformanceActor,
  registerAppDatabaseConformance,
  registerHostConformance,
} from "../src/testing.ts"

const directory = mkdtempSync(join(tmpdir(), "dc-runtime-"))
const open = () =>
  new NodeActorNamespace({
    directory: join(directory, "actors"),
    factory: conformanceActor,
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
  })

let namespace = open()
let counter = 0
afterAll(() => namespace.close())

registerHostConformance({ describe, it, expect }, "Node", {
  namespace: () => namespace,
  uniqueName: () => `agent:${++counter}`,
})

registerAppDatabaseConformance({ describe, it, expect }, "Node", async () => {
  return openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-app-")), "app.sqlite")).app
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
