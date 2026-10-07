import { useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"

/** The sections of an agent's settings, in the order they are listed. */
export const AGENT_SECTIONS = [
  "identity",
  "memory",
  "model",
  "skills",
  "connectors",
  "permissions",
  "usage",
  "manage",
] as const
export type AgentSection = (typeof AGENT_SECTIONS)[number]

/** The sections of a workspace's settings. `team` is only there for a team. */
export const WORKSPACE_SECTIONS = ["team", "computers", "agents"] as const
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]

/**
 * What the address can say on any page behind sign-in. Settings are windows over whatever page
 * is showing, so which one is open, and at which section, is said here and not in the path.
 */
export type AppSearch = {
  /** The open agent's settings, at this section. */
  settings?: AgentSection
  /** The workspace's settings, at this section. */
  workspace?: WorkspaceSection
  /** Coming back from a service a connector signed in to: which one was connected. */
  connected?: string
  /** Coming back from one that did not connect: why not. */
  connector_error?: string
}

const oneOf = <T extends string>(all: readonly T[], value: unknown): T | undefined =>
  typeof value === "string" && (all as readonly string[]).includes(value) ? (value as T) : undefined

export function validateAppSearch(search: Record<string, unknown>): AppSearch {
  const settings = oneOf(AGENT_SECTIONS, search.settings)
  const workspace = oneOf(WORKSPACE_SECTIONS, search.workspace)
  return {
    ...(settings ? { settings } : {}),
    ...(workspace ? { workspace } : {}),
    ...(typeof search.connected === "string" ? { connected: search.connected } : {}),
    ...(typeof search.connector_error === "string"
      ? { connector_error: search.connector_error }
      : {}),
  }
}

/**
 * Opens and closes the settings windows by changing the address, keeping the page under them.
 * Passing `undefined` closes the window, and with it forgets what a connector came back saying.
 */
export function useSettings(): {
  openAgent: (section: AgentSection | undefined) => void
  openWorkspace: (section: WorkspaceSection | undefined) => void
} {
  const navigate = useNavigate()
  const change = useCallback(
    (patch: AppSearch) =>
      void navigate({
        to: ".",
        // The page's own search, such as the library's open file, is kept as it is.
        search: ((previous: Record<string, unknown>) => {
          const { settings: _settings, workspace: _workspace, ...rest } = previous
          const { connected: _connected, connector_error: _error, ...page } = rest
          return { ...(patch.settings === undefined ? page : rest), ...patch }
        }) as never,
      }),
    [navigate],
  )
  return {
    openAgent: useCallback(
      (section) => change(section === undefined ? {} : { settings: section }),
      [change],
    ),
    openWorkspace: useCallback(
      (section) => change(section === undefined ? {} : { workspace: section }),
      [change],
    ),
  }
}
