import { ApiError } from "@do-computer/client"
import type { AgentSummary } from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { useEffect } from "react"
import { CreatureWindows } from "@/components/creature/windows"
import { AppShell } from "@/components/shell/app-shell"
import { useAppIcon } from "@/lib/app-icon"
import { keepChat, mainChatOf, rememberMainChat } from "@/lib/chats"
import { client } from "@/lib/client"
import { agentQuery, catchUpAgent, refreshAgent } from "@/lib/collections"
import { useAgentFavicon } from "@/lib/favicon"
import { cameBackUnasked, forgetLastAgent, rememberLastAgent } from "@/lib/last-agent"
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
    // The stream tells of what changes while it is connected. Each time it connects, what
    // changed before that is asked for, the first time as much as after it was down: a page
    // that opens as something changes has asked too soon to see it and too late to be told.
    let back = false
    const subscription = client.agent(agentId).watch((event) => {
      if (event.type === "changed") refreshAgent(agentId, event.what)
      if (event.type === "ready") {
        catchUpAgent(agentId, back)
        back = true
      }
    })
    return () => subscription.close()
  }, [agentId])

  // An agent that was opened at one of its pages, and not by being chosen, may not have been
  // given its main chat yet. Its pages tell the main chat from the others, so it is given now.
  const mainless = state !== undefined && mainChatOf(state.chats) === undefined
  useEffect(() => {
    if (!mainless) return
    void client
      .agent(agentId)
      .mainChat()
      // What came back is the chat, so it is among the agent's chats at once, and opened. The
      // agent is asked again as well, and nothing waits for that.
      .then((chat) => {
        keepChat(agentId, chat)
        refreshAgent(agentId, "chats")
      })
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
  // A session that has ended is refused too, and is sent to sign in, not to another agent.
  const gone = refused && error.status !== 401
  const navigate = Route.useNavigate()
  useEffect(() => {
    if (refused) {
      forgetLastAgent(agentId)
      // The app comes to the agent it kept without asking whether it is still there. One that
      // is not is left for wherever the app opens with nothing kept.
      if (gone && cameBackUnasked(agentId)) void navigate({ to: "/", replace: true })
    } else if (loaded && !failed) rememberLastAgent(agentId)
  }, [agentId, loaded, failed, refused, gone, navigate])

  if (error) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-3 p-8">
        <h1 className="text-lg font-medium">This Dood could not be loaded</h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        {/* It may have been deleted, or be in a team the user is no longer in. */}
        <Link to="/" className="text-sm underline underline-offset-3">
          Back to your Doods
        </Link>
      </main>
    )
  }
  return <AgentPages agentId={agentId} agent={state?.agent ?? listed} />
}

function AgentPages({ agentId, agent }: { agentId: string; agent: AgentSummary | undefined }) {
  useAgentFavicon(agent)
  useAppIcon(agent)
  return (
    <AppShell agentId={agentId} agent={agent}>
      <Outlet />
      {agent === undefined ? null : <CreatureWindows agent={agent} />}
    </AppShell>
  )
}
