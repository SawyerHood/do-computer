import type { WorkspaceSummary } from "@do-computer/protocol"
import { useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"

/**
 * What the settings open on: what is the user's own, the two lists that everything else is
 * reached through, and what the deployment offers, for those who look after it.
 */
export const TOP_SECTIONS = [
  "general",
  "notifications",
  "agents",
  "workspaces",
  "server",
  "waitlist",
] as const
export type TopSection = (typeof TOP_SECTIONS)[number]

/**
 * The sections of one agent's settings, in the order they are listed. `slack` is not listed: it
 * is reached from `connectors`.
 */
export const AGENT_SECTIONS = [
  "profile",
  "memory",
  "model",
  "skills",
  "connectors",
  "slack",
  "permissions",
  "usage",
] as const
export type AgentSection = (typeof AGENT_SECTIONS)[number]

/**
 * The sections of one workspace's settings. `people` is only there for a team, and `passwords`
 * only where the workspace keeps logins or cards and the person may see them.
 */
export const WORKSPACE_SECTIONS = ["people", "computers", "models", "passwords"] as const
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]

/** The sections one workspace's settings have, in the order they are listed. */
export function workspaceSections(
  workspace: Pick<WorkspaceSummary, "kind" | "savedLogins" | "savedCards">,
): WorkspaceSection[] {
  return WORKSPACE_SECTIONS.filter(
    (section) =>
      (section !== "people" || workspace.kind === "team") &&
      (section !== "passwords" || workspace.savedLogins === true || workspace.savedCards === true),
  )
}

/**
 * A place in the settings: the top of them, one agent's, or one workspace's. With no section it
 * is the list of sections itself, which on a wide screen shows the first of them beside it. An
 * agent or workspace that is not named is the one on screen, which is how addresses from before
 * there was one window still open.
 */
export type SettingsPlace =
  | { at: "top"; section?: TopSection }
  | { at: "agent"; agentId?: string; section?: AgentSection }
  | { at: "workspace"; workspaceId?: string; section?: WorkspaceSection }

/**
 * What the address can say on any page behind sign-in. Settings are a window over whatever page
 * is showing, so whether it is open, and where, is said here and not in the path.
 */
export type AppSearch = {
  /** The open place in the settings, as `settingsAddress` writes it. */
  settings?: string
  /** Coming back from a service a connector signed in to: which one was connected. */
  connected?: string
  /** Coming back from one that did not connect: why not. */
  connector_error?: string
}

const oneOf = <T extends string>(all: readonly T[], value: unknown): T | undefined =>
  typeof value === "string" && (all as readonly string[]).includes(value) ? (value as T) : undefined

/** A place as the address has it: `general`, `agent.<id>.memory`, `workspace.<id>`. */
export function settingsAddress(place: SettingsPlace): string {
  if (place.at === "top") return place.section ?? "all"
  const id = place.at === "agent" ? place.agentId : place.workspaceId
  // One that is not named is written the way it was before: the section alone.
  if (id === undefined) return place.section ?? (place.at === "agent" ? "profile" : "computers")
  return [place.at, id, ...(place.section === undefined ? [] : [place.section])].join(".")
}

/** Sections that were renamed or joined to another, by what they were called. */
const RENAMED: Record<string, string> = { identity: "profile", manage: "profile", team: "people" }

export function parseSettings(value: string): SettingsPlace | undefined {
  if (value === "all") return { at: "top" }
  const top = oneOf(TOP_SECTIONS, value)
  if (top !== undefined) return { at: "top", section: top }
  const [kind, id, named, ...rest] = value.split(".")
  if (id !== undefined && id !== "" && rest.length === 0) {
    if (kind === "agent") {
      const section = oneOf(AGENT_SECTIONS, named)
      if (named === undefined || section !== undefined) {
        return { at: "agent", agentId: id, ...(section === undefined ? {} : { section }) }
      }
    }
    if (kind === "workspace") {
      const section = oneOf(WORKSPACE_SECTIONS, named)
      if (named === undefined || section !== undefined) {
        return { at: "workspace", workspaceId: id, ...(section === undefined ? {} : { section }) }
      }
    }
    return undefined
  }
  // An address from before: a section of the agent on screen, or of its workspace.
  const now = RENAMED[value] ?? value
  const agent = oneOf(AGENT_SECTIONS, now)
  if (agent !== undefined) return { at: "agent", section: agent }
  const workspace = oneOf(WORKSPACE_SECTIONS, now)
  if (workspace !== undefined) return { at: "workspace", section: workspace }
  return undefined
}

/** Where `?workspace=<section>` led, when the workspace's settings were a window of their own. */
const WAS_WORKSPACE: Record<string, string> = {
  team: "people",
  computers: "computers",
  models: "models",
  agents: "general",
  notifications: "notifications",
  server: "server",
  waitlist: "waitlist",
}

export function validateAppSearch(search: Record<string, unknown>): AppSearch {
  const settings =
    typeof search.settings === "string" && parseSettings(search.settings) !== undefined
      ? search.settings
      : typeof search.workspace === "string"
        ? WAS_WORKSPACE[search.workspace]
        : undefined
  return {
    ...(settings ? { settings } : {}),
    ...(typeof search.connected === "string" ? { connected: search.connected } : {}),
    ...(typeof search.connector_error === "string"
      ? { connector_error: search.connector_error }
      : {}),
  }
}

/**
 * Opens and closes the settings by changing the address, keeping the page under them. Closing
 * them, or leaving the agent's part of them, forgets what a connector came back saying.
 */
export function useSettings(): {
  open: (place: SettingsPlace) => void
  close: () => void
} {
  const navigate = useNavigate()
  const change = useCallback(
    (place: SettingsPlace | undefined) =>
      void navigate({
        to: ".",
        // The page's own search, such as the library's open file, is kept as it is.
        search: ((previous: Record<string, unknown>) => {
          const { settings: _settings, ...rest } = previous
          const { connected: _connected, connector_error: _error, ...page } = rest
          if (place === undefined) return page
          return { ...(place.at === "agent" ? rest : page), settings: settingsAddress(place) }
        }) as never,
      }),
    [navigate],
  )
  return {
    open: change,
    close: useCallback(() => change(undefined), [change]),
  }
}
