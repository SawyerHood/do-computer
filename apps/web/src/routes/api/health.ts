import { createFileRoute } from "@tanstack/react-router"
import { getPlatform } from "#platform"

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const platform = getPlatform()
        const row = await platform.db.get<{ ok: number }>("SELECT 1 AS ok")
        return Response.json({ ok: row?.ok === 1, target: platform.target })
      },
    },
  },
})
