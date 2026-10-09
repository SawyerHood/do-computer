import { ApiError } from "@durable-computer/client"
import type { AgentSummary } from "@durable-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { useEffect } from "react"
import { CreatureWindows } from "@/components/creature/windows"
import { AppShell } from "@/components/shell/app-shell"
import { mainChatOf, rememberMainChat } from "@/lib/chats"
import { client } from "@/lib/client"
import { agentQuery, refreshAgent } from "@/lib/collections"
import { useAgentFavicon } from "@/lib/favicon"
import { forgetLastAgent, rememberLastAgent } from "@/lib/last-agent"
import { queryClient } from "@/lib/query"
import { useListedAgent } from "@/lib/workspaces"

export const Route = createFileRoute("/_app/a/$agentId")({
  // Started and not waited for: the frame is drawn from what is already here. Pointing at a
  // link to the agent runs this too, so its state is often here by the time it is chosen.
  loader: ({ params }) => {
    void queryClient.prefetchQuery(agentQuery(params.agentId))
  },
  component: AgentLayout,
})

/** Loads one agent, keeps it fresh from its event stream, and frames its pages. */
function AgentLayout() {
  const { agentId } = Route.useParams()
  const { data: state, error } = useQuery(agentQuery(agentId))
  // The list of agents has its name, creature and color, and is here before its own state is.
  const listed = useListedAgent(agentId)

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

  // Kept, so that the next time the agent is chosen its main chat opens without asking which.
  const mainId = mainChatOf(state?.chats)?.id
  const failed = error !== null
  useEffect(() => {
    if (failed) rememberMainChat(agentId, undefined)
    else if (mainId !== undefined) rememberMainChat(agentId, mainId)
  }, [agentId, mainId, failed])

  // Kept too, so that the app opens on this agent the next time it is started. An agent the
  // server will not give, being deleted or in a team that was left, is not one to come back to.
  const loaded = state !== undefined
  const refused = error instanceof ApiError && error.status < 500
  useEffect(() => {
    if (refused) forgetLastAgent(agentId)
    else if (loaded && !failed) rememberLastAgent(agentId)
  }, [agentId, loaded, failed, refused])

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
  return <AgentPages agentId={agentId} agent={state?.agent ?? listed} />
}

function AgentPages({ agentId, agent }: { agentId: string; agent: AgentSummary | undefined }) {
  useAgentFavicon(agent)
  return (
    <AppShell agentId={agentId} agent={agent}>
      <Outlet />
      {agent === undefined ? null : <CreatureWindows agent={agent} />}
    </AppShell>
  )
}
