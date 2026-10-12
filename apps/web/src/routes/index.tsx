import { ApiError, type Me } from "@do-computer/client"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { createIsomorphicFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { Landing } from "@/components/landing/landing"
import { AppSkeleton } from "@/components/shell/app-skeleton"
import { agentsQuery, listedAgents, meKey, meQuery } from "@/lib/collections"
import { desktop } from "@/lib/desktop"
import { frontDoor } from "@/lib/front-door"
import { comingBackTo, lastAgent } from "@/lib/last-agent"
import { queryClient } from "@/lib/query"
import { workspacesQuery } from "@/lib/workspaces"

/**
 * Whether the visitor's own browser is left to say what this page is. It is for someone with a
 * session, whose pages are drawn from what is theirs alone, and for the desktop app, which is
 * never shown the landing page. Anyone else is a stranger, and gets the page whole.
 */
const leftToBrowser = createIsomorphicFn()
  .server(
    () =>
      /session_token=/.test(getRequestHeader("cookie") ?? "") ||
      /\bElectron\//.test(getRequestHeader("user-agent") ?? ""),
  )
  .client(() => true)

/** Whether someone is signed in. Only a browser can say: see `leftToBrowser`. */
async function signedIn(): Promise<boolean> {
  if (typeof window === "undefined") return false
  // Someone who has had an agent open here is most likely still signed in: the lists the frame
  // shows are asked for together with who they are, and not after.
  if (queryClient.getQueryData(meKey) === undefined && lastAgent() !== undefined) {
    void queryClient.prefetchQuery(agentsQuery)
    void queryClient.prefetchQuery(workspacesQuery)
  }
  try {
    await queryClient.ensureQueryData(meQuery)
    return true
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false
    throw error
  }
}

/**
 * Land on the agent that was open here last, whichever workspace it is in. Where none was, or
 * it is no longer the user's to open, on their first agent. Someone who has none yet is sent to
 * meet one.
 */
async function goHome(): Promise<never> {
  // Someone on the waiting list has only the first run to go to, where their Dood is. So has
  // someone let in since they last came, whose Dood becomes their agent there.
  const me = queryClient.getQueryData<Me>(meKey)
  if (me?.waiting || me?.dood !== undefined) throw redirect({ to: "/welcome", replace: true })
  const last = lastAgent()
  // This is where the desktop app starts, every time. The agent it was left on is gone to
  // without waiting for the list, which takes as long as the slowest agent takes to answer.
  // An agent that turns out to be gone sends the visitor back here, with nothing kept.
  const listed = queryClient.getQueryData(agentsQuery.queryKey)
  if (last !== undefined && (listed === undefined || listed.some((agent) => agent.id === last))) {
    comingBackTo(last)
    throw redirect({ to: "/a/$agentId", params: { agentId: last }, replace: true })
  }
  // The list the sidebar shows, asked for again only if it is no longer good.
  const agents = await listedAgents()
  const agent = agents.find((candidate) => candidate.id === last) ?? agents[0]
  // Someone with no agent is new here: their first is met, and named, in the first run.
  if (agent === undefined) throw redirect({ to: "/welcome", replace: true })
  throw redirect({ to: "/a/$agentId", params: { agentId: agent.id } })
}

/**
 * The deployment's own address. Someone signed in is taken to their agent. Anyone else is shown
 * the landing page where the deployment has one (`DC_LANDING=1`), sent with the page itself so
 * that it is there before any script is, and the sign-in form where it has not.
 */
export const Route = createFileRoute("/")({
  ssr: () => !leftToBrowser(),
  beforeLoad: async () => {
    if (await signedIn()) await goHome()
    const door = await frontDoor()
    if (!door.landing || desktop() !== undefined) throw redirect({ to: "/login" })
    return { door }
  },
  loader: ({ context }) => context.door,
  head: () => ({
    meta: [
      {
        name: "description",
        content:
          "Meet your Dood: an open source personal assistant with a name, a memory and a computer of its own, which keeps working after you close the tab.",
      },
    ],
  }),
  component: LandingPage,
  // What someone signed in sees until their agent's page takes its place.
  pendingComponent: AppSkeleton,
  pendingMs: 0,
})

function LandingPage() {
  const door = Route.useLoaderData()
  return <Landing open={door.open} waitlist={door.signup === "waitlist"} />
}
