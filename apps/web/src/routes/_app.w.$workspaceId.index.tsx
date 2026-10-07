import { PlusIcon, UserPlusIcon } from "@phosphor-icons/react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useState } from "react"
import { WorkspaceTile } from "@/components/people"
import { useNewAgent } from "@/components/shell/agent-list"
import { InviteDialog } from "@/components/team/invite"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { useWorkspace } from "@/lib/workspaces"

/**
 * A team has no page of its own: opening one goes to its first agent, where the sidebar lists the
 * rest. Only a team with no agents yet stops here, to make its first.
 */
export const Route = createFileRoute("/_app/w/$workspaceId/")({
  beforeLoad: async ({ params, search }) => {
    const agents = await client.listAgents()
    const first = agents
      .filter((agent) => agent.workspaceId === params.workspaceId)
      .sort((a, b) => a.createdAt - b.createdAt)[0]
    if (first !== undefined) {
      throw redirect({ to: "/a/$agentId", params: { agentId: first.id }, search, replace: true })
    }
  },
  component: EmptyTeam,
})

function EmptyTeam() {
  const { workspaceId } = Route.useParams()
  const workspace = useWorkspace(workspaceId)
  const newAgent = useNewAgent(workspaceId)
  const [inviting, setInviting] = useState(false)
  if (workspace === undefined) return null
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <WorkspaceTile workspace={workspace} className="size-14" />
        <h1 className="text-xl font-semibold tracking-tight">{workspace.name}</h1>
        <p className="text-sm font-medium text-muted-foreground">
          {workspace.members.length} {workspace.members.length === 1 ? "person" : "people"} · 0
          agents
        </p>
        <p className="text-sm text-muted-foreground">
          This team has no agents yet. Everyone in it can use the ones made here, and read their
          chats.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button onClick={() => void newAgent()}>
            <PlusIcon /> New agent for the team
          </Button>
          {workspace.role === "member" ? null : (
            <Button variant="outline" onClick={() => setInviting(true)}>
              <UserPlusIcon /> Invite people
            </Button>
          )}
        </div>
      </div>
      <InviteDialog workspace={workspace} open={inviting} onOpenChange={setInviting} />
    </div>
  )
}
