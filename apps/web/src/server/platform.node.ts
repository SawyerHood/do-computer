import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  createAgentActor,
  createAgentModels,
  DEPLOYMENT_MODEL_ACCESS,
  createLibraryActor,
  createModelAccessActor,
  workspaceCredentials,
  workspaceModelOptions,
} from "@do-computer/agent"
import { createComputerLinkActor } from "@do-computer/computers"
import { PING_FRAME, PONG_FRAME } from "@do-computer/protocol"
import {
  chromePreviewer,
  fileBlobs,
  findChrome,
  NodeActorNamespace,
  openNodeAppDatabase,
  type SocketLike,
} from "@do-computer/runtime/node"
import { agentDirectory } from "./agent-directory.ts"
import { createAgentBeside } from "./agents.ts"
import { addableKinds, addMachineFor, removeMachineFor } from "./computers.ts"
import { slackDirectory } from "./slack.ts"
import { browserDirectory } from "./browser-directory.ts"
import { computerDirectory } from "./computer-directory.ts"
import { servedDaemon } from "./daemon-version.ts"
import { libraryDirectory } from "./library-directory.ts"
import { siteDirectory } from "./site-directory.ts"
import { modelAccessDirectory } from "./model-access-directory.ts"
import { callDirectory } from "./calls-directory.ts"
import { everyoneIsAdmin, savedDirectory } from "./passwords-directory.ts"
import { type Platform, readConfig } from "./platform.ts"
import { notifyPeople } from "./push.ts"
import { tellPeopleOfAgent, typingIn } from "./feed.ts"
import { createLiveActor } from "./presence-actor.ts"
import { nodeProviders } from "./sandbox.node.ts"
import { computerChoices, unsharedKinds } from "./sandbox.ts"

const KEY = Symbol.for("do-computer.platform")

/** The Node platform also accepts sockets, which only a long-lived process can hold. */
export type NodePlatform = Platform & {
  connectComputer(name: string, socket: SocketLike, request: Request): Promise<void>
  connectPresence(name: string, socket: SocketLike, request: Request): Promise<void>
  /** Someone following an agent, and someone following a workspace's library. */
  connectAgent(name: string, socket: SocketLike, request: Request): Promise<void>
  connectLibrary(name: string, socket: SocketLike, request: Request): Promise<void>
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
  const minted = fromEnv.authSecret ?? authSecret(directory)
  // Saved logins are sealed with the secret that signs sessions unless they have a key of their own.
  const config = { ...fromEnv, authSecret: minted, secretsKey: fromEnv.secretsKey ?? minted }
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
    socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
    onError: (error, name) => console.error(`[library ${name}]`, error),
  })
  const modelAccess = new NodeActorNamespace({
    directory: join(directory, "model-access"),
    blobs: () => fileBlobs(join(directory, "blobs", "model-access")),
    factory: (host) =>
      createModelAccessActor(host, {
        vaultKey: config.secretsKey,
        extraModels: config.extraModels,
        showsExtraModels: () => everyoneIsAdmin(app, config, host.name),
      }),
    onError: (error, name) => console.error(`[model access ${name}]`, error),
  })
  const signIns = modelAccessDirectory(app, modelAccess)
  // A Chrome on this machine draws a page for an agent to look at before it shows it. Where
  // there is none, agents draw without looking.
  const chrome = config.chromePath === "none" ? undefined : findChrome(config.chromePath)
  const previewer = chrome === undefined ? undefined : chromePreviewer(chrome)
  const agents: NodeActorNamespace = new NodeActorNamespace({
    directory: join(directory, "agents"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) => {
      // What the agent's workspace is signed in to, which its models are then called with.
      const access = () => signIns(host.name)
      const models = createAgentModels(config, {
        workspace: workspaceCredentials(access),
        deployment: async () => modelAccess.get(DEPLOYMENT_MODEL_ACCESS),
      })
      return createAgentActor(host, {
        models: models.models,
        defaultModel: models.defaultModel,
        modelOptions: models.options,
        deploymentModels: models.offered,
        workspaceModels: () => workspaceModelOptions(access),
        computers,
        webSearch: models.webSearch,
        judge: models.judge,
        review: models.review,
        allowPrivateHosts: config.allowPrivateHosts,
        boxEveryMs: config.boxEveryMs,
        ...(config.requestTries === undefined ? {} : { requestTries: config.requestTries }),
        ...(previewer === undefined ? {} : { pagePreviewer: previewer }),
        resolveHost: nodeProviders.resolveHost,
        computerLinks: links,
        computerDirectory: computerDirectory(
          app,
          links,
          undefined,
          {
            kinds: addableKinds,
            add: addMachineFor,
            remove: removeMachineFor,
          },
          unsharedKinds("node"),
        ),
        library: libraryDirectory(app, libraries),
        sites: siteDirectory(app),
        showsBrowser: browserDirectory(app),
        savedLogins: savedDirectory(app, modelAccess, config, "passwords"),
        savedCards: savedDirectory(app, modelAccess, config, "cards"),
        calls: callDirectory(app, modelAccess, config),
        // The agents reach each other through the namespace they are all in.
        agentDirectory: agentDirectory(app, () => agents, createAgentBeside),
        appUrl: config.baseUrl,
        slackDirectory: slackDirectory(app, { apiUrl: config.slackApiUrl }),
        appsUrl: config.appsUrl,
        onNotify: (notification) =>
          void notifyPeople(app, notification.agentId, notification.agentName, notification),
        onActivity: (change) => void tellPeopleOfAgent(app, presence, change),
        typing: (agentId, chatId) => typingIn(app, presence, agentId, chatId),
        onReport: (error) => console.error(`[agent ${host.name}]`, error),
      })
    },
    socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
    onError: (error, name) => console.error(`[agent ${name}] alarm failed`, error),
  })
  const presence = new NodeActorNamespace({
    directory: join(directory, "presence"),
    blobs: () => fileBlobs(join(directory, "blobs", "presence")),
    factory: (host) => createLiveActor(host),
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
    connectAgent: (name, socket, request) => agents.connect(name, socket, request),
    connectLibrary: (name, socket, request) => libraries.connect(name, socket, request),
  }
}

/** One platform per process. Kept on `globalThis` so a dev-server module reload reuses it. */
export function getPlatform(): NodePlatform {
  const holder = globalThis as Holder
  return (holder[KEY] ??= create())
}
