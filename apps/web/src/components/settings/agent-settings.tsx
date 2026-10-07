import type { AgentSummary } from "@durable-computer/protocol"
import {
  BookOpenIcon,
  ChartBarIcon,
  CpuIcon,
  LightningIcon,
  PlugsIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"
import { useSearch } from "@tanstack/react-router"
import { AgentFace } from "@/components/agent-avatar"
import { type AgentSection, useSettings } from "@/lib/settings"
import { ConnectorsSettings } from "./connectors.tsx"
import { PermissionsSettings } from "./permissions.tsx"
import { type ProfileSection, ProfileSettings } from "./profile.tsx"
import { SettingsDialog, type SettingsSection } from "./settings-dialog.tsx"
import { SkillsSettings } from "./skills.tsx"

const SECTIONS: readonly SettingsSection<AgentSection>[] = [
  { id: "identity", label: "Identity", icon: <UserCircleIcon /> },
  { id: "memory", label: "Memory", icon: <BookOpenIcon /> },
  { id: "model", label: "Model and computer", icon: <CpuIcon /> },
  { id: "skills", label: "Skills", icon: <LightningIcon /> },
  { id: "connectors", label: "Connectors", icon: <PlugsIcon /> },
  { id: "permissions", label: "Permissions", icon: <ShieldCheckIcon /> },
  { id: "usage", label: "Usage", icon: <ChartBarIcon /> },
  { id: "manage", label: "Move or delete", icon: <TrashIcon />, danger: true },
]

const PROFILE: ReadonlySet<string> = new Set<ProfileSection>([
  "identity",
  "memory",
  "model",
  "usage",
  "manage",
])

/**
 * Everything that sets up one agent, in a window over whichever of its pages is showing. Open
 * when the address says so, at the section it names.
 */
export function AgentSettings({ agent }: { agent: AgentSummary }) {
  const search = useSearch({ from: "/_app" })
  const { openAgent } = useSettings()
  const section = search.settings
  if (section === undefined) return null
  return (
    <SettingsDialog
      open
      onClose={() => openAgent(undefined)}
      mark={<AgentFace agent={agent} className="size-8" still />}
      name={agent.name ?? "New agent"}
      kind="Agent settings"
      sections={SECTIONS}
      section={section}
      onSection={openAgent}
    >
      {/* Kept while another section shows, so what was typed in it is still there on return. */}
      <ProfileSettings
        agentId={agent.id}
        section={PROFILE.has(section) ? (section as ProfileSection) : undefined}
      />
      {section === "skills" ? <SkillsSettings agentId={agent.id} /> : null}
      {section === "connectors" ? <ConnectorsSettings agentId={agent.id} search={search} /> : null}
      {section === "permissions" ? <PermissionsSettings agentId={agent.id} /> : null}
    </SettingsDialog>
  )
}
