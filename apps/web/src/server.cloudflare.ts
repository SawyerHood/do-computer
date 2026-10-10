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
  createDurableActorClass,
  d1Database,
  durableObjectNamespace,
  r2Blobs,
} from "@durable-computer/runtime/cloudflare"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { agentDirectory } from "./server/agent-directory.ts"
import { createAgentBeside } from "./server/agents.ts"
import { browserDirectory } from "./server/browser-directory.ts"
import { computerDirectory } from "./server/computer-directory.ts"
import { servedDaemon } from "./server/daemon-version.ts"
import { libraryDirectory } from "./server/library-directory.ts"
import { modelAccessDirectory } from "./server/model-access-directory.ts"
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
import { createPresenceActor } from "./server/presence-actor.ts"
import { readConfig } from "./server/platform.ts"
import { notifyPeople } from "./server/push.ts"
import { cloudflareProviders } from "./server/sandbox.cloudflare.ts"
import { slackDirectory } from "./server/slack.ts"
import { computerChoices } from "./server/sandbox.ts"

export { SandboxObject } from "./server/sandbox.cloudflare.ts"

/** One Durable Object per agent. */
export const AgentObject = createDurableActorClass<Env>({
  create: (host, env) => {
    const config = readConfig(env)
    // What the agent's workspace is signed in to, which its models are then called with.
    const signIns = modelAccessDirectory(
      d1Database(env.DB),
      durableObjectNamespace(env.MODEL_ACCESS),
    )
    const access = () => signIns(host.name)
    const models = createAgentModels(config, workspaceCredentials(access))
    return createAgentActor(host, {
      models: models.models,
      defaultModel: models.defaultModel,
      modelOptions: models.options,
      workspaceModels: () => workspaceModelOptions(access),
      computers: computerChoices(config, "cloudflare", cloudflareProviders(env)),
      webSearch: models.webSearch,
      judge: models.judge,
      review: models.review,
      allowPrivateHosts: config.allowPrivateHosts,
      computerLinks: durableObjectNamespace(env.COMPUTER),
      computerDirectory: computerDirectory(
        d1Database(env.DB),
        durableObjectNamespace(env.COMPUTER),
        undefined,
        { kinds: addableKinds, add: addMachineFor, remove: removeMachineFor },
      ),
      library: libraryDirectory(d1Database(env.DB), durableObjectNamespace(env.LIBRARY)),
      showsBrowser: browserDirectory(d1Database(env.DB)),
      agentDirectory: agentDirectory(
        d1Database(env.DB),
        () => durableObjectNamespace(env.AGENT),
        createAgentBeside,
      ),
      appUrl: config.baseUrl,
      slackDirectory: slackDirectory(d1Database(env.DB), { apiUrl: config.slackApiUrl }),
      onNotify: (notification) =>
        void notifyPeople(
          d1Database(env.DB),
          notification.agentId,
          notification.agentName,
          notification,
        ),
      onReport: (error) => console.error(`[agent ${host.name}]`, error),
    })
  },
  blobs: (env, name) => r2Blobs(env.BLOBS, `agents/${encodeURIComponent(name)}/`),
})

/** One Durable Object per paired computer. Its daemon's socket hibernates with it. */
export const ComputerObject = createDurableActorClass<Env>({
  create: (host) => createComputerLinkActor(host, { daemonVersion: servedDaemon }),
  blobs: (env, name) => r2Blobs(env.BLOBS, `computers/${encodeURIComponent(name)}/`),
  socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
})

/** One Durable Object per workspace, keeping the library its agents share. */
export const LibraryObject = createDurableActorClass<Env>({
  create: (host) => createLibraryActor(host),
  blobs: (env, name) => r2Blobs(env.BLOBS, `libraries/${encodeURIComponent(name)}/`),
})

/** One Durable Object per workspace, keeping the model providers it is signed in to. */
export const ModelAccessObject = createDurableActorClass<Env>({
  create: (host) => createModelAccessActor(host),
  blobs: (env, name) => r2Blobs(env.BLOBS, `model-access/${encodeURIComponent(name)}/`),
})

/** One Durable Object per team. Its members' sockets hibernate with it. */
export const PresenceObject = createDurableActorClass<Env>({
  create: (host) => createPresenceActor(host),
  blobs: (env, name) => r2Blobs(env.BLOBS, `presence/${encodeURIComponent(name)}/`),
  socketAutoResponse: { request: PING_FRAME, response: PONG_FRAME },
})

export default createServerEntry({
  fetch: async (request) => {
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
    return handler.fetch(request)
  },
})
