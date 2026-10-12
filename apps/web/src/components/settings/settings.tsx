import type { AgentSummary, WorkspaceSummary } from "@do-computer/protocol"
import {
  BellIcon,
  BookOpenIcon,
  ChartBarIcon,
  CpuIcon,
  DesktopIcon,
  GearSixIcon,
  HardDrivesIcon,
  HourglassIcon,
  LightningIcon,
  PlugsIcon,
  ShieldCheckIcon,
  SmileyIcon,
  SquaresFourIcon,
  UserCircleIcon,
  UsersIcon,
} from "@phosphor-icons/react"
import { useLiveQuery } from "@tanstack/react-db"
import { useSearch } from "@tanstack/react-router"
import { AgentFace } from "@/components/agent-avatar"
import { PersonFace } from "@/components/people"
import { WorkspaceMark } from "@/components/shell/workspace-menu"
import { agentsCollection } from "@/lib/collections"
import {
  type AgentSection,
  type AppSearch,
  parseSettings,
  type SettingsPlace,
  type TopSection,
  useSettings,
  type WorkspaceSection,
} from "@/lib/settings"
import { useWorkspaces } from "@/lib/workspaces"
import { ComputersSettings } from "./computers.tsx"
import { ConnectorsSettings } from "./connectors.tsx"
import { GeneralSettings } from "./general.tsx"
import { AgentsList, WorkspacesList } from "./lists.tsx"
import { ModelsSettings, ServerModelsSettings } from "./models.tsx"
import { NotificationsSettings } from "./notifications.tsx"
import { PermissionsSettings } from "./permissions.tsx"
import { type ProfileSection, ProfileSettings } from "./profile.tsx"
import { SettingsDialog, type SettingsSection } from "./settings-dialog.tsx"
import { SkillsSettings } from "./skills.tsx"
import { SlackSettings } from "./slack.tsx"
import { TeamSettings } from "./team.tsx"
import { WaitlistSettings } from "./waitlist.tsx"

type Me = { id: string; name: string; image?: string | null }

const OWN: readonly SettingsSection<TopSection>[] = [
  { id: "general", label: "General", icon: <GearSixIcon /> },
  { id: "notifications", label: "Notifications", icon: <BellIcon /> },
  { id: "agents", label: "Agents", icon: <SmileyIcon /> },
  { id: "workspaces", label: "Workspaces", icon: <SquaresFourIcon /> },
]

const SERVER: readonly SettingsSection<TopSection>[] = [
  { id: "server", label: "Models", icon: <HardDrivesIcon /> },
  { id: "waitlist", label: "Waiting list", icon: <HourglassIcon /> },
]

const AGENT: readonly SettingsSection<AgentSection>[] = [
  { id: "profile", label: "Profile", icon: <UserCircleIcon /> },
  { id: "memory", label: "Memory", icon: <BookOpenIcon /> },
  { id: "model", label: "Model and computers", icon: <CpuIcon /> },
  { id: "skills", label: "Skills", icon: <LightningIcon /> },
  { id: "connectors", label: "Connectors", icon: <PlugsIcon /> },
  { id: "permissions", label: "Permissions", icon: <ShieldCheckIcon /> },
  { id: "usage", label: "Usage", icon: <ChartBarIcon /> },
]

const WORKSPACE: readonly SettingsSection<WorkspaceSection>[] = [
  { id: "people", label: "People", icon: <UsersIcon /> },
  { id: "computers", label: "Computers", icon: <DesktopIcon /> },
  { id: "models", label: "Models", icon: <CpuIcon /> },
]

const PROFILE: ReadonlySet<string> = new Set<ProfileSection>([
  "profile",
  "memory",
  "model",
  "usage",
])

type Props = {
  me: Me
  /** Whether they look after the deployment, and so may set what it offers everyone. */
  admin: boolean
  /** Whether the deployment has a waiting list, which those who look after it let people in off. */
  waitlist: boolean
  /** The agent on screen, if there is one. */
  agentId: string | undefined
  /** The workspace on screen. */
  workspace: WorkspaceSummary
}

/**
 * Everything there is to set, in one window over whatever page is showing: open when the address
 * says so, at the place it names. It opens on what is the user's own and on two lists, of agents
 * and of workspaces. Choosing one from a list goes inside it, to its own sections, and the ways
 * in from the rest of the app (an agent's strip, the workspace's menu) go straight there.
 */
export function Settings(props: Props) {
  const search = useSearch({ from: "/_app" })
  const place = search.settings === undefined ? undefined : parseSettings(search.settings)
  return place === undefined ? null : <Open {...props} place={place} search={search} />
}

