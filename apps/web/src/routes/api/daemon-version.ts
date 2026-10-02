import { createFileRoute } from "@tanstack/react-router"
import { daemonVersion } from "@/server/daemon-download"

export const Route = createFileRoute("/api/daemon-version")({
  server: { handlers: { GET: () => daemonVersion() } },
})
