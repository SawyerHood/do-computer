import { createFileRoute, redirect } from "@tanstack/react-router"
import { settingsAddress } from "@/lib/settings"

/** This page is now a section of the agent's settings, which open over the chat. */
export const Route = createFileRoute("/_app/a/$agentId/connectors")({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/a/$agentId",
      params,
      search: {
        ...search,
        settings: settingsAddress({ at: "agent", agentId: params.agentId, section: "connectors" }),
      },
      replace: true,
    })
  },
})
