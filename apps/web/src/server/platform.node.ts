import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { createAgentActor, createAgentModels } from "@durable-computer/agent"
import { fileBlobs, NodeActorNamespace, openNodeAppDatabase } from "@durable-computer/runtime/node"
import { type Platform, readConfig } from "./platform.ts"

const KEY = Symbol.for("durable-computer.platform")
type Holder = { [KEY]?: Platform }

function create(): Platform {
  const config = readConfig(process.env)
  const directory = resolve(process.env.DC_DATA_DIR ?? ".data")
  mkdirSync(directory, { recursive: true })
  const { database, app } = openNodeAppDatabase(join(directory, "app.sqlite"))
  const models = createAgentModels(config)
  const agents = new NodeActorNamespace({
    directory: join(directory, "agents"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models: models.models,
        defaultModel: models.defaultModel,
        modelOptions: models.options,
        onReport: (error) => console.error(`[agent ${host.name}]`, error),
      }),
    onError: (error, name) => console.error(`[agent ${name}] alarm failed`, error),
  })
  // Wake agents whose work was interrupted by the last shutdown.
  agents.start()
  return { target: "node", config, db: app, authDatabase: database, agents }
}

/** One platform per process. Kept on `globalThis` so a dev-server module reload reuses it. */
export function getPlatform(): Platform {
  const holder = globalThis as Holder
  return (holder[KEY] ??= create())
}
