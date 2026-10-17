import { useLocalSearchParams } from "expo-router"
import { CallScreen } from "@/call/call-screen"

/** A call with a Dood, over everything. Swiped down, the call goes on. */
export default function Call() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  return <CallScreen agentId={agentId} />
}
