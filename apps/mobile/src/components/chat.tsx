import {
  chatActivity,
  type ChatMessage,
  type ChatState,
  isSentFile,
  isShownPart,
  isVisibleMessage,
  type LibraryFile,
  type MessagePart,
} from "@durable-computer/protocol"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native"
import { Icon } from "@/components/icons"
import { Markdown } from "@/components/markdown"
import { ErrorText, Text } from "@/components/ui"
import { formatBytes, openLibraryFile } from "@/lib/files"
import { radius, space, useTheme } from "@/lib/theme"
import { useDictation } from "@/lib/use-dictation"
import { useSession } from "@/lib/use-session"

function FileCard({ agentId, file }: { agentId: string; file: LibraryFile }) {
  const theme = useTheme()
  const session = useSession()
  const [error, setError] = useState<string>()
  return (
    <View style={{ gap: space(1) }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${file.name}`}
        onPress={() =>
          openLibraryFile(session, agentId, file).catch((caught) =>
            setError(String(caught?.message ?? caught)),
          )
        }
        style={[styles.file, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <Icon.file color={theme.muted} />
        <View style={{ flexShrink: 1 }}>
          <Text weight="500" numberOfLines={1}>
            {file.name}
          </Text>
          <Text tone="muted" size={12}>
            {formatBytes(file.size)}
          </Text>
        </View>
        <Icon.download color={theme.muted} size={18} />
      </Pressable>
      <ErrorText>{error}</ErrorText>
    </View>
  )
}

function Part({ part, agentId }: { part: MessagePart; agentId: string }) {
  const theme = useTheme()
  // The one tool call that is shown: a file the agent delivered, as the file.
  if (isSentFile(part)) {
    return <FileCard agentId={agentId} file={part.details as unknown as LibraryFile} />
  }
  switch (part.type) {
    case "text":
      return (
        <View style={[styles.bubble, { backgroundColor: theme.surface, alignSelf: "flex-start" }]}>
          <Markdown text={part.text} color={theme.ink} />
        </View>
      )
    case "notice":
      return (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space(2),
            paddingHorizontal: space(1),
          }}
        >
          <Icon.clock color={theme.muted} size={16} />
          <Text tone="muted" size={14}>
            Scheduled: {part.text}
          </Text>
        </View>
      )
    default:
      return null
  }
}

function Message({ message, agentId }: { message: ChatMessage; agentId: string }) {
  const theme = useTheme()
  if (message.role === "notice") {
    return (
      <Text tone="muted" size={13} style={{ textAlign: "center" }}>
        {message.parts[0]?.type === "notice" && message.parts[0].kind === "compaction"
          ? "Earlier messages were summarized"
          : "New context"}
      </Text>
    )
  }
  if (message.role === "user") {
    return (
      <View style={{ alignItems: "flex-end", gap: space(1.5) }}>
        {message.parts.map((part, index) =>
          part.type === "text" ? (
            <View key={index} style={[styles.bubble, { backgroundColor: theme.primary }]}>
              <Text tone="onPrimary" size={15.5}>
                {part.text}
              </Text>
            </View>
          ) : null,
        )}
      </View>
    )
  }
  return (
    <View style={{ gap: space(2) }}>
      {message.parts.filter(isShownPart).map((part, index) => (
        <Part key={part.type === "tool" ? part.toolCallId : index} part={part} agentId={agentId} />
      ))}
      {message.status === "error" ? (
        <ErrorText>{message.error ?? "Something went wrong generating this reply."}</ErrorText>
      ) : null}
      {message.status === "aborted" ? (
        <Text tone="muted" size={13}>
          Stopped
        </Text>
      ) : null}
    </View>
  )
}

/** The messages of a chat, kept scrolled to the newest while the reader is at the end. */
export function Transcript({
  state,
  agentId,
  empty,
  header,
}: {
  state: ChatState
  agentId: string
  empty: React.ReactNode
  /** Shown above the first message, for reaching what came before it. */
  header?: React.ReactElement | null
}) {
  const theme = useTheme()
  const list = useRef<FlatList<ChatMessage>>(null)
  const last = state.messages.at(-1)
  // What the agent is doing, when its answer is not already being written on screen. Tool calls
  // and thinking are this one line while they happen, and nothing afterwards.
  const activity = chatActivity(state)
  const messages = useMemo(() => state.messages.filter(isVisibleMessage), [state.messages])
  // Follow new content at the end. Earlier messages arriving at the top change the first message
  // and not the last, and must not pull the reader back down.
  const firstId = state.messages[0]?.id
  const seenFirst = useRef(firstId)
  useEffect(() => {
    list.current?.scrollToEnd({ animated: true })
  }, [last?.id, last?.parts.length, last?.status, activity])
  return (
    <FlatList
      ref={list}
      accessibilityRole="list"
      accessibilityLabel="Messages"
      data={messages}
      keyExtractor={(message) => message.id}
      renderItem={({ item }) => <Message message={item} agentId={agentId} />}
      // A short chat sits at the bottom, next to the box the next message is typed in.
      contentContainerStyle={{
        padding: space(4),
        gap: space(4),
        flexGrow: 1,
        justifyContent: "flex-end",
      }}
      ListEmptyComponent={state.busy ? null : <>{empty}</>}
      ListHeaderComponent={header}
      ListFooterComponent={
        activity === null ? null : (
          <View
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}
          >
            <ActivityIndicator size="small" color={theme.muted} />
            <Text tone="muted" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
              {activity}…
            </Text>
          </View>
        )
      }
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => {
        const prepended = seenFirst.current !== undefined && seenFirst.current !== firstId
        seenFirst.current = firstId
        if (!prepended) list.current?.scrollToEnd({ animated: false })
      }}
    />
  )
}

/** The message box: type or dictate, send; while the agent works, an empty box offers Stop. */
export function Composer({
  placeholder,
  busy,
  queued,
  onSend,
  onStop,
  onType,
}: {
  placeholder: string
  busy: boolean
  queued: ChatState["queued"]
  onSend: (text: string) => void
  onStop: () => void
  /** Told of each change to what is being typed, so the agent's creature can listen. */
  onType?: () => void
}) {
  const theme = useTheme()
  const [draft, setDraft] = useState("")
  const dictation = useDictation((text) =>
    setDraft((current) => (current.trim() === "" ? text : `${current.trimEnd()} ${text}`)),
  )
  const send = () => {
    const text = draft.trim()
    if (text === "") return
    onSend(text)
    setDraft("")
  }
  const empty = draft.trim() === ""
  return (
    <View style={{ paddingHorizontal: space(3), paddingBottom: space(2), gap: space(1.5) }}>
      {queued.map((item) => (
        <Text
          key={item.id}
          tone="muted"
          size={13}
          numberOfLines={1}
          style={{ alignSelf: "flex-end" }}
        >
          Queued: {item.text}
        </Text>
      ))}
      <View
        style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <TextInput
          accessibilityLabel="Message"
          value={draft}
          onChangeText={(text) => {
            setDraft(text)
            if (text !== "") onType?.()
          }}
          placeholder={placeholder}
          placeholderTextColor={theme.muted}
          multiline
          style={[styles.input, { color: theme.ink }]}
          // On web, Enter sends and Shift+Enter adds a line, as in the web app.
          onKeyPress={(event) => {
            const key = event.nativeEvent as unknown as { key: string; shiftKey?: boolean }
            if (Platform.OS === "web" && key.key === "Enter" && !key.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dictation.state === "recording" ? "Stop dictating" : "Dictate"}
          disabled={dictation.state === "transcribing"}
          onPress={dictation.toggle}
          style={styles.round}
        >
          {dictation.state === "transcribing" ? (
            <ActivityIndicator size="small" color={theme.muted} />
          ) : dictation.state === "recording" ? (
            <Icon.stop color={theme.danger} />
          ) : (
            <Icon.mic color={theme.muted} />
          )}
        </Pressable>
        {busy && empty ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop"
            onPress={onStop}
            style={[styles.round, { backgroundColor: theme.raised }]}
          >
            <Icon.stop color={theme.ink} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: empty }}
            disabled={empty}
            onPress={send}
            style={[styles.round, { backgroundColor: theme.primary, opacity: empty ? 0.45 : 1 }]}
          >
            <Icon.send color={theme.onPrimary} />
          </Pressable>
        )}
      </View>
      <ErrorText>{dictation.error}</ErrorText>
    </View>
  )
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: "88%",
    borderRadius: radius.lg,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
  },
  file: {
    alignSelf: "flex-start",
    maxWidth: "88%",
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space(1.5),
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingLeft: space(4),
    paddingRight: space(1.5),
    paddingVertical: space(1.5),
  },
  input: { flex: 1, fontSize: 16, maxHeight: 140, paddingVertical: space(2) },
  round: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
})
