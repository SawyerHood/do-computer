import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    // Pointing at a link starts what its page needs. What is fetched is kept by the query
    // client, which is what says how long it is good for, so the router keeps none of it.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // A placeholder is taken down the moment what it stands for is here.
    defaultPendingMinMs: 0,
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
