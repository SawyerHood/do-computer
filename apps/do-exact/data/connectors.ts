import type { Result, Sources } from "../app.contract.d.ts"
import type {
  AgentSummary,
  ConnectorResult,
  ConnectorSummary,
  SlackState,
} from "../protocol/agent.ts"
import { avatarLook } from "../protocol/avatars.ts"
import { API, current, del, get, NOBODY, patch, post, put, reply, seg } from "./api.ts"
declare function authCallback(): string

const completed = new Map<string, Promise<{ ok: boolean; error: string }>>()

// Mutation replies contain status only, never credentials. The server alone keeps the secrets.
const slackReply = async (owner: string, agentId: string, work: () => Promise<void>) => ({
  owner,
  agentId,
  authorizationUrl: "",
  ...(await reply(work)),
})
export const connectorsSources: Pick<
  Sources,
  | "loadConnectors"
  | "changeConnector"
  | "addConnector"
  | "loadSlack"
  | "saveSlack"
  | "connectorReturnAddress"
> = {
  connectorReturnAddress: ([agentId]) => ({
    url:
      typeof authCallback === "function" && agentId
        ? new URL(`/a/${seg(agentId)}/connectors`, authCallback()).toString()
        : "",
  }),
  loadConnectors: async ([owner, agentId, address], store): Promise<Result<"loadConnectors">> => {
    if (!agentId || !current(owner, store))
      return { owner: NOBODY, agentId: "", items: [], notice: "" }
    const query = new URL(address, API).searchParams
    let notice = query.get("connector_error") ?? ""
    if (query.has("state") && (query.has("code") || query.has("error"))) {
      const key = `${owner}:${query.get("state")}`
      if (!completed.has(key))
        completed.set(
          key,
          get<{ ok: boolean; error: string }>(
            store,
            `/api/connectors/callback?${query}&dc_client=1`,
          ).catch((e) => {
            completed.delete(key)
            throw e
          }),
        )
      const finish = await completed.get(key)!
      notice = finish.ok ? "The service is connected." : finish.error
    }
    const { connectors } = await get<{ connectors: ConnectorSummary[] }>(
      store,
      `/api/agents/${seg(agentId)}/connectors`,
    )
    return {
      owner,
      agentId,
      notice,
      items: connectors.map((c) => ({
        id: c.id,
        name: c.name,
        // The endpoint can contain a query credential; only its public origin leaves this source.
        url: new URL(c.url).origin,
        host: new URL(c.url).host,
        enabled: c.enabled,
        apps: c.kind === "apps",
        status: c.status,
        error: c.error ?? "",
        tools: c.tools.map((t) => ({ name: t.name, description: t.description })),
      })),
    }
  },
  addConnector: async (
    [owner, agentId, apps, name, url, token, clientId, clientSecret, callback],
    store,
  ): Promise<Result<"addConnector">> => {
    let authorizationUrl = ""
    const result = await reply(async () => {
      if (!current(owner, store)) throw new Error("Signed out")
      const { body } = await post<ConnectorResult>(
        store,
        `/api/agents/${seg(agentId)}/connectors?client_return=${seg(callback)}`,
        apps
          ? { apps: true }
          : {
              name,
              url,
              ...(token ? { token } : {}),
              ...(clientId ? { clientId } : {}),
              ...(clientSecret ? { clientSecret } : {}),
            },
      )
      authorizationUrl = body.authorizationUrl ?? ""
    })
    return { ...result, owner, agentId, authorizationUrl }
  },
  changeConnector: async (
    [owner, agentId, id, operation, enabled, callback],
    store,
  ): Promise<Result<"changeConnector">> => {
    let authorizationUrl = ""
    const result = await reply(async () => {
      if (!current(owner, store)) throw new Error("Signed out")
      const path = `/api/agents/${seg(agentId)}/connectors/${seg(id)}`
      if (operation === "remove") await del(store, path)
      else if (operation === "toggle") await patch(store, path, { enabled })
      else if (operation === "connect")
        authorizationUrl =
          (await post<ConnectorResult>(store, `${path}/connect?client_return=${seg(callback)}`))
            .body.authorizationUrl ?? ""
      else throw new Error("Unknown connector change")
    })
    return { ...result, owner, agentId, authorizationUrl }
  },
  loadSlack: async ([owner, agentId], store): Promise<Result<"loadSlack">> => {
    if (!agentId || !current(owner, store))
      return {
        owner: NOBODY,
        agentId: "",
        createUrl: "",
        eventsUrl: "",
        connected: false,
        team: "",
        teamUrl: "",
        bot: "",
        seed: "",
        color: "",
        outfit: "{}",
        name: "",
      }
    const [s, { agent }] = await Promise.all([
      get<SlackState>(store, `/api/agents/${seg(agentId)}/slack`),
      get<{ agent: AgentSummary }>(store, `/api/agents/${seg(agentId)}`),
    ])
    const look = avatarLook(agent.avatar, agentId)
    return {
      owner,
      agentId,
      seed: look.seed,
      color: look.color,
      outfit: JSON.stringify(agent.outfit ?? {}),
      name: agent.name ?? "your Dood",
      createUrl: s.createUrl,
      eventsUrl: s.eventsUrl,
      connected: s.app !== null,
      team: s.app?.team ?? "",
      teamUrl: s.app?.teamUrl ?? "",
      bot: s.app?.bot ?? "",
    }
  },
  saveSlack: async ([owner, agentId, remove, botToken, signingSecret], store) =>
    slackReply(owner, agentId, async () => {
      if (!current(owner, store)) throw new Error("Signed out")
      const path = `/api/agents/${seg(agentId)}/slack`
      if (remove) await del(store, path)
      else await put(store, path, { botToken, signingSecret })
    }),
}
