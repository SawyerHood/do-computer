import {
  type LibraryFile,
  MAX_MESSAGE_IMAGES,
  type MessageImage,
  randomId,
} from "@do-computer/protocol"
import { ArrowUpIcon, MicrophoneIcon, PlusIcon, StopIcon, XIcon } from "@phosphor-icons/react"
import { useAtom } from "jotai"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { draftAtom } from "@/lib/atoms"
import { pictureFor } from "@/lib/pictures"
import { type DictationEnd, type DictationState, useDictation } from "@/lib/use-dictation"
import { cn } from "@/lib/utils"
import { type AttachedFile, AttachedFiles } from "./attached-files.tsx"
import { DRAFTED } from "./sent-file.tsx"
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
 * The message box. At rest it is one line, with its buttons at either end of it. Once it is
 * being written in it opens out: what is written across its whole width, and its buttons in a
 * row underneath, with the chat's own among them. It stays open while there is anything in it,
 * and shuts when it is left empty. Enter sends, Shift+Enter adds a line. While the agent is
 * working, sending steers the run and the stop button aborts it. What was sent is in the
 * transcript from then on.
 */
export function Composer({
  draftKey,
  placeholder,
  busy,
  onSend,
  error,
  onStop,
  onAttach,
  sees,
  agentName,
  onTyping,
  extras,
  call,
}: {
  draftKey: string
  placeholder: string
  busy: boolean
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
  /** Buttons of the chat's own for the row under the message, there while the box is open. */
  extras?: ReactNode
  /** What is where sending is while there is nothing to send: the way to talk instead. */
  call?: ReactNode
}) {
  const [draft, setDraft] = useAtom(draftAtom(draftKey))
  const input = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLFormElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  // Whether someone has gone to the box to write in it. Being given the cursor when the chat
  // opens is not that: the box is ready to be typed in, and still one line until it is.
  const [entered, setEntered] = useState(false)
  const given = useRef(false)
  const giveCursor = () => {
    given.current = true
    input.current?.focus()
    // Nothing is heard of it where the cursor was already there.
    given.current = false
  }
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

  const open = entered || draft !== "" || attached.length > 0 || uploading > 0 || dictating

  // The box is out of sight while dictating, and has no height to measure until it is back.
  useEffect(() => {
    const element = input.current
    if (element === null || dictating) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [draft, dictating, open])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the cursor is given again for another chat
  useEffect(() => {
    if (!dictating) giveCursor()
  }, [draftKey, dictating])

  // Left for somewhere else on the page, an empty box shuts. A menu one of its buttons opened
  // is drawn elsewhere on the page and is still the box's: it stays open under it.
  // It shuts once the press that left it is over, and not as it begins: what is above the box
  // moves down as it shuts, and would move out from under the press.
  useEffect(() => {
    if (!entered) return
    const left = (event: Event) => {
      const form = box.current
      if (form === null || !(event.target instanceof Node) || form.contains(event.target)) return
      if (form.querySelector('[aria-expanded="true"]') !== null) return
      setEntered(false)
    }
    // The cursor moves at the start of a press, so where it goes is only heeded from the keys.
    let pressing = false
    const down = () => {
      pressing = true
    }
    const up = () => {
      pressing = false
    }
    const moved = (event: Event) => {
      if (!pressing) left(event)
    }
    document.addEventListener("pointerdown", down, true)
    document.addEventListener("pointerup", up, true)
    document.addEventListener("pointercancel", up, true)
    document.addEventListener("click", left, true)
    document.addEventListener("focusin", moved)
    return () => {
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("pointerup", up, true)
      document.removeEventListener("pointercancel", up, true)
      document.removeEventListener("click", left, true)
      document.removeEventListener("focusin", moved)
    }
  }, [entered])

  // Words put in the box from elsewhere, by a page in the chat say, are there to be read over
  // and sent: the caret goes to their end.
  useEffect(() => {
    const onDrafted = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== draftKey) return
      const element = input.current
      if (element === null) return
      element.focus()
      element.setSelectionRange(element.value.length, element.value.length)
    }
    window.addEventListener(DRAFTED, onDrafted)
    return () => window.removeEventListener(DRAFTED, onDrafted)
  }, [draftKey])

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
    <div className="mx-auto flex w-full max-w-[45rem] flex-col gap-2 px-4 pb-4">
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
        ref={box}
        data-open={open ? "" : undefined}
        className="message-box group/box cursor-text rounded-[1.5rem] bg-popover p-1.5 shadow-raised"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
        // Pressing a button, or the room around what is written, does not take the cursor out
        // of the message: the box would shut under the press.
        // A menu one of its buttons opened is drawn elsewhere on the page, and what is pressed
        // there still arrives here: it is left alone, or nothing in the menu could be typed in.
        onMouseDown={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return
          setEntered(true)
          if (event.target !== input.current) event.preventDefault()
        }}
        onClick={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return
          // Anywhere in the box that is not a button is a place to write.
          if (!(event.target as Element).closest("button, textarea")) input.current?.focus()
        }}
      >
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Choose files to attach"
          onChange={(event) => {
            // Copied out first: emptying the picker empties its list too, and all but the
            // first file would be gone by the time they were reached.
            void attach([...(event.target.files ?? [])])
            event.target.value = ""
          }}
        />
        {dictating ? (
          <div className="col-span-full">
            <Dictating
              state={dictation.state}
              stream={dictation.stream}
              onCancel={dictation.cancel}
              onStop={dictation.stop}
            />
          </div>
        ) : null}
        {/* Kept while dictating, out of sight, so that what was typed and where is not lost. */}
        <textarea
          ref={input}
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label="Message"
          className={cn(
            "max-h-[200px] w-full resize-none bg-transparent px-2 py-1.5 text-base leading-6 outline-none [grid-area:text] placeholder:text-muted-foreground group-data-open/box:min-h-15 group-data-open/box:px-2.5 group-data-open/box:pt-2",
            dictating && "hidden",
          )}
          // Come to with the keys, it is being written in as much as when it is pressed.
          onFocus={() => {
            if (!given.current) setEntered(true)
          }}
          onChange={(event) => {
            // Written in, it has been gone to, and stays open for the next thing to say.
            setEntered(true)
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
            <div className="flex items-center gap-1 self-end [grid-area:start]">
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="rounded-full bg-foreground/8 text-foreground hover:bg-foreground/12"
                onClick={() => picker.current?.click()}
                aria-label="Attach a file"
              >
                <PlusIcon className="size-[1.125rem]" />
              </Button>
              {open ? extras : null}
            </div>
            <div className="flex items-center gap-1 self-end [grid-area:end]">
              {dictation.supported ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="rounded-full text-muted-foreground"
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
                  className="rounded-full"
                >
                  <StopIcon weight="fill" />
                </Button>
              ) : !ready && uploading === 0 && call ? (
                call
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  disabled={!ready}
                  aria-label="Send"
                  className="rounded-full"
                >
                  <ArrowUpIcon weight="bold" className="size-[1.125rem]" />
                </Button>
              )}
            </div>
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
 * words would be, over its own row of buttons. Stopping puts what was said in the box to be read over; sending sends it as it
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
      <div
        className={cn(
          "flex h-[4.125rem] items-center px-3.5",
          transcribing && "animate-shine-across",
        )}
      >
        <Waveform stream={stream} active={!transcribing} className="h-7" />
      </div>
      <span className="sr-only" role="status">
        {transcribing ? "Turning what you said into text" : "Listening"}
      </span>
      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="mr-auto rounded-full text-muted-foreground"
          onClick={onCancel}
          aria-label="Cancel dictating"
          title="Cancel"
        >
          <XIcon />
        </Button>
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
      </div>
    </>
  )
}
