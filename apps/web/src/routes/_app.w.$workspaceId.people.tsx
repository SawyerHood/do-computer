import { createFileRoute, redirect } from "@tanstack/react-router"
import { settingsAddress } from "@/lib/settings"

/** A team's people are now a section of its settings. */
export const Route = createFileRoute("/_app/w/$workspaceId/people")({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/w/$workspaceId",
      params,
      search: {
        ...search,
        settings: settingsAddress({
          at: "workspace",
          workspaceId: params.workspaceId,
          section: "people",
        }),
      },
      replace: true,
    })
  },
})
