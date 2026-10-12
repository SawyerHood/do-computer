import { type AgentActivity, type FeedEvent, personalWorkspaceId } from "@durable-computer/protocol"
import type { ActorNamespace, AppDatabase } from "@durable-computer/runtime"
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
