import { sentFiles } from "@durable-computer/protocol"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useAgentPage } from "@/agent/agent"
import { MainChatLive } from "@/agent/main-chat"
import { formatBytes } from "@/lib/files"
import { Empty, Row, Screen, Section } from "@/ui"

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })

/**
 * The files the agent sent in its main chat, newest first, so that one can be found without
 * scrolling back to where it was sent. Each opens as a document of the library.
 */
export default function SharedHere() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const router = useRouter()
  const { name } = useAgentPage(agentId)
  return (
    <Screen>
      <Stack.Screen options={{ title: "Shared here" }} />
      <MainChatLive agentId={agentId}>
        {(state) => {
          const files = sentFiles(state)
          if (files.length === 0) {
            return (
              <Empty title="Nothing yet.">
                {`When ${name} sends a file in the main chat, it is kept here.`}
              </Empty>
            )
          }
          return (
            <Section
              footer={`${files.length} ${files.length === 1 ? "file" : "files"} sent in the main chat.`}
            >
              {files.map((file) => (
                <Row
                  key={file.id}
                  icon={["doc", "#8a6fd1"]}
                  title={file.name}
                  subtitle={`${formatBytes(file.size)} · ${day.format(file.updatedAt)}`}
                  go
                  accessibilityLabel={`Open ${file.name}`}
                  onPress={() =>
                    router.push(`/a/${agentId}/library/${encodeURIComponent(file.id)}`)
                  }
                />
              ))}
            </Section>
          )
        }}
      </MainChatLive>
    </Screen>
  )
}
