import { createFileRoute } from "@tanstack/react-router"
import { getAuth } from "@/server/auth"

const handle = async ({ request }: { request: Request }) => (await getAuth()).handler(request)

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
})
