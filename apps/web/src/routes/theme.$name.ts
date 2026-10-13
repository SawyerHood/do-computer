import { createFileRoute } from "@tanstack/react-router"

/**
 * `GET /theme/<name>`: one of the app's typefaces, for a page of the library to be set in. Such
 * a page is kept apart from the app and has an origin that is nobody's, so it is sent the font
 * only from an address that says anyone may have it.
 */
export const Route = createFileRoute("/theme/$name")({
  server: {
    handlers: {
      GET: async ({ params }) => (await import("@/server/theme-fonts")).themeFont(params.name),
    },
  },
})
