import type { SkillSummary } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { keys } from "@/lib/queries"
import { useSession } from "@/lib/use-session"
import { confirm, errorText, haptic, tell } from "@/ui"

const SOURCES = {
  bundled: "Built in",
  agent: "Written by the Dood",
  installed: "Installed",
} as const

/** Where a skill came from and how much there is of it, as the web's card says it. */
export const sourceWords = (skill: SkillSummary): string =>
  SOURCES[skill.source] +
  (skill.origin ? ` from ${skill.origin}` : "") +
  (skill.files.length > 1 ? ` · ${skill.files.length} files` : "")

/** The name one skill's files are kept under: asked for again whenever the skill changes. */
export const skillKey = (agentId: string, skill: Pick<SkillSummary, "name" | "updatedAt">) =>
  [...keys.skills(agentId), skill.name, skill.updatedAt] as const

/** The agent's skills, as its list of them has them. */
export function useSkills(agentId: string) {
  const { client } = useSession()
  return useQuery<SkillSummary[]>({
    queryKey: keys.skills(agentId),
    queryFn: () => client.agent(agentId).skills(),
  })
}

/**
 * What can be done to a skill from its row and from its page: put it in use or out of it, and
 * delete it. Any skill can be deleted, a built-in one too, as on the web; a phone asks first.
 */
export function useSkillActions(agentId: string) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const key = keys.skills(agentId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  const setEnabled = async (skill: SkillSummary, enabled: boolean) => {
    haptic.tap()
    // Shown at once; asking again then confirms it or puts it back.
    queryClient.setQueryData<SkillSummary[]>(key, (kept) =>
      kept?.map((each) => (each.name === skill.name ? { ...each, enabled } : each)),
    )
    try {
      await client.agent(agentId).setSkillEnabled(skill.name, enabled)
    } catch (error) {
      tell("The skill could not be changed", errorText(error))
    } finally {
      void refresh()
    }
  }

  /** Resolves true once the skill is gone. */
  const remove = async (skill: SkillSummary): Promise<boolean> => {
    const sure = await confirm({
      title: `Delete ${skill.name}?`,
      message: "Your Dood loses these instructions. This cannot be undone.",
      action: "Delete",
    })
    if (!sure) return false
    try {
      await client.agent(agentId).removeSkill(skill.name)
      queryClient.setQueryData<SkillSummary[]>(key, (kept) =>
        kept?.filter((each) => each.name !== skill.name),
      )
      haptic.done()
      return true
    } catch (error) {
      tell("The skill could not be deleted", errorText(error))
      return false
    } finally {
      void refresh()
    }
  }

  return { setEnabled, remove }
}
