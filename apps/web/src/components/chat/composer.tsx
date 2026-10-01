import type { QueuedInput } from "@durable-computer/protocol"
import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react"
import { useAtom } from "jotai"
import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { draftAtom } from "@/lib/atoms"

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
  onStop,
}: {
  draftKey: string
  placeholder: string
  busy: boolean
  queued: QueuedInput[]
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [draft, setDraft] = useAtom(draftAtom(draftKey))
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const element = input.current
    if (element === null) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [draft])

  useEffect(() => {
    input.current?.focus()
  }, [draftKey])

  const send = () => {
    const text = draft.trim()
    if (text === "") return
    onSend(text)
    setDraft("")
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
      <form
        className="flex items-end gap-2 rounded-[1.75rem] border bg-surface py-2 pr-2 pl-5 shadow-sm focus-within:border-input"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
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
        {busy && draft.trim() === "" ? (
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
            disabled={draft.trim() === ""}
            aria-label="Send"
          >
            <ArrowUpIcon weight="bold" />
          </Button>
        )}
      </form>
    </div>
  )
}
