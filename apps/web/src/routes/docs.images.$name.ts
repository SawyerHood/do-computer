import { createFileRoute } from "@tanstack/react-router"

/**
 * `GET /docs/images/<name>`: a picture in a guide, where the guide's own file says it is. The
 * page at `/docs/<name>` shows its pictures without coming here.
 */
export const Route = createFileRoute("/docs/images/$name")({
  server: {
    handlers: {
      GET: async ({ params }) => (await import("@/server/docs")).guidePicture(params.name),
    },
  },
})
