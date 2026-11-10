import type { Result, Sources } from "../app.contract.d.ts"
import type { SkillDetail, SkillSummary } from "../protocol/agent.ts"
import { current, del, get, NOBODY, patch, post, reply, seg } from "./api.ts"
const answer = async (owner: string, agentId: string, work: () => Promise<void>) => ({
  owner,
  agentId,
  ...(await reply(work)),
})
export const skillsSources: Pick<
  Sources,
  "loadSkills" | "readSkill" | "changeSkill" | "installSkill"
> = {
  loadSkills: async ([owner, agentId], store): Promise<Result<"loadSkills">> => {
    if (!agentId || !current(owner, store)) return { owner: NOBODY, agentId: "", items: [] }
    const { skills } = await get<{ skills: SkillSummary[] }>(
      store,
      `/api/agents/${seg(agentId)}/skills`,
    )
    return {
      owner,
      agentId,
      items: skills.map((s) => ({
        name: s.name,
        description: s.description,
        enabled: s.enabled,
        files: [],
        source: `${{ bundled: "Built in", agent: "Written by the Dood", installed: "Installed" }[s.source]}${s.origin ? ` from ${s.origin}` : ""}${s.files.length > 1 ? ` · ${s.files.length} files` : ""}`,
      })),
    }
  },
  readSkill: async ([owner, agentId, name], store): Promise<Result<"readSkill">> => {
    if (!agentId || !name || !current(owner, store))
      return { owner: NOBODY, agentId: "", name: "", files: [] }
    const detail = await get<SkillDetail>(store, `/api/agents/${seg(agentId)}/skills/${seg(name)}`)
    return {
      owner,
      agentId,
      name,
      files: Object.entries(detail.contents).map(([path, content]) => ({ path, content })),
    }
  },
  changeSkill: async ([owner, agentId, name, remove, enabled], store) =>
    answer(owner, agentId, async () => {
      if (!current(owner, store)) throw new Error("Signed out")
      const path = `/api/agents/${seg(agentId)}/skills/${seg(name)}`
      if (remove) await del(store, path)
      else await patch(store, path, { enabled })
    }),
  installSkill: async ([owner, agentId, url], store) =>
    answer(owner, agentId, async () => {
      if (!current(owner, store)) throw new Error("Signed out")
      await post(store, `/api/agents/${seg(agentId)}/skills/install`, { url })
    }),
}
