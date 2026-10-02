import { env, runInDurableObject } from "cloudflare:test"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { registerStorageConformance } from "@earendil-works/pi-durable/testing"
import { describe, expect, it } from "vitest"
import {
  d1Database,
  DurableObjectSqliteDatabase,
  durableObjectNamespace,
} from "../src/cloudflare/index.ts"
import {
  registerAppDatabaseConformance,
  registerHostConformance,
  registerSocketConformance,
  type TestSocket,
} from "../src/testing.ts"
import type { Env } from "./worker.ts"

const bindings = env as unknown as Env
let counter = 0

registerHostConformance({ describe, it, expect }, "Durable Object", {
  namespace: () => durableObjectNamespace(bindings.ACTOR),
  uniqueName: () => `agent:${++counter}`,
})

registerSocketConformance({ describe, it, expect }, "Durable Object", {
  namespace: () => durableObjectNamespace(bindings.ACTOR),
  uniqueName: () => `agent:${++counter}`,
  connect: async (name, tag) => {
    const response = await durableObjectNamespace(bindings.ACTOR)
      .get(name)
      .fetch(new Request(`http://actor/connect?tag=${tag}`, { headers: { upgrade: "websocket" } }))
    const socket = response.webSocket
    if (response.status !== 101 || socket === null) throw new Error("The actor did not upgrade")
    const inbox: string[] = []
    const waiting: ((message: string) => void)[] = []
    const closed = Promise.withResolvers<number>()
    socket.addEventListener("message", (event) => {
      const next = waiting.shift()
      if (next) next(String(event.data))
      else inbox.push(String(event.data))
    })
    socket.addEventListener("close", (event) => closed.resolve(event.code))
    socket.accept()
    return {
      send: (data) => socket.send(data),
      close: (code) => socket.close(code),
      next: () => {
        const ready = inbox.shift()
        return ready === undefined
          ? new Promise((resolve) => waiting.push(resolve))
          : Promise.resolve(ready)
      },
      closed: closed.promise,
    } satisfies TestSocket
  },
})

registerAppDatabaseConformance({ describe, it, expect }, "D1", async () => d1Database(bindings.DB))

// pi-durable's own storage suite, run over the Durable Object SQLite facade.
registerStorageConformance({ describe, expect, it }, "Durable Object SQLite", async (use) => {
  const stub = bindings.ACTOR.get(bindings.ACTOR.newUniqueId())
  await runInDurableObject(stub, async (_instance, state) => {
    await use(await SqliteStorage.open(new DurableObjectSqliteDatabase(state.storage)))
  })
})
