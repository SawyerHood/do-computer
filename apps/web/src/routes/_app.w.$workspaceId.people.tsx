import { createFileRoute, redirect } from "@tanstack/react-router"

/** A team's people are now a section of its settings. */
export const Route = createFileRoute("/_app/w/$workspaceId/people")({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/w/$workspaceId",
      params,
      search: { ...search, workspace: "team" },
      replace: true,
    })
  },
})
