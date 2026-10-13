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
  browserRunPreviewer,
  createDurableActorClass,
  d1Database,
  durableObjectNamespace,
  r2Blobs,
} from "@do-computer/runtime/cloudflare"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { env } from "cloudflare:workers"
import { agentDirectory } from "./server/agent-directory.ts"
import { admitToAgent, agentSocket } from "./server/agent-socket.ts"
import { createAgentBeside } from "./server/agents.ts"
import { browserDirectory } from "./server/browser-directory.ts"
import { computerDirectory } from "./server/computer-directory.ts"
import { servedDaemon } from "./server/daemon-version.ts"
import { libraryDirectory } from "./server/library-directory.ts"
import { siteDirectory } from "./server/site-directory.ts"
import { modelAccessDirectory } from "./server/model-access-directory.ts"
import { savedLoginsDirectory } from "./server/passwords-directory.ts"
import {
  addableKinds,
  addMachineFor,
  authenticateDaemon,
  computerActorName,
  CONNECT_PATH,
  removeMachineFor,
} from "./server/computers.ts"
import { type Env, getPlatform } from "./server/platform.cloudflare.ts"
import { admitToPresence, presenceWorkspace } from "./server/presence.ts"
import { tellPeopleOfAgent } from "./server/feed.ts"
import { createLiveActor } from "./server/presence-actor.ts"
import { readConfig } from "./server/platform.ts"
import { notifyPeople } from "./server/push.ts"
import { overLimit } from "./server/rate-limit.ts"
import { cloudflareProviders } from "./server/sandbox.cloudflare.ts"
import { slackDirectory } from "./server/slack.ts"
import { computerChoices, unsharedKinds } from "./server/sandbox.ts"

export { SandboxObject, ShellGateway, ShellObject } from "./server/sandbox.cloudflare.ts"
// How a built-in shell's Worker finds its way back to the object that keeps its files.
export { WorkspaceServiceProxy } from "@do-computer/sandbox/worker-shell/object"

/** One Durable Object per agent. The sockets of those following it hibernate with it. */
export const AgentObject = createDurableActorClass<Env>({
  create: (host, env) => {
    const config = readConfig(env)
    // What the agent's workspace is signed in to, which its models are then called with.
    const signIns = modelAccessDirectory(
      d1Database(env.DB),
      durableObjectNamespace(env.MODEL_ACCESS),
    )
    const access = () => signIns(host.name)
    const models = createAgentModels(config, {
      workspace: workspaceCredentials(access),
      deployment: async () => durableObjectNamespace(env.MODEL_ACCESS).get(DEPLOYMENT_MODEL_ACCESS),
    })
    return createAgentActor(host, {
      models: models.models,
      defaultModel: models.defaultModel,
      modelOptions: models.options,
      deploymentModels: models.offered,
      workspaceModels: () => workspaceModelOptions(access),
      computers: computerChoices(config, "cloudflare", cloudflareProviders(env)),
      webSearch: models.webSearch,
      judge: models.judge,
      review: models.review,
      allowPrivateHosts: config.allowPrivateHosts,
      boxEveryMs: config.boxEveryMs,
      ...(env.BROWSER === undefined ? {} : { pagePreviewer: browserRunPreviewer(env.BROWSER) }),
      // Nothing is kept in memory for a chat that has gone quiet, nor a document that nothing
      // is watching: what keeps each is a timer, and a pending timer keeps the whole object
      // from being put away.
      contextRetentionMs: 0,
      documentRetentionMs: 0,
      computerLinks: durableObjectNamespace(env.COMPUTER),
      computerDirectory: computerDirectory(
        d1Database(env.DB),
        durableObjectNamespace(env.COMPUTER),
        undefined,
        { kinds: addableKinds, add: addMachineFor, remove: removeMachineFor },
        unsharedKinds("cloudflare"),
      ),
      library: libraryDirectory(d1Database(env.DB), durableObjectNamespace(env.LIBRARY)),
      sites: siteDirectory(d1Database(env.DB)),
      showsBrowser: browserDirectory(d1Database(env.DB)),
      savedLogins: savedLoginsDirectory(
        d1Database(env.DB),
        durableObjectNamespace(env.MODEL_ACCESS),
        config,
      ),
      agentDirectory: agentDirectory(
        d1Database(env.DB),
        () => durableObjectNamespace(env.AGENT),
        createAgentBeside,
      ),
      appUrl: config.baseUrl,
      slackDirectory: slackDirectory(d1Database(env.DB), { apiUrl: config.slackApiUrl }),
      appsUrl: config.appsUrl,
      onNotify: (notification) =>
        void notifyPeople(
          d1Database(env.DB),
          notification.agentId,
          notification.agentName,
          notification,
        ),
      onActivity: (change) =>
        void tellPeopleOfAgent(d1Database(env.DB), durableObjectNamespace(env.PRESENCE), change),
      onReport: (error) => console.error(`[agent ${host.name}]`, error),
    })
  },
  blobs: (env, name) => r2Blobs(env.BLOBS, `agents/${encodeURIComponent(name)}/`),
  socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
})

