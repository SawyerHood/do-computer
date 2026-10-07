import { createFileRoute } from "@tanstack/react-router"
import { viewLibraryFile } from "@/server/agents"

/** `GET /d/:agent/:view/<path>`: a library file served as a page, with what it links to beside it. */
export const Route = createFileRoute("/d/$agentId/$")({
  server: {
    handlers: {
      GET: ({ request, params }: { request: Request; params: { agentId: string } }) =>
        viewLibraryFile(request, params.agentId),
    },
  },
})
