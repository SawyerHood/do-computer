import { useEffect, useState } from "react"

/** Copy something, and say for a moment that it was. */
export function useCopied(): [copied: boolean, copy: (text: string) => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  return [
    copied,
    (text) => {
      // Over plain http on another device there is no clipboard to write to.
      void Promise.resolve()
        .then(() => navigator.clipboard.writeText(text))
        .then(
          () => setCopied(true),
          () => {},
        )
    },
  ]
}
