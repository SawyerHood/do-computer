import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createAgentActor, createAgentModels } from "@durable-computer/agent"
import { createComputerLinkActor } from "@durable-computer/computers"
import { PING_FRAME, PONG_FRAME } from "@durable-computer/protocol"
import {
  fileBlobs,
  NodeActorNamespace,
  openNodeAppDatabase,
  type SocketLike,
} from "@durable-computer/runtime/node"
import { type Platform, readConfig } from "./platform.ts"
import { notifyOwner } from "./push.ts"
import { nodeProviders } from "./sandbox.node.ts"
import { sandboxFactory } from "./sandbox.ts"

const KEY = Symbol.for("durable-computer.platform")

/** The Node platform also accepts daemon sockets, which only a long-lived process can hold. */
export type NodePlatform = Platform & {
  connectComputer(name: string, socket: SocketLike, request: Request): Promise<void>
}
type Holder = { [KEY]?: NodePlatform }

/** A self-hosted install should start without setup: mint the session secret once and keep it. */
function authSecret(directory: string): string {
  const file = join(directory, "auth-secret")
  if (existsSync(file)) return readFileSync(file, "utf8").trim()
  const secret = randomBytes(32).toString("base64url")
  writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

function create(): NodePlatform {
  const directory = resolve(process.env.DC_DATA_DIR ?? ".data")
  mkdirSync(directory, { recursive: true })
  const fromEnv = readConfig(process.env)
  const config = { ...fromEnv, authSecret: fromEnv.authSecret ?? authSecret(directory) }
  const { database, app } = openNodeAppDatabase(join(directory, "app.sqlite"))
  const models = createAgentModels(config)
  // Checked once, here, so a wrong setting stops the server instead of failing each agent.
  const sandbox = sandboxFactory(config, "Node", nodeProviders)
  const computers = new NodeActorNamespace({
    directory: join(directory, "computers"),
    blobs: () => fileBlobs(join(directory, "blobs", "computers")),
    factory: (host) => createComputerLinkActor(host),
    socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
    onError: (error, name) => console.error(`[${name}]`, error),
  })
  const agents = new NodeActorNamespace({
    directory: join(directory, "agents"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models: models.models,
        defaultModel: models.defaultModel,
        modelOptions: models.options,
        sandbox,
        webSearch: models.webSearch,
        allowPrivateHosts: config.allowPrivateHosts,
        resolveHost: nodeProviders.resolveHost,
        computerLinks: computers,
        onNotify: (notification) =>
          void notifyOwner(app, notification.agentId, notification.agentName, notification),
        onReport: (error) => console.error(`[agent ${host.name}]`, error),
      }),
    onError: (error, name) => console.error(`[agent ${name}] alarm failed`, error),
  })
  // Wake agents whose work was interrupted by the last shutdown.
  agents.start()
  return {
    target: "node",
    config,
    db: app,
    authDatabase: database,
    agents,
    computers,
    connectComputer: (name, socket, request) => computers.connect(name, socket, request),
  }
}

/** One platform per process. Kept on `globalThis` so a dev-server module reload reuses it. */
export function getPlatform(): NodePlatform {
  const holder = globalThis as Holder
  return (holder[KEY] ??= create())
}
