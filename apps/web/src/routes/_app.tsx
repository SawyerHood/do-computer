import { ApiError } from "@durable-computer/client"
import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router"
import { useEffect } from "react"
import { AppSkeleton } from "@/components/shell/app-skeleton"
import { agentQuery, agentsQuery, meKey, meQuery } from "@/lib/collections"
import { syncNotifications } from "@/lib/notifications"
import { queryClient } from "@/lib/query"
import { validateAppSearch } from "@/lib/settings"
import { warmChat } from "@/lib/use-live-chat"
import { workspacesQuery } from "@/lib/workspaces"

/**
 * What the first page is drawn from, asked for together with who is signed in and not after:
 * the lists the frame shows and, on an agent's page, the agent and the chat that is open.
 */
function fetchAhead(params: { agentId?: string; chatId?: string }): void {
  void queryClient.prefetchQuery(agentsQuery)
  void queryClient.prefetchQuery(workspacesQuery)
  if (params.agentId === undefined) return
  void queryClient.prefetchQuery(agentQuery(params.agentId))
  if (params.chatId !== undefined) warmChat(params.agentId, params.chatId)
}

/** Everything behind sign-in. Rendered in the browser only: its data is the user's own. */
export const Route = createFileRoute("/_app")({
  ssr: false,
  validateSearch: validateAppSearch,
  // This runs on every move from one page to another. Who is signed in is asked the first
  // time and kept, so that no move after it waits for the server before anything changes.
  beforeLoad: async ({ matches }) => {
    if (queryClient.getQueryData(meKey) === undefined) fetchAhead(matches.at(-1)?.params ?? {})
    try {
      return { me: await queryClient.ensureQueryData(meQuery) }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw redirect({ to: "/login" })
      throw error
    }
  },
  component: SignedIn,
  // Sent with the page itself, so the frame is on screen before anything has been asked for.
  pendingComponent: AppSkeleton,
  pendingMs: 0,
})

/**
 * The pages behind sign-in. A session that ends while one is open is found out by the next
 * thing asked for, which is refused. The page is then loaded again at the sign-in, so that
 * nothing of the session is left in it. Being signed in is also when the browser is set up to
 * be notified.
 */
function SignedIn() {
  useEffect(() => {
    const refused = (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) window.location.assign("/login")
    }
    const queries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") refused(event.action.error)
    })
    const mutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") refused(event.action.error)
    })
    return () => {
      queries()
      mutations()
    }
  }, [])
  const router = useRouter()
  useEffect(() => {
    void syncNotifications()
    if (!("serviceWorker" in navigator)) return
    // A notification was tapped while the app was open: the service worker says which page it
    // was about.
    const opened = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; path?: unknown } | null
      if (data?.type !== "dc-open" || typeof data.path !== "string") return
      router.history.push(data.path)
    }
    navigator.serviceWorker.addEventListener("message", opened)
    return () => navigator.serviceWorker.removeEventListener("message", opened)
  }, [router])
  return <Outlet />
}
