import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  createAgentActor,
  createAgentModels,
  createLibraryActor,
  createModelAccessActor,
  workspaceCredentials,
  workspaceModelOptions,
} from "@durable-computer/agent"
import { createComputerLinkActor } from "@durable-computer/computers"
import { PING_FRAME, PONG_FRAME } from "@durable-computer/protocol"
import {
  fileBlobs,
  NodeActorNamespace,
  openNodeAppDatabase,
  type SocketLike,
} from "@durable-computer/runtime/node"
import { agentDirectory } from "./agent-directory.ts"
import { createAgentBeside } from "./agents.ts"
import { addableKinds, addMachineFor, removeMachineFor } from "./computers.ts"
import { slackDirectory } from "./slack.ts"
import { computerDirectory } from "./computer-directory.ts"
import { servedDaemon } from "./daemon-version.ts"
import { libraryDirectory } from "./library-directory.ts"
import { modelAccessDirectory } from "./model-access-directory.ts"
import { type Platform, readConfig } from "./platform.ts"
import { notifyPeople } from "./push.ts"
import { createPresenceActor } from "./presence-actor.ts"
import { nodeProviders } from "./sandbox.node.ts"
import { computerChoices } from "./sandbox.ts"

const KEY = Symbol.for("durable-computer.platform")

/** The Node platform also accepts sockets, which only a long-lived process can hold. */
export type NodePlatform = Platform & {
  connectComputer(name: string, socket: SocketLike, request: Request): Promise<void>
  connectPresence(name: string, socket: SocketLike, request: Request): Promise<void>
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
  // Checked once, here, so a wrong setting stops the server instead of failing each agent.
  const computers = computerChoices(config, "node", nodeProviders)
  const links = new NodeActorNamespace({
    directory: join(directory, "computers"),
    blobs: () => fileBlobs(join(directory, "blobs", "computers")),
    factory: (host) => createComputerLinkActor(host, { daemonVersion: servedDaemon }),
    socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
    onError: (error, name) => console.error(`[${name}]`, error),
  })
  const libraries = new NodeActorNamespace({
    directory: join(directory, "libraries"),
    blobs: (name) => fileBlobs(join(directory, "blobs", "libraries", encodeURIComponent(name))),
    factory: (host) => createLibraryActor(host),
    onError: (error, name) => console.error(`[library ${name}]`, error),
  })
  const modelAccess = new NodeActorNamespace({
    directory: join(directory, "model-access"),
    blobs: () => fileBlobs(join(directory, "blobs", "model-access")),
    factory: (host) => createModelAccessActor(host),
    onError: (error, name) => console.error(`[model access ${name}]`, error),
  })
  const signIns = modelAccessDirectory(app, modelAccess)
  const agents: NodeActorNamespace = new NodeActorNamespace({
    directory: join(directory, "agents"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) => {
      // What the agent's workspace is signed in to, which its models are then called with.
      const access = () => signIns(host.name)
      const models = createAgentModels(config, workspaceCredentials(access))
      return createAgentActor(host, {
        models: models.models,
        defaultModel: models.defaultModel,
        modelOptions: models.options,
        workspaceModels: () => workspaceModelOptions(access),
        computers,
        webSearch: models.webSearch,
        judge: models.judge,
        allowPrivateHosts: config.allowPrivateHosts,
        resolveHost: nodeProviders.resolveHost,
        computerLinks: links,
        computerDirectory: computerDirectory(app, links, undefined, {
          kinds: addableKinds,
          add: addMachineFor,
          remove: removeMachineFor,
        }),
        library: libraryDirectory(app, libraries),
        // The agents reach each other through the namespace they are all in.
        agentDirectory: agentDirectory(app, () => agents, createAgentBeside),
        appUrl: config.baseUrl,
        slackDirectory: slackDirectory(app, { apiUrl: config.slackApiUrl }),
        onNotify: (notification) =>
          void notifyPeople(app, notification.agentId, notification.agentName, notification),
        onReport: (error) => console.error(`[agent ${host.name}]`, error),
      })
    },
    onError: (error, name) => console.error(`[agent ${name}] alarm failed`, error),
  })
  const presence = new NodeActorNamespace({
    directory: join(directory, "presence"),
    blobs: () => fileBlobs(join(directory, "blobs", "presence")),
    factory: (host) => createPresenceActor(host),
    socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
    onError: (error, name) => console.error(`[presence ${name}]`, error),
  })
  // Wake agents whose work was interrupted by the last shutdown.
  agents.start()
  return {
    target: "node",
    config,
    db: app,
    authDatabase: database,
    agents,
    computers: links,
    presence,
    libraries,
    modelAccess,
    machines: computers,
    connectComputer: (name, socket, request) => links.connect(name, socket, request),
    connectPresence: (name, socket, request) => presence.connect(name, socket, request),
  }
}

/** One platform per process. Kept on `globalThis` so a dev-server module reload reuses it. */
export function getPlatform(): NodePlatform {
  const holder = globalThis as Holder
  return (holder[KEY] ??= create())
}
