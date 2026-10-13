import { TextInputWrapper } from "expo-paste-input"
import { type ReactNode, useEffect, useRef } from "react"
import { Platform, type View } from "react-native"
import { type Chosen, pastedFiles, pastedPictures } from "./attachments"

/**
 * Around the box a message is written in, so that a picture can be pasted into it as words
 * can. On a phone the box's own Paste is offered for a copied picture too, and what it pastes
 * is handed over as files. In a browser the page is told of a paste, and a picture or a file
 * on the clipboard is attached as if it had been chosen. Words are pasted as they always were.
 */
export function PasteTarget({
  onPaste,
  onRefused,
  children,
}: {
  onPaste: (files: Chosen[]) => void
  /** What was copied is nothing that can be attached. */
  onRefused: () => void
  children: ReactNode
}) {
  const box = useRef<View>(null)
  const told = useRef(onPaste)
  told.current = onPaste

  useEffect(() => {
    if (Platform.OS !== "web") return
    const element = box.current as unknown as HTMLElement | null
    if (element === null) return
    const pasted = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.length === 0) return
      // Text that came with it is still pasted as text.
      if (!event.clipboardData?.types.includes("text/plain")) event.preventDefault()
      told.current(pastedFiles(files))
    }
    element.addEventListener("paste", pasted)
    return () => element.removeEventListener("paste", pasted)
  }, [])

  return (
    <TextInputWrapper
      ref={box}
      style={{ flex: 1 }}
      onPaste={(pasted) => {
        if (pasted.type === "images") told.current(pastedPictures(pasted.uris))
        else if (pasted.type === "unsupported") onRefused()
      }}
    >
      {children}
    </TextInputWrapper>
  )
}
