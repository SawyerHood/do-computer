import { ApiError } from "@durable-computer/client"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { FaceStack, names, WorkspaceTile } from "@/components/people"
import { Button, buttonVariants } from "@/components/ui/button"
import { client } from "@/lib/client"
import { cn } from "@/lib/utils"
import { refreshWorkspaces } from "@/lib/workspaces"

/** An invitation to a team, for whoever holds its link. Seen before signing in, and answered after. */
export const Route = createFileRoute("/invite/$token")({ ssr: false, component: InvitationPage })

function InvitationPage() {
  const { token } = Route.useParams()
  const navigate = useNavigate()
  const { data: invitation, error } = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => client.invitation(token),
    retry: false,
  })
  // Whether anyone is signed in decides what the button does.
  const { data: me, isFetched } = useQuery({
    queryKey: ["invitation-me"],
    queryFn: () => client.me().catch(() => null),
    retry: false,
  })
  const [joining, setJoining] = useState(false)
  const [failure, setFailure] = useState<string>()

  if (error) {
    return (
      <main className="flex h-dvh items-center justify-center p-6">
        <div className="flex max-w-sm flex-col gap-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            This invitation is no longer good
          </h1>
          <p className="text-sm text-muted-foreground">
            {error instanceof ApiError && error.status === 404
              ? "It may have been used, withdrawn, or have run out. Ask whoever sent it for a new one."
              : error.message}
          </p>
          <a href="/" className="mt-2 text-sm underline underline-offset-3">
            Go to Do Computer
          </a>
        </div>
      </main>
    )
  }
  if (invitation === undefined || !isFetched) return null

  const here = `/invite/${encodeURIComponent(token)}`
  const join = async () => {
    setJoining(true)
    setFailure(undefined)
    try {
      const { workspaceId } = await client.acceptInvitation(token)
      refreshWorkspaces()
      await navigate({ to: "/w/$workspaceId", params: { workspaceId } })
    } catch (problem) {
      setFailure(problem instanceof Error ? problem.message : "That did not work. Try again.")
      setJoining(false)
    }
  }
  const decline = async () => {
    // Only an invitation addressed to this account can be turned down. A link is just left alone.
    await client.declineInvitation(invitation.id).catch(() => {})
    refreshWorkspaces()
    await navigate({ to: "/" })
  }
  const team = invitation.workspace.name

  return (
    <main className="flex min-h-dvh items-center justify-center bg-rail p-6">
      <div className="flex w-full max-w-md flex-col items-center rounded-2xl border bg-background px-8 pt-9 pb-7 text-center">
        <WorkspaceTile workspace={invitation.workspace} className="size-14" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          {invitation.invitedBy.name} invited you to {team}
        </h1>
        {invitation.note ? (
          <p className="mt-1.5 text-sm text-muted-foreground">“{invitation.note}”</p>
        ) : null}
        {invitation.agents.length === 0 ? null : (
          <ul aria-label={`${team}'s agents`} className="mt-6 flex flex-wrap justify-center gap-5">
            {invitation.agents.slice(0, 4).map((agent) => (
              <li key={agent.id} className="flex flex-col items-center gap-1.5 text-sm font-medium">
                <AgentAvatar
                  avatar={agent.avatar}
                  seed={agent.id}
                  hatched={agent.hatched}
                  quiet
                  className="size-20"
                />
                {agent.name ?? "New agent"}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <FaceStack people={invitation.members} className="size-5" />
          {invitation.agents.length === 0
            ? `${names(invitation.members)} ${invitation.members.length === 1 ? "is" : "are"} in it`
            : `You would share ${invitation.agents.length === 1 ? "this agent and its" : "these agents and their"} chats with ${names(invitation.members)}`}
        </p>
        {failure ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {failure}
          </p>
        ) : null}
        {me ? (
          <>
            <Button className="mt-6 h-11 w-full" disabled={joining} onClick={join}>
              {joining ? "Joining…" : `Join ${team}`}
            </Button>
            <Button variant="ghost" className="mt-1 w-full text-muted-foreground" onClick={decline}>
              Not now
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">Signed in as {me.user.email}.</p>
          </>
        ) : (
          <>
            {/* Links, which is what they are: each leads to another page and back here. */}
            <a
              href={`/login?next=${encodeURIComponent(here)}`}
              className={cn(buttonVariants(), "mt-6 h-11 w-full")}
            >
              Sign in to join
            </a>
            <a
              href={`/signup?next=${encodeURIComponent(here)}`}
              className={cn(buttonVariants({ variant: "ghost" }), "mt-1 w-full")}
            >
              Create an account
            </a>
          </>
        )}
      </div>
    </main>
  )
}
