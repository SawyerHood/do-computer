import { ApiError } from "@durable-computer/client"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { client } from "@/lib/client"

/** Everything behind sign-in. Rendered in the browser only: its data is the user's own. */
export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async () => {
    try {
      return { me: await client.me() }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw redirect({ to: "/login" })
      throw error
    }
  },
  component: Outlet,
  pendingComponent: () => null,
})
