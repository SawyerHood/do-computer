import { createFileRoute, redirect } from "@tanstack/react-router"
import { settingsAddress } from "@/lib/settings"

/** This page is now a section of the settings of the agent's workspace, which open over the chat. */
export const Route = createFileRoute("/_app/a/$agentId/computers")({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/a/$agentId",
      params,
      search: { ...search, settings: settingsAddress({ at: "workspace", section: "computers" }) },
      replace: true,
    })
  },
})
