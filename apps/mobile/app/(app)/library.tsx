import type { LibraryFile } from "@durable-computer/protocol"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as DocumentPicker from "expo-document-picker"
import { useRouter } from "expo-router"
import { useState } from "react"
import { Pressable, View } from "react-native"
import { Icon } from "@/components/icons"
import { Screen } from "@/components/screen"
import { Button, Empty, ErrorText, Text } from "@/components/ui"
import { formatBytes, openLibraryFile } from "@/lib/files"
import { radius, space, useTheme } from "@/lib/theme"
import { keys, useAgent } from "@/lib/use-agent"
import { useSession } from "@/lib/use-session"

const date = (at: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at))

function FileRow({ agentId, file }: { agentId: string; file: LibraryFile }) {
  const theme = useTheme()
  const router = useRouter()
  const session = useSession()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string>()
  const remove = useMutation({
    mutationFn: () => session.client.agent(agentId).removeLibraryFile(file.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.library(agentId) }),
  })
  return (
    <View accessibilityLabel={file.name} style={{ gap: space(1) }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space(3),
          padding: space(3.5),
          borderRadius: radius.md,
          backgroundColor: theme.surface,
        }}
      >
        <Pressable
          style={{ flex: 1 }}
          accessibilityRole="button"
          accessibilityLabel={`Open ${file.name}`}
          onPress={() =>
            openLibraryFile(session, agentId, file).catch((caught) =>
              setError(String(caught?.message ?? caught)),
            )
          }
        >
          <Text weight="500" numberOfLines={1}>
            {file.name}
          </Text>
          <Text tone="muted" size={12}>
            {formatBytes(file.size)} ·{" "}
            {file.source === "agent" ? "from your agent" : "uploaded by you"} ·{" "}
            {date(file.createdAt)}
          </Text>
        </Pressable>
        {file.chatId ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Chat for ${file.name}`}
            hitSlop={8}
            onPress={() => router.push(`/chat/${file.chatId}`)}
          >
            <Icon.chat color={theme.muted} size={20} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${file.name}`}
          hitSlop={8}
          disabled={remove.isPending}
          onPress={() => remove.mutate()}
        >
          <Icon.trash color={theme.muted} />
        </Pressable>
      </View>
      <ErrorText>{error}</ErrorText>
    </View>
  )
}

/** Files the agent has delivered, and files the user has given it. */
export default function Library() {
  const { agentId } = useAgent()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const files = useQuery({
    queryKey: keys.library(agentId ?? ""),
    queryFn: () => client.agent(agentId!).library(),
    enabled: agentId !== undefined,
  })
  const upload = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
      const asset = picked.assets?.[0]
      if (picked.canceled || asset === undefined) return
      // A picked file is a local URI on a device and a blob in a browser; both can be fetched.
      const body = await (await fetch(asset.uri)).blob()
      await client.agent(agentId!).upload({ name: asset.name, type: asset.mimeType ?? "", body })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.library(agentId!) }),
  })
  return (
    <Screen
      title="Library"
      subtitle="Files your agent has made for you, and files you have given it."
      action={
        <Button
          variant="outline"
          label="Upload"
          busy={upload.isPending}
          onPress={() => upload.mutate()}
        />
      }
    >
      <ErrorText>{upload.error?.message}</ErrorText>
      {files.data?.length === 0 ? (
        <Empty>Nothing here yet. Ask your agent to make you something.</Empty>
      ) : null}
      {(files.data ?? []).map((file) => (
        <FileRow key={file.id} agentId={agentId!} file={file} />
      ))}
    </Screen>
  )
}