/** One Durable Object per paired computer. Its daemon's socket hibernates with it. */
export const ComputerObject = createDurableActorClass<Env>({
  create: (host) => createComputerLinkActor(host, { daemonVersion: servedDaemon }),
  blobs: (env, name) => r2Blobs(env.BLOBS, `computers/${encodeURIComponent(name)}/`),
  socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
})

/**
 * One Durable Object per workspace, keeping the library its agents share. The sockets of those
 * following it hibernate with it.
 */
export const LibraryObject = createDurableActorClass<Env>({
  create: (host) => createLibraryActor(host),
  blobs: (env, name) => r2Blobs(env.BLOBS, `libraries/${encodeURIComponent(name)}/`),
  socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
})

/** One Durable Object per workspace, keeping the model providers it is signed in to. */
export const ModelAccessObject = createDurableActorClass<Env>({
  create: (host, env) => createModelAccessActor(host, { vaultKey: readConfig(env).secretsKey }),
  blobs: (env, name) => r2Blobs(env.BLOBS, `model-access/${encodeURIComponent(name)}/`),
})

/**
 * One Durable Object per team, and one per person for their own feed. The sockets of whoever is
 * connected hibernate with it.
 */
export const PresenceObject = createDurableActorClass<Env>({
  create: (host) => createLiveActor(host),
  blobs: (env, name) => r2Blobs(env.BLOBS, `presence/${encodeURIComponent(name)}/`),
  socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
})

export default createServerEntry({
  fetch: async (request) => {
    // Before anything is done for it: what anyone can call is only called so often.
    const refused = await overLimit(request, (env as unknown as Env).PUBLIC_LIMIT)
    if (refused !== undefined) return refused
    // A daemon's WebSocket goes straight to its computer's object; a framework in between
    // would not pass the upgrade through.
    if (new URL(request.url).pathname === CONNECT_PATH) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket", { status: 426 })
      }
      const computerId = await authenticateDaemon(request)
      if (computerId === undefined) return new Response("Unauthorized", { status: 401 })
      return getPlatform().computers.get(computerActorName(computerId)).fetch(request)
    }
    // A member's presence socket goes straight to its team's object, for the same reason.
    const workspaceId = presenceWorkspace(new URL(request.url).pathname)
    if (workspaceId !== undefined) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket", { status: 426 })
      }
      const admitted = await admitToPresence(request, workspaceId)
      if (admitted === undefined) return new Response("Unauthorized", { status: 401 })
      return getPlatform().presence.get(workspaceId).fetch(admitted)
    }
    // And so does the socket an agent, or its workspace's library, is followed over.
    const followed = agentSocket(new URL(request.url).pathname)
    if (followed !== undefined) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket", { status: 426 })
      }
      const admitted = await admitToAgent(request, followed.agentId)
      if (admitted === undefined) return new Response("Unauthorized", { status: 401 })
      const { agents, libraries } = getPlatform()
      return followed.library
        ? libraries.get(admitted.workspaceId).fetch(admitted.request)
        : agents.get(followed.agentId).fetch(admitted.request)
    }
    return handler.fetch(request)
  },
})
