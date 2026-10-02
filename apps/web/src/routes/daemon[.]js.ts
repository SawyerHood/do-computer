import { createFileRoute } from "@tanstack/react-router"
import { daemonBundle } from "@/server/daemon-download"

export const Route = createFileRoute("/daemon.js")({
  server: { handlers: { GET: () => daemonBundle() } },
})
