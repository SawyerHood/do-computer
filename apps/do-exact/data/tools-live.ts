import type { Result, Sources } from "../app.contract.d.ts"
import type { AgentSocketMessage } from "../protocol/socket.ts"
import { current, follow, seg } from "./api.ts"

let counted = { owner: "", agentId: "", changes: 0 }

// One ticketed socket for all four tools pages. `ready` also refreshes after a reconnect.
export const toolsLiveSources: Pick<Sources, "followTools"> = {
  followTools: ([owner, agentId], store) => {
    if (!agentId || !current(owner, store)) return { agentId: "", changes: 0, lost: false }
    if (counted.owner !== owner || counted.agentId !== agentId)
      counted = { owner, agentId, changes: 0 }
    const mine = counted
    const now = (): Result<"followTools"> => ({ agentId, changes: mine.changes, lost: false })
    return follow<Result<"followTools">, AgentSocketMessage>(
      store,
      `/api/agents/${seg(agentId)}/socket`,
      {
        open: () => {
          mine.changes++
          return now()
        },
        each: (message) => {
          const event = message.type === "agent" ? message.event : undefined
          if (
            message.type === "resumed" ||
            event?.type === "ready" ||
            ["skills", "connectors", "schedules", "computers", "approvals"].includes(
              event?.what ?? "",
            )
          )
            mine.changes++
          return now()
        },
        lost: () => ({ agentId, changes: mine.changes, lost: true }),
        now,
      },
    )
  },
}
