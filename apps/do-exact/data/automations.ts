import type { Result, Sources } from "../app.contract.d.ts"
import type { ScheduleSummary } from "../protocol/agent.ts"
import { current, del, get, NOBODY, patch, post, reply, seg } from "./api.ts"
const when = (at: number) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at))
const outcomes = {
  reported: "reported to the main chat",
  delivered: "reported back",
  silent: "had nothing to report",
  failed: "did not finish",
  skipped: "the check found nothing, so the Dood was not started",
  "check-failed": "the check is still failing, so the Dood was not started",
}
const times = (n: number) => (n === 1 ? "once" : `${n} times`)
const answer = async (owner: string, agentId: string, work: () => Promise<void>) => ({
  owner,
  agentId,
  ...(await reply(work)),
})
export const automationsSources: Pick<Sources, "loadAutomations" | "changeAutomation"> = {
  loadAutomations: async ([owner, agentId], store): Promise<Result<"loadAutomations">> => {
    if (!agentId || !current(owner, store)) return { owner: NOBODY, agentId: "", items: [] }
    const { schedules } = await get<{ schedules: ScheduleSummary[] }>(
      store,
      `/api/agents/${seg(agentId)}/schedules`,
    )
    return {
      owner,
      agentId,
      items: schedules.map((s) => ({
        id: s.id,
        title: s.title,
        prompt: s.prompt,
        schedule: s.schedule,
        enabled: s.enabled,
        running: s.running,
        status: s.running
          ? "Running"
          : s.enabled && s.nextRunAt !== null
            ? "Active"
            : s.runCount > 0 && s.nextRunAt === null && !s.enabled
              ? "Done"
              : "Paused",
        next: s.enabled && s.nextRunAt !== null ? `next ${when(s.nextRunAt)}` : "",
        check: s.check
          ? `Checks first on ${s.check.computer}, and only starts the Dood ${s.check.wake === "change" ? "when what this prints changes" : "if this prints something"}:`
          : "",
        command: s.check?.command ?? "",
        last: s.lastRun ? `Last run ${when(s.lastRun.at)}: ${outcomes[s.lastRun.outcome]}.` : "",
        chatId: s.lastRun?.chatId ?? "",
        tally:
          s.check && s.runCount > 0
            ? `Checked ${times(s.runCount)} and ${s.runCount === s.skipCount ? "never started the Dood" : `started the Dood ${times(s.runCount - s.skipCount)}`}.`
            : "",
      })),
    }
  },
  changeAutomation: async ([owner, agentId, id, operation, enabled], store) =>
    answer(owner, agentId, async () => {
      if (!current(owner, store)) throw new Error("Signed out")
      const path = `/api/agents/${seg(agentId)}/schedules/${seg(id)}`
      if (operation === "remove") await del(store, path)
      else if (operation === "run") await post(store, `${path}/run`)
      else if (operation === "toggle") await patch(store, path, { enabled })
      else throw new Error("Unknown automation change")
    }),
}
