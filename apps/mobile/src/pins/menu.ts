import { type LibraryListing, pinnedEntries } from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { Platform } from "react-native"
import { keys } from "@/lib/queries"
import { useSession } from "@/lib/use-session"
import type { MenuItem } from "@/ui"
import { pinnedMenuItems } from "./model"
import { usePins } from "./pins"

/**
 * What is pinned to a Dood, as a menu of its own in its chat's More, so that a pin opens from
 * the chat in two taps, as the web opens one beside the chat. Nothing when nothing is pinned. A
 * pin whose file is gone is there, and cannot be pressed.
 */
export function usePinnedMenu(agentId: string): MenuItem[] {
  const { client } = useSession()
  const router = useRouter()
  const pins = usePins(agentId)
  const some = pins !== undefined && pins.length > 0
  const listing = useQuery<LibraryListing>({
    queryKey: keys.library(agentId),
    queryFn: () => client.agent(agentId).libraryListing(),
    enabled: some,
  }).data
  if (!some || listing === undefined) return []
  return [
    {
      title: "Pinned",
      icon: "pin",
      children: pinnedMenuItems(pinnedEntries(pins, listing.files), Platform.OS === "ios", (file) =>
        router.push(`/a/${agentId}/library/${file.id}`),
      ),
    },
  ]
}
