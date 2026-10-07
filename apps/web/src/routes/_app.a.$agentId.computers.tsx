import { createFileRoute, redirect } from "@tanstack/react-router"

/** This page is now a section of the workspace's settings, which open over the chat. */
export const Route = createFileRoute("/_app/a/$agentId/computers")({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/a/$agentId",
      params,
      search: { ...search, workspace: "computers" },
      replace: true,
    })
  },
})
