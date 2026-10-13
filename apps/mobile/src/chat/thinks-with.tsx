import { type ModelOption, nearestThinking } from "@do-computer/protocol"
import { useRouter } from "expo-router"
import { Platform, View } from "react-native"
import { modelName, THINKING_LABELS, useAgentPage, useModels, useSaveAgent } from "@/agent/agent"
import { useTheme } from "@/lib/theme"
import { Icon, Menu, type MenuItem } from "@/ui"

/** How many models the menu names itself. The rest are a tap away, in the list with a search. */
const NAMED = 6

/**
 * What the agent thinks with, from the message box: one quiet button, as in the web app, that
 * opens how hard the chosen model thinks and, behind its name, the models suggested first. It is the
 * agent's own setting, the one on its page, so it holds for every chat with it and not only
 * this one. A choice is kept as it is made.
 *
 * Nothing is drawn where there is nothing to choose between.
 */
export function ThinksWith({ agentId }: { agentId: string }) {
  const theme = useTheme()
  const router = useRouter()
  const { agent, workspace } = useAgentPage(agentId)
  const { data: models } = useModels(workspace?.id)
  const { save } = useSaveAgent(agentId)
  if (agent === undefined || models === undefined) return null
  const chosen = models.find((option) => option.id === agent.model)
  const levels = chosen?.thinking ?? []
  if (models.length < 2 && levels.length < 2) return null

  // A model the workspace has two ways of paying for is in the list twice, and here once.
  const once = models.filter(
    (option, at) => models.findIndex((other) => other.id === option.id) === at,
  )
  const suggested = once.filter((option) => option.recommended)
  const first = (suggested.length > 0 ? suggested : once).slice(0, NAMED)
  const named = chosen === undefined || first.includes(chosen) ? first : [chosen, ...first]
  const thinking = nearestThinking(levels, agent.thinking)

  const choose = (option: ModelOption) => {
    if (option.id === agent.model) return
    void save({
      model: option.id,
      // A level the new model lacks becomes the nearest one it has.
      thinking: nearestThinking(option.thinking ?? [], agent.thinking) ?? agent.thinking,
    })
  }
  // The system's menu names a group above it. Where a menu is a plain list, each line says
  // what it is a level of.
  const levelTitle = (label: string) => (Platform.OS === "ios" ? label : `Thinking: ${label}`)
  // The models are a menu of their own under the chosen one's name, which keeps this one
  // short enough to be seen whole above a keyboard: the levels, and one line for the model.
  const items: MenuItem[] = [
    {
      // Without who makes it, which the list behind it says, so that it is one line.
      title: (chosen?.name ?? modelName(models, agent.model)).replace(/^[^:]+: /, ""),
      icon: "cpu",
      children: [
        ...named.map((option) => ({
          title: option.name,
          checked: option.id === agent.model,
          onPress: () => choose(option),
        })),
        ...(once.length > named.length
          ? [
              {
                title: "All models",
                icon: "search" as const,
                onPress: () => router.push(`/a/${agentId}/model-picker`),
              },
            ]
          : []),
      ],
    },
    ...(levels.length > 1
      ? [
          {
            title: "Thinking",
            inline: true,
            children: levels.map((level) => ({
              title: levelTitle(THINKING_LABELS[level]),
              checked: level === thinking,
              onPress: () => void save({ thinking: level }),
            })),
          },
        ]
      : []),
  ]

  return (
    // The system writes a menu's name over what is not in a group of its own: the model.
    <Menu items={items} title={Platform.OS === "ios" ? "Model" : "Model and thinking"}>
      <View
        accessibilityLabel="Model and thinking"
        style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="brain" size={20} color={theme.ink2} />
      </View>
    </Menu>
  )
}
