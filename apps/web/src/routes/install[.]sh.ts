import { createFileRoute } from "@tanstack/react-router"
import { installScript } from "@/server/daemon-download"

export const Route = createFileRoute("/install.sh")({
  server: { handlers: { GET: ({ request }) => installScript(request) } },
})
