import { QueryClient } from "@tanstack/react-query"

/** One client for the browser session; collections and queries share its cache. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})
