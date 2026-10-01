import { env, runInDurableObject } from "cloudflare:test"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { registerStorageConformance } from "@earendil-works/pi-durable/testing"
import { describe, expect, it } from "vitest"
import {
  d1Database,
  DurableObjectSqliteDatabase,
  durableObjectNamespace,
} from "../src/cloudflare/index.ts"
import { registerAppDatabaseConformance, registerHostConformance } from "../src/testing.ts"
import type { Env } from "./worker.ts"

const bindings = env as unknown as Env
let counter = 0

registerHostConformance({ describe, it, expect }, "Durable Object", {
  namespace: () => durableObjectNamespace(bindings.ACTOR),
  uniqueName: () => `agent:${++counter}`,
})

registerAppDatabaseConformance({ describe, it, expect }, "D1", async () => d1Database(bindings.DB))

// pi-durable's own storage suite, run over the Durable Object SQLite facade.
registerStorageConformance({ describe, expect, it }, "Durable Object SQLite", async (use) => {
  const stub = bindings.ACTOR.get(bindings.ACTOR.newUniqueId())
  await runInDurableObject(stub, async (_instance, state) => {
    await use(await SqliteStorage.open(new DurableObjectSqliteDatabase(state.storage)))
  })
})
