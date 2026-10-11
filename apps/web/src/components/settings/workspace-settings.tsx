import type { WorkspaceSummary } from "@durable-computer/protocol"
import {
  BellIcon,
  CpuIcon,
  DesktopIcon,
  HardDrivesIcon,
  HourglassIcon,
  PlusCircleIcon,
  UsersIcon,
} from "@phosphor-icons/react"
import { useSearch } from "@tanstack/react-router"
import { WorkspaceMark } from "@/components/shell/workspace-menu"
import { useSettings, type WorkspaceSection } from "@/lib/settings"
import { ComputersSettings } from "./computers.tsx"
import { DefaultsSettings } from "./defaults.tsx"
import { ModelsSettings, ServerModelsSettings } from "./models.tsx"
import { NotificationsSettings } from "./notifications.tsx"
import { SettingsDialog, type SettingsSection } from "./settings-dialog.tsx"
import { TeamSettings } from "./team.tsx"
import { WaitlistSettings } from "./waitlist.tsx"

const SECTIONS: readonly SettingsSection<WorkspaceSection>[] = [
  { id: "team", label: "Team", icon: <UsersIcon /> },
  { id: "computers", label: "Computers", icon: <DesktopIcon /> },
  { id: "models", label: "Models", icon: <CpuIcon /> },
  { id: "agents", label: "New agents", icon: <PlusCircleIcon /> },
  { id: "notifications", label: "Notifications", icon: <BellIcon /> },
  { id: "server", label: "Server models", icon: <HardDrivesIcon /> },
  { id: "waitlist", label: "Waiting list", icon: <HourglassIcon /> },
]

/**
 * What is set for the workspace and not for one agent: a team's name and people, the computers
 * its agents work on, the models they can run on, what a new agent starts with, and whether
 * this browser is notified. A window over whatever page is showing, open when the address says
 * so. Someone who looks after the deployment also finds here what it offers everyone, and who is
 * waiting to be let in to it, which are no workspace's but have nowhere else to be.
 */
export function WorkspaceSettings({
  workspace,
  me,
  admin,
  waitlist,
  agentId,
}: {
  workspace: WorkspaceSummary
  me: { id: string; name: string; image?: string | null }
  /** Whether they may sign the deployment itself in to model providers. */
  admin: boolean
  /** Whether the deployment has a waiting list, which those who look after it let people in off. */
  waitlist: boolean
  /** The agent on screen, if there is one. */
  agentId: string | undefined
}) {
  const search = useSearch({ from: "/_app" })
  const { openWorkspace } = useSettings()
  if (search.workspace === undefined) return null
  const team = workspace.kind === "team"
  const sections = SECTIONS.filter(
    (entry) =>
      (team || entry.id !== "team") &&
      (admin || entry.id !== "server") &&
      ((admin && waitlist) || entry.id !== "waitlist"),
  )
  // One's own workspace has no people to set, so its settings start at the computers.
  const section = sections.some((entry) => entry.id === search.workspace)
    ? search.workspace
    : "computers"
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
      {section === "models" ? <ModelsSettings workspace={workspace} meId={me.id} /> : null}
      {section === "agents" ? <DefaultsSettings /> : null}
      {section === "notifications" ? <NotificationsSettings /> : null}
      {section === "server" ? <ServerModelsSettings meId={me.id} /> : null}
      {section === "waitlist" ? <WaitlistSettings /> : null}
    </SettingsDialog>
  )
}
