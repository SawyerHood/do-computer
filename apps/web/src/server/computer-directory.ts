import { computerActorName, type ComputerDirectory } from "@durable-computer/agent"
import { linkStatus } from "@durable-computer/computers"
import { isPersonalWorkspace } from "@durable-computer/protocol"
import type { ActorNamespace, AppDatabase } from "@durable-computer/runtime"
import {
  answerersOf,
  ask,
  askedBy,
  computerIdsOfAgent,
  type ComputerRow,
  computersNear,
  peopleById,
} from "./computer-access.ts"
import { sendPush } from "./push.ts"

/**
 * What an agent can find out about computers it is not connected to, and how it asks for one. It
 * runs where the agent does, which is not always where requests are served, so it is handed the
 * database and the links instead of finding the platform.
 */
export function computerDirectory(
  db: AppDatabase,
  links: ActorNamespace,
  fetcher?: typeof fetch,
): ComputerDirectory {
  /** Whose computers these are, in words an agent can repeat: a person's name, or a team's. */
  const owners = async (rows: readonly ComputerRow[]) => {
    const people = await peopleById(
      db,
      rows.map((row) => row.owner_id),
    )
    const teams = new Map<string, string>()
    for (const row of rows) {
      if (isPersonalWorkspace(row.workspace_id) || teams.has(row.workspace_id)) continue
      const team = await db.get<{ name: string }>(
        "SELECT name FROM dc_workspaces WHERE id = ?",
        row.workspace_id,
      )
      teams.set(row.workspace_id, team?.name ?? "the team")
    }
    return (row: ComputerRow) =>
      isPersonalWorkspace(row.workspace_id)
        ? { owner: people.get(row.owner_id)?.name ?? "someone", team: false }
        : { owner: teams.get(row.workspace_id)!, team: true }
  }
  return {
    async list(agentId) {
      const rows = await computersNear(db, agentId)
      const connected = new Set(await computerIdsOfAgent(db, agentId))
      const asked = new Set(await askedBy(db, agentId))
      const ownerOf = await owners(rows)
      return Promise.all(
        rows.map(async (row) => {
          const status = await linkStatus(links.get(computerActorName(row.id))).catch(
            () => undefined,
          )
          return {
            id: row.id,
            name: row.name,
            ...ownerOf(row),
            platform: row.platform,
            readOnly: status?.hello?.readOnly ?? row.read_only === 1,
            online: status?.online ?? false,
            connected: connected.has(row.id),
            asked: asked.has(row.id),
          }
        }),
      )
    },
    async request(agentId, input) {
      const row = (await computersNear(db, agentId)).find(
        (computer) => computer.id === input.computerId,
      )
      if (row === undefined) return undefined
      const { fresh } = await ask(db, {
        computerId: row.id,
        agentId,
        chatId: input.chatId,
        reason: input.reason,
      })
      if (fresh) {
        const reason = input.reason.trim()
        for (const userId of await answerersOf(db, row)) {
          await sendPush(
            db,
            userId,
            {
              title: input.agentName ?? "Your agent",
              body: `Asks to use the computer ${row.name}${reason === "" ? "" : `: ${reason}`}`,
              data: { agentId, chatId: input.chatId },
            },
            fetcher,
          )
        }
      }
      const { owner, team } = (await owners([row]))(row)
      return { asked: team ? `anyone in ${owner}` : owner, fresh }
    },
  }
}
