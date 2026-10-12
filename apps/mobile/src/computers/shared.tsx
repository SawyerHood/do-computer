import type {
  AgentSummary,
  ComputerKind,
  ComputerRequest,
  ComputerSummary,
} from "@do-computer/protocol"
import { isPersonalWorkspace, PAIRED_COMPUTER } from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { useMemo, useState } from "react"
import { Pressable, View } from "react-native"
import { keys, useAgents } from "@/lib/queries"
import { mono, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { haptic, Icon, Text } from "@/ui"

export const PLATFORMS: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" }

/** How long ago something was, in the few words the web app uses. */
export function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}

/** Whether a kind can be added: not no computer at all, nor one that is one agent's alone. */
export const canBeAdded = (kind: ComputerKind) => kind.id !== "none" && kind.perAgent !== true

/** A machine the app made for a workspace, as opposed to one somebody paired. */
export const isMachine = (computer: ComputerSummary) => computer.kind !== PAIRED_COMPUTER

/**
 * Whether agents are connected to it one by one: always to a paired computer, and to a machine
 * that is not open to all of them. A machine that cannot be shared keeps its one agent.
 */
export const isChosen = (computer: ComputerSummary) =>
  isMachine(computer) ? computer.shareable && computer.access === "chosen" : true

/**
 * The computers the person can see. `every` asks again that often: the computers page does, as
 * the web's does, since whether a computer is online changes without any event saying so.
 */
export function useComputers(every?: number) {
  const { client } = useSession()
  return useQuery<ComputerSummary[]>({
    queryKey: keys.computers,
    queryFn: () => client.listComputers(),
    ...(every === undefined ? {} : { refetchInterval: every }),
  })
}

/** What the person's agents are waiting to hear about computers they asked to use. */
export function useComputerRequests(every?: number) {
  const { client } = useSession()
  return useQuery<ComputerRequest[]>({
    queryKey: keys.computerRequests,
    queryFn: () => client.computerRequests(),
    ...(every === undefined ? {} : { refetchInterval: every }),
  })
}

/** The kinds of machine this server makes. The same for everyone, and only a deployment changes it. */
export function useComputerKinds() {
  const { client } = useSession()
  return useQuery({
    queryKey: keys.computerKinds,
    queryFn: () => client.computerKinds(),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** The person's agents by id, for putting a name and a face to one. */
export function useAgentsById(): ReadonlyMap<string, AgentSummary> {
  const { data } = useAgents()
  return useMemo(() => new Map((data ?? []).map((agent) => [agent.id, agent])), [data])
}

/**
 * The agents that could be connected to a computer and are not: one's own computer serves any
 * agent one can use; a team's, and any machine, serves the agents of its workspace.
 */
export function connectable(
  computer: ComputerSummary,
  agents: ReadonlyMap<string, AgentSummary>,
): AgentSummary[] {
  if (!isChosen(computer)) return []
  const personal = isPersonalWorkspace(computer.workspaceId)
  return [...agents.values()].filter(
    (agent) =>
      !computer.agentIds.includes(agent.id) &&
      ((personal && !isMachine(computer)) || agent.workspaceId === computer.workspaceId),
  )
}

/** What a computer is, under its name: the kind of machine, or the platform, host and what it allows. */
export function describe(computer: ComputerSummary, kinds: readonly ComputerKind[]): string {
  if (isMachine(computer)) {
    return kinds.find((kind) => kind.id === computer.kind)?.label ?? computer.kind
  }
  return [
    PLATFORMS[computer.platform] ?? computer.platform,
    computer.hostname,
    computer.readOnly ? "read-only" : undefined,
    computer.screen ? "screen" : undefined,
    computer.browser ? "browser" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ")
}

/** The command that installs the daemon from this server, as the web app prints it. */
export function useInstallCommand(): string {
  const { server } = useSession()
  return `curl -fsSL ${server.replace(/\/+$/, "")}/install.sh | sh`
}

/** Put words on the clipboard. Resolves false where the system would not take them. */
export async function copyText(text: string): Promise<boolean> {
  const copied = await Clipboard.setStringAsync(text).catch(() => false)
  if (copied) haptic.done()
  return copied
}

/** What is on the clipboard, or nothing where it cannot be read. */
export const pastedText = (): Promise<string> => Clipboard.getStringAsync().catch(() => "")

/**
 * A row to choose one of several: a round mark at its start that is filled for the one chosen.
 * The kit's rows are buttons; this one says it is a radio button, as the web's is.
 */
export function RadioRow({
  title,
  subtitle,
  checked,
  disabled = false,
  onPress,
}: {
  title: string
  subtitle?: string
  checked: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.tap()
        onPress()
      }}
      style={({ pressed }) => [
        { minHeight: 50, paddingHorizontal: 16, paddingVertical: 9, flexDirection: "row", gap: 12 },
        { alignItems: "center", opacity: disabled ? 0.45 : 1 },
        pressed ? { backgroundColor: theme.fill } : null,
      ]}
    >
      <Icon
        name={checked ? "checkCircle" : "circle"}
        size={22}
        color={checked ? theme.tint : theme.ink3}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text>{title}</Text>
        {subtitle === undefined || subtitle === "" ? null : (
          <Text variant="subhead" tone="ink2">
            {subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  )
}

/** Words set in the fixed-width face, as a command or a path is: all of it, on as many lines as it takes. */
export function Mono({ children, size = 14 }: { children: string; size?: number }) {
  return (
    <Text selectable style={{ fontFamily: mono, fontSize: size, lineHeight: size + 6, letterSpacing: 0 }}>
      {children}
    </Text>
  )
}

/** Words that say something went wrong, under the group it went wrong in. */
export function Problem({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null
  return (
    <Text variant="footnote" tone="red" accessibilityRole="alert">
      {error instanceof Error ? error.message : String(error)}
    </Text>
  )
}

/**
 * Pulling a page down to ask again. The wheel is shown for the pull alone: what is asked for
 * again by itself, as the computers are every few seconds, must not bring it out.
 */
export function useRefresh(again: () => Promise<unknown>): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false)
  return {
    refreshing,
    onRefresh: () => {
      setRefreshing(true)
      void again()
        .catch(() => {})
        .finally(() => setRefreshing(false))
    },
  }
}
