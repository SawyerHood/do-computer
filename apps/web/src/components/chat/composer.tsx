import {
  type LibraryFile,
  MAX_MESSAGE_IMAGES,
  type MessageImage,
  type QueuedInput,
  randomId,
} from "@durable-computer/protocol"
import { ArrowUpIcon, MicrophoneIcon, PaperclipIcon, StopIcon, XIcon } from "@phosphor-icons/react"
import { useAtom } from "jotai"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { draftAtom } from "@/lib/atoms"
import { pictureFor } from "@/lib/pictures"
import { type DictationEnd, type DictationState, useDictation } from "@/lib/use-dictation"
import { cn } from "@/lib/utils"
import { type AttachedFile, AttachedFiles } from "./attached-files.tsx"
import { Waveform } from "./waveform.tsx"

const MAX_HEIGHT_PX = 200

/**
 * A pasted picture arrives named "image.png" every time. It is given the moment it was pasted,
 * so that several of them can be told apart in the library and by the agent.
 */
function pasted(file: File): File {
  if (!/^image\.[a-z0-9]+$/i.test(file.name)) return file
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-").replace("T", "_")
  return new File([file], `pasted-${stamp}${file.name.slice(file.name.lastIndexOf("."))}`, {
    type: file.type,
  })
}

/**
 * The message box. Enter sends, Shift+Enter adds a line. While the agent is working, sending
 * steers the run and the stop button aborts it.
 */
