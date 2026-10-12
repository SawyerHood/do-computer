import type {
  Invitation,
  SentInvitation,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
} from "@do-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { View } from "react-native"
import { keys } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { confirm, errorText, Face, haptic, Icon, Menu, type MenuItem, Row, tell, Text } from "@/ui"
import { CopyLink } from "./who"

export const ROLE_WORDS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })

/** Under what name a team's open invitations are kept. */
export const invitationsKey = (workspaceId: string) => keys.workspace(workspaceId, "invitations")

export type Change = (work: () => Promise<unknown>) => Promise<boolean>

/**
 * Run something that changes a team, ask for the workspaces again, and say what went wrong if
 * it did not work. Resolves true when it worked.
 */
export function useChange(): Change {
  const queryClient = useQueryClient()
  return async (work) => {
    try {
      await work()
      await queryClient.invalidateQueries({ queryKey: keys.workspaces, exact: true })
      haptic.done()
      return true
    } catch (error) {
      haptic.fail()
      tell("That did not work", errorText(error, "That did not work. Try again."))
      return false
    }
  }
}

/**
 * One person of a team. The owner decides who is what and can hand the team on; an admin can
 * remove members. What the signed-in person may do with this one is in the menu on their role.
 */
export function MemberRow({
  workspace,
  member,
  meId,
  change,
}: {
  workspace: WorkspaceSummary
  member: WorkspaceMember
  meId: string
  change: Change
}) {
  const theme = useTheme()
  const api = useSession().client.workspace(workspace.id)
  const mine = member.id === meId
  const canSetRole = workspace.role === "owner" && !mine
  const canRemove =
    !mine &&
    member.role !== "owner" &&
    (workspace.role === "owner" || (workspace.role === "admin" && member.role === "member"))

  const setRole = (role: WorkspaceRole) => {
    if (role === member.role) return
    haptic.tap()
    void change(() => api.setRole(member.id, role))
  }
  const items: MenuItem[] = [
    ...(canSetRole
      ? [
          {
            title: "Role",
            inline: true,
            children: (["member", "admin"] as const).map((role) => ({
              title: ROLE_WORDS[role],
              checked: member.role === role,
              onPress: () => setRole(role),
            })),
          },
          {
            title: "Make owner",
            icon: "key" as const,
            onPress: async () => {
              const sure = await confirm({
                title: `Hand ${workspace.name} to ${member.name}?`,
                message: "You will become an admin.",
                action: "Hand it over",
                destructive: false,
              })
              if (sure) void change(() => api.setRole(member.id, "owner"))
            },
          },
        ]
      : []),
    ...(canRemove
      ? [
          {
            title: "Remove",
            icon: "trash" as const,
            destructive: true,
            onPress: async () => {
              const sure = await confirm({
                title: `Remove ${member.name} from ${workspace.name}?`,
                action: "Remove",
              })
              if (sure) void change(() => api.removeMember(member.id))
            },
          },
        ]
      : []),
  ]
  return (
    <Row
      lead={<Face person={member} size={34} />}
      title={mine ? `${member.name} (you)` : member.name}
      subtitle={member.email}
      tail={
        items.length === 0 ? (
          <Text tone="ink2">{ROLE_WORDS[member.role]}</Text>
        ) : (
          <Menu items={items} title={`Role of ${member.name}`}>
            <View
              accessibilityLabel={`Role of ${member.name}: ${ROLE_WORDS[member.role]}`}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 }}
            >
              <Text tone="ink2">{ROLE_WORDS[member.role]}</Text>
              <Icon name="chevronDown" size={9} color={theme.ink2} weight="bold" />
            </View>
          </Menu>
        )
      }
    />
  )
}

/**
 * Someone who was asked and has not answered. A link is only known when it is made: sending
 * again makes a new one, which is shown here to copy until the page is left.
 */
export function InvitationRow({
  workspace,
  invitation,
  admin,
  change,
}: {
  workspace: WorkspaceSummary
  invitation: Invitation
  admin: boolean
  change: Change
}) {
  const theme = useTheme()
  const queryClient = useQueryClient()
  const api = useSession().client.workspace(workspace.id)
  const [renewed, setRenewed] = useState<SentInvitation>()
  const refresh = () => queryClient.invalidateQueries({ queryKey: invitationsKey(workspace.id) })
  const address = invitation.email ?? `@${invitation.githubLogin}`
  const items: MenuItem[] = [
    ...(renewed === undefined
      ? [
          {
            title: invitation.email === null ? "New link" : "Send again",
            icon: "refresh" as const,
            onPress: () =>
              void change(async () => {
                setRenewed(await api.renewInvitation(invitation.id))
                await refresh()
              }),
          },
        ]
      : []),
    {
      title: "Withdraw",
      icon: "trash",
      destructive: true,
      onPress: async () => {
        const sure = await confirm({
          title: `Withdraw the invitation to ${address}?`,
          message: "Its link will stop working.",
          action: "Withdraw",
        })
        if (!sure) return
        void change(async () => {
          await api.withdrawInvitation(invitation.id)
          await refresh()
        })
      },
    },
  ]
  return (
    <Row
      icon={[invitation.email === null ? "person" : "mail", "#8b949a"]}
      title={address}
      subtitle={
        renewed !== undefined
          ? renewed.emailed
            ? "Sent again, with a new link."
            : "A new link was made. The old one no longer works."
          : `Invited by ${invitation.invitedBy.name} as ${
              invitation.role === "admin" ? "an admin" : "a member"
            } · good until ${day.format(invitation.expiresAt)}`
      }
      tail={
        admin ? (
          <>
            {renewed === undefined ? null : (
              <CopyLink link={renewed.link} label={`Copy the link for ${address}`} />
            )}
            <Menu items={items} title={address}>
              <View accessibilityLabel={`Invitation to ${address}`} style={{ padding: 6 }}>
                <Icon name="more" size={20} color={theme.ink2} weight="medium" />
              </View>
            </Menu>
          </>
        ) : undefined
      }
    />
  )
}
