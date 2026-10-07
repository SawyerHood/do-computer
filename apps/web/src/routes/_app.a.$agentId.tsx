import type { AgentSummary } from "@durable-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { useEffect } from "react"
import { AppShell } from "@/components/shell/app-shell"
import { mainChatOf } from "@/lib/chats"
import { client } from "@/lib/client"
import { agentKey, refreshAgent } from "@/lib/collections"
import { useAgentFavicon } from "@/lib/favicon"

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

  // An agent that was opened at one of its pages, and not by being chosen, may not have been
  // given its main chat yet. Its pages tell the main chat from the side chats, so it is given now.
  const mainless = state !== undefined && mainChatOf(state.chats) === undefined
  useEffect(() => {
    if (!mainless) return
    void client
      .agent(agentId)
      .mainChat()
      .then(() => refreshAgent(agentId, "chats"))
      // It is asked for again the next time the agent is opened.
      .catch(() => {})
  }, [agentId, mainless])

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
  return <AgentPages agent={state.agent} />
}

function AgentPages({ agent }: { agent: AgentSummary }) {
  useAgentFavicon(agent)
  return (
    <AppShell agent={agent}>
      <Outlet />
    </AppShell>
  )
}
