import type { AgentComputer } from "@durable-computer/agent"
import { personalWorkspaceId } from "@durable-computer/protocol"
import type { AppDatabase } from "@durable-computer/runtime"
import { type ComputerRow, grant, machinesOf } from "./computer-access.ts"

/** A name people and agents can say: lowercase letters, digits and hyphens. */
const nameFrom = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)

/**
 * Take over the machines an agent had to itself, from the days when every agent had one. Each
 * becomes a computer of the agent's workspace, for that agent alone, named after it. The one it
 * was on stays connected to it, with its home directory as its folder, since its files are
 * there. One it had left behind is listed with nobody on it, where it can be seen and deleted.
 *
 * Doing it again changes nothing: a machine is known by its kind and the agent it is named
 * after. Resolves with every machine the agent can use afterwards.
 */
export async function adoptMachines(
  db: AppDatabase,
  agentId: string,
  machines: readonly { kind: string; home: string; current: boolean }[],
  agentName: string | null,
  now = Date.now(),
): Promise<(AgentComputer & { id: string })[]> {
  const agent = await db.get<{ owner_id: string; workspace_id: string | null }>(
    "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
    agentId,
  )
  if (agent === undefined) return []
  const workspaceId = agent.workspace_id ?? personalWorkspaceId(agent.owner_id)
  const called = nameFrom(agentName ?? "") || "agent"
  for (const machine of machines) {
    let row = await db.get<ComputerRow>(
      "SELECT * FROM dc_computers WHERE kind = ? AND machine_key = ?",
      machine.kind,
      agentId,
    )
    if (row === undefined) {
      const id = crypto.randomUUID()
      await db.run(
        `INSERT INTO dc_computers
           (id, owner_id, workspace_id, name, platform, hostname, home, read_only, token_hash,
            created_at, kind, machine_key, access)
         VALUES (?, ?, ?, ?, 'linux', '', ?, 0, NULL, ?, ?, ?, 'chosen')`,
        id,
        agent.owner_id,
        workspaceId,
        machine.current ? `${called}-computer` : `${called}-${nameFrom(machine.kind) || "old"}`,
        machine.home,
        now,
        machine.kind,
        agentId,
      )
      row = (await db.get<ComputerRow>("SELECT * FROM dc_computers WHERE id = ?", id))!
    }
    if (!machine.current) continue
    await grant(db, row.id, agentId, agent.owner_id, now)
    await db.run(
      `INSERT INTO dc_computer_folders (computer_id, agent_id, path, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT (computer_id, agent_id) DO NOTHING`,
      row.id,
      agentId,
      machine.home,
      now,
    )
  }
  return machinesOf(db, agentId)
}
