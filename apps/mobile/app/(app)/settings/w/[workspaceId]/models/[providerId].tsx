import { useLocalSearchParams } from "expo-router"
import { ProviderPage } from "@/models/pages"

/**
 * One model provider, for a workspace or (where the workspace in the address is `deployment`)
 * for the server itself: how it is signed in to, or the ways of signing in.
 */
export default function Provider() {
  const { workspaceId, providerId } = useLocalSearchParams<{
    workspaceId: string
    providerId: string
  }>()
  return <ProviderPage workspaceId={workspaceId} providerId={providerId} />
}