export function Composer({
  draftKey,
  placeholder,
  busy,
  queued,
  onSend,
  error,
  onStop,
  onAttach,
  sees,
  agentName,
  onTyping,
}: {
  draftKey: string
  placeholder: string
  busy: boolean
  queued: QueuedInput[]
  /** Resolves false when the message did not go, so it stays in the box. */
  onSend: (text: string, images: MessageImage[]) => Promise<boolean>
  /** Whether the agent's model can look at pictures. If not, they only reach it as files. */
  sees: boolean
  agentName: string
  /** Why the last message was not sent, if it was not. */
  error?: string
  onStop: () => void
  /** Put a file in the library, where the agent can reach it. */
  onAttach: (file: File) => Promise<LibraryFile>
  /** Told as the user writes and when they stop, where others in the chat are shown it. */
  onTyping?: ((typing: boolean) => void) | undefined
}) {
  const [draft, setDraft] = useAtom(draftAtom(draftKey))
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [attached, setAttached] = useState<AttachedFile[]>([])
  const [uploading, setUploading] = useState(0)
  const [attachError, setAttachError] = useState<string>()
  // Dictated text joins whatever is already typed. It is put in the box to be read over, or
  // sent as it is, whichever was asked for when the recording was stopped.
  const dictation = useDictation((text, end) => {
    const said = draft.trim() === "" ? text : `${draft.trimEnd()} ${text}`
    if (end === "send" && uploading === 0) send(said)
    else setDraft(said)
  })
  const dictating = dictation.state !== "idle"
  const cancelDictation = dictation.cancel
  useEffect(() => {
    setAttached([])
    setAttachError(undefined)
    // What is being said was meant for the chat that was open when it began.
    cancelDictation()
  }, [draftKey, cancelDictation])

  const attach = async (files: File[]) => {
    setAttachError(undefined)
    for (const file of files) {
      setUploading((count) => count + 1)
      // A picture is made ready for the agent to look at while the file itself goes to the
      // library. Either is enough to attach it: a picture that could not be saved is still seen.
      const [picture, stored] = await Promise.allSettled([pictureFor(file), onAttach(file)])
      const image = picture.status === "fulfilled" ? picture.value : undefined
      if (stored.status === "fulfilled" || image !== undefined) {
        setAttached((current) => [
          ...current,
          {
            id: stored.status === "fulfilled" ? stored.value.id : randomId(),
            name: stored.status === "fulfilled" ? stored.value.name : file.name,
            stored: stored.status === "fulfilled",
            image,
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
    input.current?.focus()
  }

  // The box is out of sight while dictating, and has no height to measure until it is back.
  useEffect(() => {
    const element = input.current
    if (element === null || dictating) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [draft, dictating])

  useEffect(() => {
    if (!dictating) input.current?.focus()
  }, [draftKey, dictating])

  const ready = (draft.trim() !== "" || attached.length > 0) && uploading === 0
  const send = (typed = draft) => {
    if ((typed.trim() === "" && attached.length === 0) || uploading > 0) return
    // The files are in the library; naming them is how the agent knows to look there.
    const names = attached
      .filter((file) => file.stored)
      .map((file) => file.name)
      .join(", ")
    const images = sees
      ? attached.flatMap((file) => (file.image ? [file.image] : [])).slice(0, MAX_MESSAGE_IMAGES)
      : []
    const files = attached
    // Cleared at once, as a sent message should be, and put back if it turns out not to have gone.
    setDraft("")
    setAttached([])
    onTyping?.(false)
    void onSend(
      [typed.trim(), names === "" ? "" : `Attached: ${names}`].filter(Boolean).join("\n\n") ||
        // A picture alone, which could not be saved as a file, still needs words to go with.
        "Look at this.",
      images,
    ).then((sent) => {
      if (sent) return
      setDraft((current) => (current === "" ? typed : current))
      setAttached((current) => (current.length === 0 ? files : current))
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-4">
      {queued.length > 0 ? (
        <div className="flex flex-col items-end gap-1">
          {queued.map((item) => (
            <div
              key={item.id}
              className="max-w-[80%] truncate rounded-2xl border border-dashed px-3 py-1.5 text-sm text-muted-foreground"
              title="Will be read after the current step"
            >
              {item.text}
            </div>
          ))}
        </div>
      ) : null}
      <AttachedFiles
        files={attached}
        uploading={uploading}
        note={
          !sees && attached.some((file) => file.image !== undefined)
            ? `${agentName}’s model cannot look at pictures, so it gets these as files. Pick a model that can on its page.`
            : undefined
        }
        onRemove={(id) => setAttached((current) => current.filter((file) => file.id !== id))}
      />
      <form
        className={cn(
          "flex gap-1 rounded-2xl border bg-surface p-1.5 shadow-sm focus-within:border-input",
          dictating ? "items-center" : "items-end",
        )}
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Choose files to attach"
          onChange={(event) => {
            // Copied out first: emptying the picker empties its list too, and all but the first
            // file would be gone by the time they were reached.
            void attach([...(event.target.files ?? [])])
            event.target.value = ""
          }}
        />
        {dictating ? (
          <Dictating
            state={dictation.state}
            stream={dictation.stream}
            onCancel={dictation.cancel}
            onStop={dictation.stop}
          />
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => picker.current?.click()}
            aria-label="Attach a file"
          >
            <PaperclipIcon className="size-5" />
          </Button>
        )}
        {/* Kept while dictating, out of sight, so that what was typed and where is not lost. */}
        <textarea
          ref={input}
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label="Message"
          className={cn(
            "max-h-[200px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[0.9375rem] leading-6 outline-none placeholder:text-muted-foreground",
            dictating && "hidden",
          )}
          onChange={(event) => {
            setDraft(event.target.value)
            onTyping?.(event.target.value.trim() !== "")
          }}
          onPaste={(event) => {
            // A picture or a file on the clipboard is attached, as if it had been chosen. Text
            // that came with it is still pasted as text.
            const files = [...event.clipboardData.files]
            if (files.length === 0) return
            if (!event.clipboardData.types.includes("text/plain")) event.preventDefault()
            void attach(files.map(pasted))
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
        />
        {dictating ? null : (
          <>
            {dictation.supported ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="text-muted-foreground"
                onClick={dictation.start}
                aria-label="Dictate"
              >
                <MicrophoneIcon className="size-5" />
              </Button>
            ) : null}
            {busy && !ready && uploading === 0 ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={onStop}
                aria-label="Stop"
              >
                <StopIcon weight="fill" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!ready} aria-label="Send">
                <ArrowUpIcon weight="bold" className="size-[1.125rem]" />
              </Button>
            )}
          </>
        )}
      </form>
      {(error ?? dictation.error ?? attachError) ? (
        <p role="alert" className="px-5 text-xs text-destructive">
          {error ?? dictation.error ?? attachError}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The message box while it is listening: what the microphone hears, moving across where the
 * words would be. Stopping puts what was said in the box to be read over; sending sends it as it
 * is; the cross throws it away. While the words are on their way the bars hold still and shine.
 */
function Dictating({
  state,
  stream,
  onCancel,
  onStop,
}: {
  state: DictationState
  stream: MediaStream | undefined
  onCancel: () => void
  onStop: (end: DictationEnd) => void
}) {
  const [end, setEnd] = useState<DictationEnd>("draft")
  const transcribing = state === "transcribing"
  const stop = (chosen: DictationEnd) => {
    setEnd(chosen)
    onStop(chosen)
  }
  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="rounded-full text-muted-foreground"
        onClick={onCancel}
        aria-label="Cancel dictating"
        title="Cancel"
      >
        <XIcon />
      </Button>
      <div className={cn("h-7 min-w-0 flex-1 px-1", transcribing && "animate-shine-across")}>
        <Waveform stream={stream} active={!transcribing} />
      </div>
      <span className="sr-only" role="status">
        {transcribing ? "Turning what you said into text" : "Listening"}
      </span>
      <Button
        type="button"
        size="icon"
        variant="secondary"
        className="disabled:opacity-100"
        disabled={transcribing}
        onClick={() => stop("draft")}
        aria-label="Stop dictating"
        title="Stop, and put it in the message"
      >
        {transcribing && end === "draft" ? (
          <Spinner />
        ) : (
          <StopIcon weight="fill" className={cn(transcribing && "opacity-50")} />
        )}
      </Button>
      <Button
        type="button"
        size="icon"
        className="disabled:opacity-100"
        disabled={transcribing}
        onClick={() => stop("send")}
        aria-label="Send what you said"
        title="Send"
      >
        {transcribing && end === "send" ? (
          <Spinner />
        ) : (
          <ArrowUpIcon
            weight="bold"
            className={cn("size-[1.125rem]", transcribing && "opacity-50")}
          />
        )}
      </Button>
    </>
  )
}
