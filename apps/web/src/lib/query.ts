import { ApiError } from "@do-computer/client"
import { QueryClient } from "@tanstack/react-query"

/** One client for the browser session; collections and queries share its cache. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Asked again once, unless the server said no: it would say no again.
      retry: (failures, error) =>
        failures < 1 && !(error instanceof ApiError && error.status < 500),
      refetchOnWindowFocus: false,
    },
  },
})
