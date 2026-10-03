import type { LibraryFile, QueuedInput } from "@durable-computer/protocol"
import {
  ArrowUpIcon,
  CircleNotchIcon,
  MicrophoneIcon,
  PaperclipIcon,
  StopIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useAtom } from "jotai"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { draftAtom } from "@/lib/atoms"
import { useDictation } from "@/lib/use-dictation"
import { cn } from "@/lib/utils"

const MAX_HEIGHT_PX = 200

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
}: {
  draftKey: string
  placeholder: string
  busy: boolean
  queued: QueuedInput[]
  /** Resolves false when the message did not go, so it stays in the box. */
  onSend: (text: string) => Promise<boolean>
  /** Why the last message was not sent, if it was not. */
  error?: string
  onStop: () => void
  /** Put a file in the library, where the agent can reach it. */
  onAttach: (file: File) => Promise<LibraryFile>
}) {
  const [draft, setDraft] = useAtom(draftAtom(draftKey))
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [attached, setAttached] = useState<LibraryFile[]>([])
  const [uploading, setUploading] = useState(0)
  const [attachError, setAttachError] = useState<string>()
  useEffect(() => {
    setAttached([])
    setAttachError(undefined)
  }, [draftKey])

  const attach = async (files: FileList | null) => {
    setAttachError(undefined)
    for (const file of files ?? []) {
      setUploading((count) => count + 1)
      try {
        const stored = await onAttach(file)
        setAttached((current) => [...current, stored])
      } catch (error) {
        setAttachError(
          `${file.name} could not be attached: ${error instanceof Error ? error.message : "upload failed"}`,
        )
      } finally {
        setUploading((count) => count - 1)
      }
    }
    input.current?.focus()
  }
  // Dictated text joins whatever is already typed, ready to be read over before sending.
  const dictation = useDictation((text) => {
    setDraft((current) => (current.trim() === "" ? text : `${current.trimEnd()} ${text}`))
    input.current?.focus()
  })

  useEffect(() => {
    const element = input.current
    if (element === null) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [draft])

  useEffect(() => {
    input.current?.focus()
  }, [draftKey])

  const ready = (draft.trim() !== "" || attached.length > 0) && uploading === 0
  const send = () => {
    if (!ready) return
    // The files are in the library; naming them is how the agent knows to look there.
    const names = attached.map((file) => file.name).join(", ")
    const typed = draft
    const files = attached
    // Cleared at once, as a sent message should be, and put back if it turns out not to have gone.
    setDraft("")
    setAttached([])
    void onSend(
      [typed.trim(), names === "" ? "" : `Attached: ${names}`].filter(Boolean).join("\n\n"),
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
      {attached.length > 0 || uploading > 0 ? (
        <ul aria-label="Attached files" className="flex flex-wrap gap-1.5 px-2">
          {attached.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-1 rounded-full border bg-surface py-1 pr-1 pl-3 text-xs"
            >
              <span className="max-w-48 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setAttached((current) => current.filter((other) => other.id !== file.id))
                }
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
          {uploading > 0 ? (
            <li className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
              <CircleNotchIcon className="size-3 animate-spin" /> Attaching…
            </li>
          ) : null}
        </ul>
      ) : null}
      <form
        className="flex items-end gap-2 rounded-[1.75rem] border bg-surface py-2 pr-2 pl-2 shadow-sm focus-within:border-input"
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
            void attach(event.target.files)
            event.target.value = ""
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="rounded-full text-muted-foreground"
          onClick={() => picker.current?.click()}
          aria-label="Attach a file"
        >
          <PaperclipIcon />
        </Button>
        <textarea
          ref={input}
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label="Message"
          className="max-h-[200px] flex-1 resize-none self-center bg-transparent py-1.5 text-[0.9375rem] outline-none placeholder:text-muted-foreground"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
        />
        {dictation.supported ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn(
              "rounded-full text-muted-foreground",
              dictation.state === "recording" && "bg-destructive/15 text-destructive",
            )}
            disabled={dictation.state === "transcribing"}
            onClick={dictation.toggle}
            aria-label={dictation.state === "recording" ? "Stop dictating" : "Dictate"}
            aria-pressed={dictation.state === "recording"}
          >
            {dictation.state === "transcribing" ? (
              <CircleNotchIcon className="animate-spin" />
            ) : dictation.state === "recording" ? (
              <StopIcon weight="fill" className="animate-pulse" />
            ) : (
              <MicrophoneIcon />
            )}
          </Button>
        ) : null}
        {busy && !ready && uploading === 0 ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="rounded-full"
            onClick={onStop}
            aria-label="Stop"
          >
            <StopIcon weight="fill" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="rounded-full"
            disabled={!ready}
            aria-label="Send"
          >
            <ArrowUpIcon weight="bold" />
          </Button>
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
