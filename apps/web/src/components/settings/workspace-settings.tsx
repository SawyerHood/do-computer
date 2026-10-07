import type { WorkspaceSummary } from "@durable-computer/protocol"
import { BellIcon, DesktopIcon, PlusCircleIcon, UsersIcon } from "@phosphor-icons/react"
import { useSearch } from "@tanstack/react-router"
import { WorkspaceMark } from "@/components/shell/workspace-menu"
import { useSettings, type WorkspaceSection } from "@/lib/settings"
import { ComputersSettings } from "./computers.tsx"
import { DefaultsSettings } from "./defaults.tsx"
import { NotificationsSettings } from "./notifications.tsx"
import { SettingsDialog, type SettingsSection } from "./settings-dialog.tsx"
import { TeamSettings } from "./team.tsx"

const SECTIONS: readonly SettingsSection<WorkspaceSection>[] = [
  { id: "team", label: "Team", icon: <UsersIcon /> },
  { id: "computers", label: "Computers", icon: <DesktopIcon /> },
  { id: "agents", label: "New agents", icon: <PlusCircleIcon /> },
  { id: "notifications", label: "Notifications", icon: <BellIcon /> },
]

/**
 * What is set for the workspace and not for one agent: a team's name and people, the computers
 * its agents work on, what a new agent starts with, and whether this browser is notified. A
 * window over whatever page is showing, open when the address says so.
 */
export function WorkspaceSettings({
  workspace,
  me,
  agentId,
}: {
  workspace: WorkspaceSummary
  me: { id: string; name: string; image?: string | null }
  /** The agent on screen, if there is one. */
  agentId: string | undefined
}) {
  const search = useSearch({ from: "/_app" })
  const { openWorkspace } = useSettings()
  if (search.workspace === undefined) return null
  const team = workspace.kind === "team"
  const sections = team ? SECTIONS : SECTIONS.filter((entry) => entry.id !== "team")
  // One's own workspace has no people to set, so its settings start at the computers.
  const section = !team && search.workspace === "team" ? "computers" : search.workspace
  return (
    <SettingsDialog
      open
      onClose={() => openWorkspace(undefined)}
      mark={<WorkspaceMark workspace={workspace} me={me} className="size-8" />}
      name={workspace.name}
      kind="Workspace settings"
      sections={sections}
      section={section}
      onSection={openWorkspace}
    >
      {section === "team" ? <TeamSettings workspace={workspace} /> : null}
      {section === "computers" ? (
        <ComputersSettings agentId={agentId} meId={me.id} workspaceId={workspace.id} />
      ) : null}
      {section === "agents" ? <DefaultsSettings /> : null}
      {section === "notifications" ? <NotificationsSettings /> : null}
    </SettingsDialog>
  )
}