function Open({
  place,
  search,
  me,
  admin,
  waitlist,
  agentId: shown,
  workspace: current,
}: Props & { place: SettingsPlace; search: AppSearch }) {
  const { open, close } = useSettings()
  const { data: agents } = useLiveQuery((q) => q.from({ agent: agentsCollection }))
  const state = useWorkspaces()
  const workspaces = state?.workspaces ?? [current]

  if (place.at === "agent") {
    const agent = agents?.find((entry) => entry.id === (place.agentId ?? shown))
    // Not here yet. One that is gone, or that was never theirs, leaves the list to choose from.
    if (agent === undefined && agents === undefined) return null
    if (agent !== undefined) {
      return (
        <OfAgent
          agent={agent}
          workspace={workspaces.find((entry) => entry.id === agent.workspaceId)}
          section={place.section}
          search={search}
        />
      )
    }
  }
  if (place.at === "workspace") {
    const workspace = workspaces.find((entry) => entry.id === (place.workspaceId ?? current.id))
    if (workspace === undefined && state === undefined) return null
    if (workspace !== undefined) {
      return <OfWorkspace workspace={workspace} section={place.section} me={me} agentId={shown} />
    }
  }

  const server = SERVER.filter((entry) => entry.id !== "waitlist" || waitlist)
  const asked = place.at === "top" ? place.section : place.at === "agent" ? "agents" : "workspaces"
  const may = asked !== undefined && (admin || OWN.some((entry) => entry.id === asked))
  const section: TopSection = may ? asked : "general"
  return (
    <SettingsDialog
      onClose={close}
      mark={
        <PersonFace
          person={{ id: me.id, name: me.name, image: me.image ?? null }}
          title=""
          className="size-8"
        />
      }
      name="Settings"
      kind={me.name}
      groups={[{ sections: OWN }, ...(admin ? [{ label: "Server", sections: server }] : [])]}
      section={section}
      listing={asked === undefined}
      onSection={(next) => open({ at: "top", section: next })}
      onList={() => open({ at: "top" })}
    >
      {section === "general" ? <GeneralSettings /> : null}
      {section === "notifications" ? <NotificationsSettings /> : null}
      {section === "agents" ? (
        <AgentsList agents={agents ?? []} workspaces={workspaces} current={current.id} />
      ) : null}
      {section === "workspaces" ? (
        <WorkspacesList
          workspaces={workspaces}
          invitations={state?.invitations ?? []}
          agents={agents ?? []}
          me={me}
        />
      ) : null}
      {section === "server" ? <ServerModelsSettings meId={me.id} /> : null}
      {section === "waitlist" ? <WaitlistSettings /> : null}
    </SettingsDialog>
  )
}

/** Everything that sets up one agent, whichever page is showing under it. */
function OfAgent({
  agent,
  workspace,
  section: asked,
  search,
}: {
  agent: AgentSummary
  workspace: WorkspaceSummary | undefined
  section: AgentSection | undefined
  search: AppSearch
}) {
  const { open, close } = useSettings()
  const section = asked ?? "profile"
  const at = (next?: AgentSection) =>
    open({ at: "agent", agentId: agent.id, ...(next === undefined ? {} : { section: next }) })
  return (
    <SettingsDialog
      onClose={close}
      back={{ label: "Agents", onClick: () => open({ at: "top", section: "agents" }) }}
      mark={<AgentFace agent={agent} className="size-8" still />}
      name={agent.name ?? "New agent"}
      kind={workspace?.kind === "team" ? `Agent in ${workspace.name}` : "Your agent"}
      groups={[{ sections: AGENT }]}
      // Slack is set up from the connectors, and is one of them in the list.
      section={section === "slack" ? "connectors" : section}
      listing={asked === undefined}
      onSection={at}
      onList={() => at()}
    >
      {/* Kept while another section shows, so what was typed in it is still there on return. */}
      <ProfileSettings
        key={agent.id}
        agentId={agent.id}
        section={PROFILE.has(section) ? (section as ProfileSection) : undefined}
      />
      {section === "skills" ? <SkillsSettings agentId={agent.id} /> : null}
      {section === "connectors" ? (
        <ConnectorsSettings agent={agent} search={search} onSlack={() => at("slack")} />
      ) : null}
      {section === "slack" ? <SlackSettings agent={agent} onBack={() => at("connectors")} /> : null}
      {section === "permissions" ? <PermissionsSettings agentId={agent.id} /> : null}
    </SettingsDialog>
  )
}

/**
 * What is set for a workspace and not for one agent: a team's name and people, the computers its
 * agents work on, and the models they can run on.
 */
function OfWorkspace({
  workspace,
  section: asked,
  me,
  agentId,
}: {
  workspace: WorkspaceSummary
  section: WorkspaceSection | undefined
  me: Me
  agentId: string | undefined
}) {
  const { open, close } = useSettings()
  const team = workspace.kind === "team"
  // One's own workspace has no people to set, so its settings start at the computers.
  const sections = WORKSPACE.filter((entry) => team || entry.id !== "people")
  const section = sections.some((entry) => entry.id === asked) ? asked! : sections[0]!.id
  const at = (next?: WorkspaceSection) =>
    open({
      at: "workspace",
      workspaceId: workspace.id,
      ...(next === undefined ? {} : { section: next }),
    })
  return (
    <SettingsDialog
      onClose={close}
      back={{ label: "Workspaces", onClick: () => open({ at: "top", section: "workspaces" }) }}
      mark={<WorkspaceMark workspace={workspace} me={me} className="size-8" />}
      name={workspace.name}
      kind={team ? "Team" : "Only you"}
      groups={[{ sections }]}
      section={section}
      listing={asked === undefined}
      onSection={at}
      onList={() => at()}
    >
      {section === "people" ? <TeamSettings workspace={workspace} /> : null}
      {section === "computers" ? (
        <ComputersSettings agentId={agentId} meId={me.id} workspaceId={workspace.id} />
      ) : null}
      {section === "models" ? <ModelsSettings workspace={workspace} meId={me.id} /> : null}
    </SettingsDialog>
  )
}
