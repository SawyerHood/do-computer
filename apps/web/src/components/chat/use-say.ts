import { useSetAtom } from "jotai"
import { useCallback, useContext } from "react"
import { draftAtom } from "@/lib/atoms"
import { DRAFTED, DraftKeyContext } from "./sent-file.tsx"

/**
 * Put words in the message box of the chat this is in, after whatever is typed there, for the
 * person to send or not. What it gives says whether there was a box to put them in.
 */
export function useSay(): (text: string) => boolean {
  const draftKey = useContext(DraftKeyContext)
  const setDraft = useSetAtom(draftAtom(draftKey ?? ""))
  return useCallback(
    (text: string) => {
      if (draftKey === undefined) return false
      setDraft((typed) => (typed.trim() === "" ? text : `${typed.trimEnd()}\n${text}`))
      // Once the box has the words, it takes the caret.
      requestAnimationFrame(() =>
        window.dispatchEvent(new CustomEvent(DRAFTED, { detail: draftKey })),
      )
      return true
    },
    [draftKey, setDraft],
  )
}
