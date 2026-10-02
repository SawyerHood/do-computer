import type {
  ChatMessage,
  ChatState,
  LibraryFile,
  MessagePart,
  ToolPart,
} from "@durable-computer/protocol"
import { useEffect, useRef, useState } from "react"
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

/** How a tool call reads in the transcript, while it runs and once it is done. */
function describeTool(part: ToolPart): string {
  const args = (part.args ?? {}) as Record<string, unknown>
  const active = part.status === "pending" || part.status === "running"
  const path = typeof args.path === "string" ? args.path : "a file"
  const lines: Record<string, [string, string]> = {
    bash: [
      "Running a command",
      typeof args.command === "string" ? args.command.split("\n")[0]! : "Ran a command",
    ],
    read: ["Reading a file", `Read ${path}`],
    write: ["Writing a file", `Wrote ${path}`],
    edit: ["Editing a file", `Edited ${path}`],
    send_file: ["Sending a file", `Sent ${path}`],
    memory: ["Updating memory", "Updated its memory"],
    set_identity: [
      "Updating its identity",
      typeof args.name === "string" ? `Named itself ${args.name}` : "Updated its identity",
    ],
    schedule: [
      "Updating its schedule",
      args.action === "create" ? "Scheduled a task" : "Updated its schedule",
    ],
    skill: [
      "Using a skill",
      args.action === "view" ? `Loaded the ${String(args.name)} skill` : "Updated its skills",
    ],
  }
  const known = lines[part.name]
  const label = known ? known[active ? 0 : 1] : `${active ? "Using" : "Used"} ${part.name}`
  return part.status === "error" ? `${label} (failed)` : label
}

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

function ToolRow({ part, agentId }: { part: ToolPart; agentId: string }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  if (part.name === "send_file" && part.status === "done" && part.details) {
    return <FileCard agentId={agentId} file={part.details as unknown as LibraryFile} />
  }
  const active = part.status === "pending" || part.status === "running"
  return (
    <View style={{ gap: space(1.5) }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={describeTool(part)}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space(2),
          paddingHorizontal: space(1),
        }}
      >
        {active ? (
          <ActivityIndicator size="small" color={theme.muted} />
        ) : (
          <Icon.tool color={part.status === "error" ? theme.danger : theme.muted} />
        )}
        <Text
          tone={part.status === "error" ? "danger" : "muted"}
          size={14}
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {describeTool(part)}
        </Text>
      </Pressable>
      {open ? (
        <View
          style={[styles.detail, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text tone="muted" size={12} style={styles.mono}>
            {JSON.stringify(part.args, null, 2)}
          </Text>
          {part.output ? (
            <Text size={12} tone={part.status === "error" ? "danger" : "ink"} style={styles.mono}>
              {part.output}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function Part({ part, agentId }: { part: MessagePart; agentId: string }) {
  const theme = useTheme()
  switch (part.type) {
    case "text":
      return (
        <View style={[styles.bubble, { backgroundColor: theme.surface, alignSelf: "flex-start" }]}>
          <Markdown text={part.text} color={theme.ink} />
        </View>
      )
    case "thinking":
      return (
        <Text tone="muted" size={14} style={{ paddingHorizontal: space(1) }}>
          Thought for a moment
        </Text>
      )
    case "tool":
      return <ToolRow part={part} agentId={agentId} />
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
      {message.parts.map((part, index) => (
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
}: {
  state: ChatState
  agentId: string
  empty: React.ReactNode
}) {
  const list = useRef<FlatList<ChatMessage>>(null)
  const last = state.messages.at(-1)
  const waiting = state.busy && (last === undefined || last.role === "user")
  // Follow new content. A reader who has scrolled up is not interrupted on web; on a device the
  // list's own "maintain position" behavior applies.
  useEffect(() => {
    list.current?.scrollToEnd({ animated: true })
  }, [state.messages.length, last?.parts.length, last?.status])
  return (
    <FlatList
      ref={list}
      accessibilityRole="list"
      accessibilityLabel="Messages"
      data={state.messages}
      keyExtractor={(message) => message.id}
      renderItem={({ item }) => <Message message={item} agentId={agentId} />}
      contentContainerStyle={{ padding: space(4), gap: space(4), flexGrow: 1 }}
      ListEmptyComponent={state.busy ? null : <>{empty}</>}
      ListFooterComponent={
        waiting ? (
          <Text tone="muted" size={14}>
            Thinking…
          </Text>
        ) : null
      }
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
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
}: {
  placeholder: string
  busy: boolean
  queued: ChatState["queued"]
  onSend: (text: string) => void
  onStop: () => void
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
          onChangeText={setDraft}
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
  detail: {
    marginLeft: space(6),
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: space(3),
    gap: space(2),
  },
  mono: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "ui-monospace, Menlo, monospace",
    }),
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
