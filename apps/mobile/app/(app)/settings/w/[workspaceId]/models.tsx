import { useLocalSearchParams } from "expo-router"
import { ModelsPage } from "@/models/pages"

/** What a workspace's agents can run on, and its sign-ins to model providers. */
export default function WorkspaceModels() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  return <ModelsPage workspaceId={workspaceId} />
}
