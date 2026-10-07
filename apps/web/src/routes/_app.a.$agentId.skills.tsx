import { createFileRoute, redirect } from "@tanstack/react-router"

/** This page is now a section of the agent's settings, which open over the chat. */
export const Route = createFileRoute("/_app/a/$agentId/skills")({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/a/$agentId",
      params,
      search: { ...search, settings: "skills" },
      replace: true,
    })
  },
})
