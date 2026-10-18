import {
  type AgentActivity,
  type FeedEvent,
  isPersonalWorkspace,
  type Presence,
  personalWorkspaceId,
} from "@do-computer/protocol"
import type { ActorNamespace, AppDatabase } from "@do-computer/runtime"
import { peopleOfAgent } from "./teams.ts"

/**
 * Tell a person's open tabs something about their agents. Each person has a feed of their own:
 * the actor at the presence address of their personal workspace, which their tabs hold a socket
 * to. A courtesy, so it never fails what caused it; a tab that misses it asks for the list of
 * agents the next time it connects.
 */
export function tellPerson(
  presence: ActorNamespace,
  userId: string,
  event: FeedEvent,
): Promise<void> {
  return presence
    .get(personalWorkspaceId(userId))
    .fetch(
      new Request("http://feed/tell", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      }),
    )
    .then(
      () => undefined,
      () => undefined,
    )
}

/**
 * Whether someone is writing a message in one of an agent's chats right now. Only a team's
 * presence says who is typing; in a personal workspace nobody is known to be. Never fails: what
 * cannot be asked is taken as nobody typing.
 */
export async function typingIn(
  db: AppDatabase,
  presence: ActorNamespace,
  agentId: string,
  chatId: string,
): Promise<boolean> {
  try {
    const row = await db.get<{ workspace_id: string | null }>(
      "SELECT workspace_id FROM dc_agents WHERE id = ?",
      agentId,
    )
    const workspaceId = row?.workspace_id ?? null
    if (workspaceId === null || isPersonalWorkspace(workspaceId)) return false
    const response = await presence.get(workspaceId).fetch(new Request("http://presence/"))
    if (!response.ok) return false
    const { here } = (await response.json()) as { here?: Presence[] }
    return (here ?? []).some(
      (someone) => someone.agentId === agentId && someone.chatId === chatId && someone.typing,
    )
  } catch {
    return false
  }
}

/**
 * Tell everyone an agent works for what it is up to now: its owner, or everyone in its team. It
 * runs where the agent does, which is not always where requests are served, so it is handed the
 * database and the feeds instead of finding the platform.
 */
export async function tellPeopleOfAgent(
  db: AppDatabase,
  presence: ActorNamespace,
  change: { agentId: string } & AgentActivity,
): Promise<void> {
  const people = await peopleOfAgent(db, change.agentId).catch((): string[] => [])
  const { agentId, ...activity } = change
  await Promise.all(
    people.map((userId) => tellPerson(presence, userId, { type: "agent", agentId, ...activity })),
  )
}
