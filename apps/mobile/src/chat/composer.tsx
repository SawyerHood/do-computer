import { type MessageImage, type QueuedInput, randomId } from "@do-computer/protocol"
import { useRouter } from "expo-router"
import { atom, useAtom, useSetAtom } from "jotai"
import { useCallback, useMemo, useState } from "react"
import { Platform, Pressable, TextInput, View } from "react-native"
import { pick, unpick, usePicked } from "@/lib/attach"
import { type Accent, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { errorText, Glass, haptic, Icon, Menu, type MenuItem, Text } from "@/ui"
import {
  type AttachedFile,
  AttachedFiles,
  bodyOf,
  type Chosen,
  chooseFiles,
  choosePictures,
  imagesToSend,
  pictureFor,
} from "./attachments"
import { Dictating, useChatDictation } from "./dictation"
import { PasteTarget } from "./paste"
import { ThinksWith } from "./thinks-with"

/** What is written and not sent yet, by chat, for as long as the app is open. */
const draftsAtom = atom<Readonly<Record<string, string>>>({})

function useDraft(
  chatId: string,
): [string, (next: string | ((current: string) => string)) => void] {
  const [drafts, setDrafts] = useAtom(draftsAtom)
  const set = useCallback(
    (next: string | ((current: string) => string)) =>
      setDrafts((kept) => {
        const current = kept[chatId] ?? ""
        return { ...kept, [chatId]: typeof next === "function" ? next(current) : next }
      }),
    [chatId, setDrafts],
  )
  return [drafts[chatId] ?? "", set]
}

/**
 * Puts words in a chat's message box, after whatever is there, for the person to send: how a
 * page the agent drew hands over a choice pressed in it.
 */
export function useSay(chatId: string): (text: string) => void {
  const setDrafts = useSetAtom(draftsAtom)
  return useCallback(
    (text: string) =>
      setDrafts((kept) => {
        const typed = kept[chatId] ?? ""
        return { ...kept, [chatId]: typed.trim() === "" ? text : `${typed.trimEnd()}\n${text}` }
      }),
    [chatId, setDrafts],
  )
}

const LINE = 22
const MAX_LINES = 7
/** The room under the words when the buttons are in a row below them. */
const UNDER = 4

/**
 * The message box, floating over the foot of the chat. Left alone and empty it is one line: "+"
 * at its start, the microphone at its end, and what is written between them. Once it is being
 * written in, the words have its whole width and the buttons are in a row under them: "+" and
 * what the agent thinks with on the left, and on the right the microphone, or the send button
 * once there is something to send. Stop is beside the microphone while the agent works. What
 * is sent while the agent works steers it or waits, as the agent is set to. A picture that was
 * copied is pasted into the box as words are, and is attached.
 */
export function Composer({
  agentId,
  chatId,
  placeholder,
  accent,
  busy,
  queued,
  waits,
  onSend,
  error,
  onStop,
  sees,
  agentName,
  onTyping,
  onKey,
}: {
  agentId: string
  chatId: string
  placeholder: string
  accent: Accent
  busy: boolean
  queued: readonly QueuedInput[]
  /** The agent finishes what it is doing before it reads a new message, and is not steered by it. */
  waits: boolean
  /** Resolves false when the message did not go, so it stays in the box. */
  onSend: (text: string, images: MessageImage[]) => Promise<boolean>
  /** Why the last message was not sent, if it was not. */
  error?: string | undefined
  onStop: () => void
  /** Whether the agent's model can look at pictures. If not, they only reach it as files. */
  sees: boolean
  agentName: string
  /** Told as the reader writes and when they stop, where others in the chat are shown it. */
  onTyping?: ((typing: boolean) => void) | undefined
  /** Told at every key, which the creature in the bar leans in at. */
  onKey?: (() => void) | undefined
}) {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const [draft, setDraft] = useDraft(chatId)
  const [chosen, setChosen] = useState<AttachedFile[]>([])
  const [uploading, setUploading] = useState(0)
  const [attachError, setAttachError] = useState<string>()
  // A browser's box does not grow with what is written in it, so there it is told how tall to be.
  const [tall, setTall] = useState(LINE)
  const [focused, setFocused] = useState(false)
  // Files of the library chosen on its own screen go with the message as those chosen here do.
  const picked = usePicked(chatId)
  const attached = useMemo<AttachedFile[]>(
    () => [...picked.map((file) => ({ id: file.id, name: file.name, stored: true })), ...chosen],
    [picked, chosen],
  )

  const ready = (draft.trim() !== "" || attached.length > 0) && uploading === 0
  // Open, the words have the box's whole width and its buttons are under them.
  const open = focused || draft !== "" || attached.length > 0 || uploading > 0

  const send = (typed = draft) => {
    if ((typed.trim() === "" && attached.length === 0) || uploading > 0) return
    // The files are in the library; naming them is how the agent knows to look there.
    const named = attached
      .filter((file) => file.stored)
      .map((file) => file.name)
      .join(", ")
    const images = sees ? imagesToSend(attached) : []
    const files = chosen
    const fromLibrary = picked
    haptic.light()
    // Cleared at once, as a sent message should be, and put back if it turns out not to have gone.
    setDraft("")
    setChosen([])
    unpick(chatId)
    onTyping?.(false)
    void onSend(
      [typed.trim(), named === "" ? "" : `Attached: ${named}`].filter(Boolean).join("\n\n") ||
        // A picture alone, which could not be saved as a file, still needs words to go with.
        "Look at this.",
      images,
    ).then((sent) => {
      if (sent) return
      haptic.fail()
      setDraft((current) => (current === "" ? typed : current))
      setChosen((current) => (current.length === 0 ? files : current))
      for (const file of fromLibrary) pick(chatId, file)
    })
  }

  // Dictated text joins whatever is already typed. It is put in the box to be read over, or
  // sent as it is, whichever was asked for when the recording was stopped.
  const dictation = useChatDictation((text, end) => {
    const said = draft.trim() === "" ? text : `${draft.trimEnd()} ${text}`
    if (end === "send" && uploading === 0) send(said)
    else setDraft(said)
  })
  const dictating = dictation.state !== "idle"

  const attach = async (choose: () => Chosen[] | Promise<Chosen[]>) => {
    setAttachError(undefined)
    let files: Chosen[]
    try {
      files = await choose()
    } catch (caught) {
      return setAttachError(errorText(caught, "That could not be opened."))
    }
    for (const file of files) {
      setUploading((count) => count + 1)
      // A picture is made ready for the agent to look at while the file itself goes to the
      // library. Either is enough to attach it: a picture that could not be saved is still seen.
      const [picture, stored] = await Promise.allSettled([
        pictureFor(file),
        bodyOf(file).then((body) =>
          client.agent(agentId).upload({ name: file.name, type: file.type, body }, chatId),
        ),
      ])
      const image = picture.status === "fulfilled" ? picture.value : undefined
      if (stored.status === "fulfilled" || image !== undefined) {
        setChosen((current) => [
          ...current,
          {
            id: stored.status === "fulfilled" ? stored.value.id : randomId(),
            name: stored.status === "fulfilled" ? stored.value.name : file.name,
            stored: stored.status === "fulfilled",
            image,
            preview: file.type.startsWith("image/") ? file.uri : undefined,
          },
        ])
      }
      if (stored.status === "rejected") {
        const why = stored.reason instanceof Error ? stored.reason.message : "upload failed"
        setAttachError(
          image === undefined
            ? `${file.name} could not be attached: ${why}`
            : `${file.name} could not be saved to the library (${why}). It is still attached as a picture.`,
        )
      }
      setUploading((count) => count - 1)
    }
  }

  const add: MenuItem[] = [
    {
      title: "Photo Library",
      icon: "photo",
      onPress: () => void attach(() => choosePictures("library")),
    },
    {
      title: "Take Photo",
      icon: "camera",
      onPress: () => void attach(() => choosePictures("camera")),
    },
    { title: "Choose Files", icon: "folder", onPress: () => void attach(chooseFiles) },
    {
      title: "From the library",
      icon: "doc",
      onPress: () => router.push(`/a/${agentId}/library/pick?chatId=${chatId}`),
    },
    { title: "Dictate", icon: "wave", onPress: () => void dictation.start() },
  ]

  const wrong = error ?? dictation.error ?? attachError
  // What is above and below the words, which the box's height is its lines and this.
  const edges = 11 + (open ? UNDER : 11)
  const round = {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  } as const

  return (
    <View style={{ gap: 6 }}>
      {queued.length > 0 ? (
        <View
          accessibilityLabel="Will be read after the current step"
          style={{ gap: 3, paddingHorizontal: 6 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Icon name="clock" size={12} color={theme.ink2} />
            <Text variant="caption" tone="ink2">
              Will be read after the current step
            </Text>
          </View>
          {queued.map((item) => (
            <Text key={item.id} variant="footnote" tone="ink2" numberOfLines={2}>
              {item.text}
            </Text>
          ))}
        </View>
      ) : busy && ready ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 6 }}>
          <Icon name="clock" size={12} color={theme.ink2} />
          <Text variant="caption" tone="ink2">
            {waits
              ? `${agentName} reads this once it has finished`
              : `${agentName} reads this after the step it is on`}
          </Text>
        </View>
      ) : null}
      <Glass
        style={{ minHeight: 44, borderRadius: 22, borderCurve: "continuous", overflow: "hidden" }}
      >
        <AttachedFiles
          files={attached}
          uploading={uploading}
          note={
            !sees && attached.some((file) => file.image !== undefined)
              ? `${agentName}’s model cannot look at pictures, so it gets these as files. Pick a model that can on its page.`
              : undefined
          }
          onRemove={(id) =>
            picked.some((file) => file.id === id)
              ? unpick(chatId, id)
              : setChosen((current) => current.filter((file) => file.id !== id))
          }
        />
        {dictating ? (
          <Dictating
            state={dictation.state}
            recorder={dictation.recorder}
            accent={accent}
            onCancel={dictation.cancel}
            onStop={(end) => void dictation.stop(end)}
          />
        ) : (
          <View>
            <PasteTarget
              onPaste={(files) => void attach(() => files)}
              onRefused={() => setAttachError("What was copied could not be pasted.")}
            >
              <TextInput
                accessibilityLabel="Message"
                multiline
                value={draft}
                placeholder={placeholder}
                placeholderTextColor={theme.ink3}
                selectionColor={accent.a}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onContentSizeChange={
                  Platform.OS === "web"
                    ? (event) => setTall(event.nativeEvent.contentSize.height)
                    : undefined
                }
                // With a keyboard of keys, Enter sends and Shift+Enter adds a line, as on the web.
                onKeyPress={
                  Platform.OS === "web"
                    ? (event) => {
                        const key = event.nativeEvent as { key: string; shiftKey?: boolean }
                        if (key.key !== "Enter" || key.shiftKey) return
                        event.preventDefault()
                        send()
                      }
                    : undefined
                }
                onChangeText={(text) => {
                  setDraft(text)
                  onKey?.()
                  onTyping?.(text.trim() !== "")
                }}
                style={{
                  color: theme.ink,
                  fontSize: 17,
                  lineHeight: LINE,
                  letterSpacing: -0.41,
                  // Shut, the buttons are on the one line, and the words keep clear of them.
                  paddingLeft: open ? 16 : 44,
                  paddingRight: open ? 16 : busy ? 80 : 44,
                  paddingTop: 11,
                  paddingBottom: open ? UNDER : 11,
                  maxHeight: LINE * MAX_LINES + edges,
                  ...(Platform.OS === "web"
                    ? { height: Math.min(Math.max(tall, LINE + edges), LINE * MAX_LINES + edges) }
                    : // A phone's box grows with what is written in it, and does not always
                      // shrink again when that is sent: an empty one is told how tall it is.
                      draft === ""
                      ? { height: LINE + edges }
                      : null),
                }}
              />
            </PasteTarget>
            {/* One row of buttons in both shapes, so that none of them, nor the box being
                written in, is made again when the shape changes. Shut, it lies over the line. */}
            <View
              pointerEvents="box-none"
              style={[
                { flexDirection: "row", alignItems: "center", gap: 2, padding: 5 },
                open ? { paddingTop: 0 } : { position: "absolute", left: 0, right: 0, bottom: 0 },
              ]}
            >
              <Menu items={add} title="Attach a file">
                <View accessibilityLabel="Attach a file" style={round}>
                  <Icon name="plus" size={21} color={theme.ink2} weight="medium" />
                </View>
              </Menu>
              {open ? <ThinksWith agentId={agentId} /> : null}
              <View pointerEvents="none" style={{ flex: 1 }} />
              {ready ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  onPress={() => send()}
                  style={[round, { backgroundColor: accent.a }]}
                >
                  <Icon name="arrowUp" size={17} color={accent.onA} weight="bold" />
                </Pressable>
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Dictate"
                    disabled={uploading > 0}
                    onPress={() => void dictation.start()}
                    style={round}
                  >
                    <Icon name="mic" size={20} color={theme.ink2} />
                  </Pressable>
                  {/* The agent can be spoken to while it works, so Stop does not take the
                      microphone's place. */}
                  {busy && uploading === 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Stop"
                      onPress={() => {
                        haptic.medium()
                        onStop()
                      }}
                      style={[round, { backgroundColor: theme.ink }]}
                    >
                      <Icon name="stop" size={15} color={theme.bg} />
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          </View>
        )}
      </Glass>
      {wrong === undefined ? null : (
        <Text
          variant="footnote"
          tone="red"
          accessibilityRole="alert"
          style={{ paddingHorizontal: 6 }}
        >
          {wrong}
        </Text>
      )}
    </View>
  )
}
