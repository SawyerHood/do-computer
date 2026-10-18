import { type AddableKind, computerActorName, type ComputerDirectory } from "@do-computer/agent"
import { linkStatus } from "@do-computer/computers"
import { isPersonalWorkspace } from "@do-computer/protocol"
import type { ActorNamespace, AppDatabase } from "@do-computer/runtime"
import { adoptMachines } from "./computer-adoption.ts"
import {
  answerersOf,
  ask,
  askedBy,
  computerIdsOfAgent,
  type ComputerRow,
  computersNear,
  folderFor,
  foldersOn,
  isMachine,
  machinesOf,
  mayUse,
  peopleById,
} from "./computer-access.ts"
import { sendPush } from "./push.ts"
import { unsharedKinds } from "./sandbox.ts"

/**
 * What an agent can find out about computers it is not connected to, and how it asks for one. It
 * runs where the agent does, which is not always where requests are served, so it is handed the
 * database and the links instead of finding the platform.
 */
export function computerDirectory(
  db: AppDatabase,
  links: ActorNamespace,
  fetcher?: typeof fetch,
  /**
   * How an agent adds a machine to its workspace and removes one it added. These need the
   * providers the machines are made at, which whoever starts the agents has. Without them, an
   * agent can do neither.
   */
  machines?: {
    kinds(): AddableKind[]
    add: NonNullable<ComputerDirectory["add"]>
    remove: NonNullable<ComputerDirectory["remove"]>
  },
  /** The kinds whose machine is one agent's alone, where the agents run. */
  unshared: readonly string[] = unsharedKinds("node"),
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
    allowed: (agentId, computerId) => mayUse(db, agentId, computerId),
    async list(agentId) {
      const rows = await computersNear(db, agentId)
      const connected = new Set(await computerIdsOfAgent(db, agentId))
      const asked = new Set(await askedBy(db, agentId))
      const ownerOf = await owners(rows)
      return Promise.all(
        rows.map(async (row) => {
          // A machine has no daemon to be away: it starts when something runs on it.
          const status = isMachine(row)
            ? { online: true, hello: null }
            : await linkStatus(links.get(computerActorName(row.id))).catch(() => undefined)
          return {
            id: row.id,
            name: row.name,
            ...ownerOf(row),
            platform: row.platform,
            kind: row.kind,
            readOnly: status?.hello?.readOnly ?? row.read_only === 1,
            online: status?.online ?? false,
            connected: connected.has(row.id),
            ...(connected.has(row.id) && status?.hello?.screenAdapter
              ? { screenAdapter: status.hello.screenAdapter }
              : {}),
            ...(connected.has(row.id) && status?.hello?.browserAdapter
              ? { browserAdapter: status.hello.browserAdapter }
              : {}),
            asked: asked.has(row.id),
            ...(row.added_by_agent === agentId ? { mine: true } : {}),
          }
        }),
      )
    },
    machines: (agentId) => machinesOf(db, agentId),
    async folder(agentId, computerId, agentName) {
      const row = await db.get<ComputerRow>("SELECT * FROM dc_computers WHERE id = ?", computerId)
      if (row === undefined || !isMachine(row) || !(await mayUse(db, agentId, computerId))) {
        return undefined
      }
      // A kind that is one agent's has no other folders to keep apart from: its home is the folder.
      if (unshared.includes(row.kind)) return undefined
      const folder = await folderFor(db, row, agentId, agentName)
      const there = (await foldersOn(db, [computerId])).get(computerId) ?? []
      return {
        folder,
        neighbors: there.filter((one) => one.agentId !== agentId).map((one) => one.path),
      }
    },
    adopt: (agentId, machines, agentName) =>
      adoptMachines(db, agentId, machines, agentName, undefined, unshared),
    ...(machines === undefined
      ? {}
      : {
          kinds: async () => machines.kinds(),
          add: (agentId, input) => machines.add(agentId, input),
          remove: (agentId, computerId) => machines.remove(agentId, computerId),
        }),
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
              title: input.agentName ?? "Your Dood",
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
