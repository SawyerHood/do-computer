import { createAgentActor, createAgentModels } from "@durable-computer/agent"
import { createComputerLinkActor } from "@durable-computer/computers"
import { PING_FRAME, PONG_FRAME } from "@durable-computer/protocol"
import {
  createDurableActorClass,
  d1Database,
  durableObjectNamespace,
  r2Blobs,
} from "@durable-computer/runtime/cloudflare"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { authenticateDaemon, computerActorName, CONNECT_PATH } from "./server/computers.ts"
import { type Env, getPlatform } from "./server/platform.cloudflare.ts"
import { readConfig } from "./server/platform.ts"
import { notifyOwner } from "./server/push.ts"
import { cloudflareProviders } from "./server/sandbox.cloudflare.ts"
import { computerChoices } from "./server/sandbox.ts"

export { SandboxObject } from "./server/sandbox.cloudflare.ts"

/** One Durable Object per agent. */
export const AgentObject = createDurableActorClass<Env>({
  create: (host, env) => {
    const config = readConfig(env)
    const models = createAgentModels(config)
    return createAgentActor(host, {
      models: models.models,
      defaultModel: models.defaultModel,
      modelOptions: models.options,
      computers: computerChoices(config, "cloudflare", cloudflareProviders(env)),
      webSearch: models.webSearch,
      summaries: models.summaries,
      judge: models.judge,
      allowPrivateHosts: config.allowPrivateHosts,
      computerLinks: durableObjectNamespace(env.COMPUTER),
      onNotify: (notification) =>
        void notifyOwner(
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
  create: (host) => createComputerLinkActor(host),
  blobs: (env, name) => r2Blobs(env.BLOBS, `computers/${encodeURIComponent(name)}/`),
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
    return handler.fetch(request)
  },
})
