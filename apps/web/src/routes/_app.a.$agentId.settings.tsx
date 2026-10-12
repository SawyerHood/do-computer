import { createFileRoute, redirect } from "@tanstack/react-router"
import { settingsAddress } from "@/lib/settings"

/** This page is now the first section of the settings, which open over the chat. */
export const Route = createFileRoute("/_app/a/$agentId/settings")({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/a/$agentId",
      params,
      search: { ...search, settings: settingsAddress({ at: "top", section: "general" }) },
      replace: true,
    })
  },
})
