import type { Avatar } from "./agent.ts"

/**
 * Where agents live. Everyone has a `personal` workspace, which only they can see. A `team` is
 * shared: every member can use every agent in it and read its chats.
 */
export type WorkspaceKind = "personal" | "team"

/**
 * What a member of a team may do. Every member uses the team's agents and makes new ones. An
 * `admin` also invites and removes people and deletes agents. The `owner` can also delete the
 * team or hand it to someone else.
 */
export type WorkspaceRole = "owner" | "admin" | "member"

/** The id of a user's personal workspace. It has no record of its own: it is the user. */
export const personalWorkspaceId = (userId: string) => `personal:${userId}`
export const isPersonalWorkspace = (workspaceId: string) => workspaceId.startsWith("personal:")

/** The colors a team's tile can be: the app's own teal, and the colors agents come in. */
export const WORKSPACE_COLORS = [
  { id: "teal", label: "Teal", hex: "#1d7a7d" },
  { id: "clay", label: "Clay", hex: "#b8674a" },
  { id: "moss", label: "Moss", hex: "#5f8a4e" },
  { id: "plum", label: "Plum", hex: "#7d5a9a" },
  { id: "honey", label: "Honey", hex: "#c9952c" },
  { id: "rose", label: "Rose", hex: "#c0607a" },
  { id: "ink", label: "Ink", hex: "#2f3a52" },
] as const

export const workspaceColor = (id: string): string =>
  WORKSPACE_COLORS.find((color) => color.id === id)?.hex ?? WORKSPACE_COLORS[0].hex

/** Someone as others see them: enough to draw their face and say their name. */
export type Person = {
  id: string
  name: string
  image: string | null
}

export type WorkspaceMember = Person & {
  email: string
  role: WorkspaceRole
  joinedAt: number
}

export type WorkspaceSummary = {
  id: string
  name: string
  color: string
  kind: WorkspaceKind
  /** What the signed-in user is here. */
  role: WorkspaceRole
  /** Everyone in it. A personal workspace has only its owner. */
  members: WorkspaceMember[]
  createdAt: number
}

/** Someone asked to join a team who has not answered yet. Addressed by email or GitHub username. */
export type Invitation = {
  id: string
  workspaceId: string
  email: string | null
  githubLogin: string | null
  role: Exclude<WorkspaceRole, "owner">
  note: string | null
  invitedBy: Person
  createdAt: number
  expiresAt: number
}

/** An invitation as its sender gets it back: the link is shown this once, and is not kept. */
export type SentInvitation = Invitation & {
  link: string
  /** Whether an email went out. False for a GitHub username, and where no mail is set up. */
  emailed: boolean
}

export type InviteRequest = {
  /** Email addresses and GitHub usernames. A username may start with `@`. */
  who: string[]
  role?: Exclude<WorkspaceRole, "owner">
  note?: string
}

export type InviteResult = {
  invitations: SentInvitation[]
  /** The entries that could not be invited, each with why. */
  problems: { who: string; error: string }[]
}

/** What someone holding an invitation sees before they answer it. */
export type InvitationPreview = {
  id: string
  workspace: { id: string; name: string; color: string }
  invitedBy: Person
  note: string | null
  role: Exclude<WorkspaceRole, "owner">
  /** Who is in the team already. */
  members: Person[]
  /** The agents they would share. */
  agents: { id: string; name: string | null; avatar: Avatar | null; hatched: boolean }[]
  expiresAt: number
}

export type WorkspacesState = {
  workspaces: WorkspaceSummary[]
  /** Invitations addressed to the signed-in user that they have not answered. */
  invitations: InvitationPreview[]
}

export type CreateWorkspaceRequest = {
  name: string
  color?: string
  /** Agents of the user's own to move into the new team. */
  agentIds?: string[]
  invite?: InviteRequest
}

export type UpdateWorkspaceRequest = { name?: string; color?: string }

/** What a workspace has chosen for all its agents. */
export type WorkspaceOptions = {
  /**
   * Whether the browser its agents use on a computer opens in a window the computer's owner can
   * watch, as opposed to working out of sight.
   */
  showBrowser: boolean
  /** Whether the signed-in user may change any of this. */
  canChange: boolean
}

/** Where someone is in a team right now, as the others see it. */
export type Presence = {
  userId: string
  /** The agent they have open, if any. */
  agentId: string | null
  /** The chat they have open, if any. */
  chatId: string | null
  /** They are writing a message in that chat. */
  typing: boolean
}

/** What a client tells the team about itself. Sent whenever it changes. */
export type PresenceUpdate = { agentId: string | null; chatId: string | null; typing?: boolean }

export type PresenceEvent =
  /** Everyone who is here, one entry for each place a person has open. */
  | { type: "presence"; here: Presence[] }
  /** Something about the team changed: its people, its agents or its name. Fetch it again. */
  | { type: "changed" }
