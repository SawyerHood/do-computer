import { getPlatform } from "#platform"
import {
  type AgentSummary,
  type ConnectSlackRequest,
  SLACK_MCP_URL,
} from "@durable-computer/protocol"
import { agentFor, callAgent, fail, json } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { connectConnector } from "./connectors.ts"
import {
  connectSlack,
  disconnectSlack,
  slackClient,
  type SlackDeps,
  slackEvent,
  SlackRefusal,
  slackState,
} from "./slack.ts"

const origin = (request: Request) => getPlatform().config.baseUrl ?? new URL(request.url).origin
const deps = (): SlackDeps => ({ apiUrl: getPlatform().config.slackApiUrl })

async function nameOf(agentId: string): Promise<string | null> {
  const response = await callAgent(agentId, "/")
  if (!response.ok) return null
  return ((await response.json()) as { agent: AgentSummary }).agent.name
}

/** An agent's place in Slack, for anyone who may use the agent. */
export async function readSlack(
  user: SessionUser,
  request: Request,
  agentId: string,
): Promise<Response> {
  if ((await agentFor(user, agentId)) === undefined) return fail(404, "Agent not found")
  return json(await slackState(getPlatform().db, agentId, await nameOf(agentId), origin(request)))
}

/** Put an agent in Slack, with what was pasted from the Slack app's pages. */
export async function addToSlack(
  user: SessionUser,
  request: Request,
  agentId: string,
): Promise<Response> {
  if ((await agentFor(user, agentId)) === undefined) return fail(404, "Agent not found")
  const { db } = getPlatform()
  const input = (await request.json().catch(() => null)) as Partial<ConnectSlackRequest> | null
  try {
    await connectSlack(db, deps(), agentId, user.id, input)
  } catch (error) {
    if (error instanceof SlackRefusal) return fail(error.status, error.message)
    throw error
  }
  return json(await slackState(db, agentId, await nameOf(agentId), origin(request)))
}

export async function removeFromSlack(user: SessionUser, agentId: string): Promise<Response> {
  if ((await agentFor(user, agentId)) === undefined) return fail(404, "Agent not found")
  await disconnectSlack(getPlatform().db, agentId)
  return json({ ok: true })
}

/**
 * Add Slack as a connector: Slack's own MCP server, signed in to as the agent's Slack app. The
 * app's id and secret are added here, so that they never pass through a browser again.
 */
export async function addSlackConnector(
  user: SessionUser,
  request: Request,
  agentId: string,
): Promise<Response> {
  if ((await agentFor(user, agentId)) === undefined) return fail(404, "Agent not found")
  const client = await slackClient(getPlatform().db, agentId)
  if (client === undefined) {
    return fail(
      409,
      "That needs the Slack app's client ID and client secret. Remove the agent from Slack and add it again with both.",
    )
  }
  return connectConnector(user, request, agentId, undefined, {
    name: "Slack",
    url: SLACK_MCP_URL,
    ...client,
  })
}

/** What Slack sends when the agent is spoken to. There is no session: Slack's signature is the check. */
export async function receiveSlack(request: Request, agentId: string): Promise<Response> {
  const { db, agents } = getPlatform()
  return slackEvent(db, agents, request, agentId)
}
