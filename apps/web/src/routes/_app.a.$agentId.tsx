import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { useEffect } from "react"
import { AppShell } from "@/components/shell/app-shell"
import { client } from "@/lib/client"
import { agentKey, refreshAgent } from "@/lib/collections"

export const Route = createFileRoute("/_app/a/$agentId")({ component: AgentLayout })

/** Loads one agent, keeps it fresh from its event stream, and frames its pages. */
function AgentLayout() {
  const { agentId } = Route.useParams()
  const { data: state, error } = useQuery({
    queryKey: agentKey(agentId),
    queryFn: () => client.agent(agentId).state(),
  })

  useEffect(() => {
    const subscription = client.agent(agentId).watch((event) => {
      if (event.type === "changed") refreshAgent(agentId, event.what)
    })
    return () => subscription.close()
  }, [agentId])

  if (error) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-3 p-8">
        <h1 className="text-lg font-medium">This agent could not be loaded</h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        {/* It may have been deleted, or be in a team the user is no longer in. */}
        <Link to="/" className="text-sm underline underline-offset-3">
          Back to your agents
        </Link>
      </main>
    )
  }
  if (state === undefined) return null
  return (
    <AppShell agent={state.agent}>
      <Outlet />
    </AppShell>
  )
}
