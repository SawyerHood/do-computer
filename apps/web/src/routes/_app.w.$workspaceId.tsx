import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { AppShell } from "@/components/shell/app-shell"
import { AppSkeleton } from "@/components/shell/app-skeleton"
import { useWorkspaces } from "@/lib/workspaces"

export const Route = createFileRoute("/_app/w/$workspaceId")({ component: TeamLayout })

/** A team's own pages, framed like an agent's but with no agent open. */
function TeamLayout() {
  const { workspaceId } = Route.useParams()
  const state = useWorkspaces()
  // Which teams there are is not here yet: the frame holds its place.
  if (state === undefined) return <AppSkeleton />
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId)
  if (workspace === undefined || workspace.kind !== "team") {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-3 p-8">
        <h1 className="text-lg font-medium">This team could not be found</h1>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or you may no longer be in it.
        </p>
        <Link to="/" className="text-sm underline underline-offset-3">
          Back to your Doods
        </Link>
      </main>
    )
  }
  return (
    <AppShell workspaceId={workspace.id}>
      <Outlet />
    </AppShell>
  )
}
