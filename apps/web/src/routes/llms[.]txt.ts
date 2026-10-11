import { createFileRoute } from "@tanstack/react-router"

/** `GET /llms.txt`: where an agent finds the guides, each as Markdown. */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/server/docs")).llmsTxt(request),
    },
  },
})
