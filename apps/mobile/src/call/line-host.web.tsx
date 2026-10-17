import { createElement, useEffect, useRef, useState } from "react"
import { type FromPage, readFromPage, setLineHost, type ToPage } from "./line"
import { LINE_PAGE } from "./line-page"

/**
 * The browser build's stand-in for the web view a phone carries a call in (see line-host.tsx):
 * a frame out of sight, running the same page. The frame is of the app's own origin, so that
 * it may have the microphone where the app may.
 */
export function LineHost() {
  const [page, setPage] = useState<{ key: number; onMessage: (message: FromPage) => void }>()
  const frame = useRef<HTMLIFrameElement | null>(null)
  // Who is told what the page says. Known from the moment a page is asked for, since the frame
  // may say it is ready before anything after it has been drawn has run.
  const listener = useRef<((message: FromPage) => void) | undefined>(undefined)
  useEffect(() => {
    let count = 0
    setLineHost({
      open(onMessage) {
        const key = ++count
        listener.current = onMessage
        setPage({ key, onMessage })
        return {
          post(message: ToPage) {
            frame.current?.contentWindow?.postMessage(JSON.stringify(message), "*")
          },
          release() {
            if (listener.current === onMessage) listener.current = undefined
            setPage((current) => (current?.key === key ? undefined : current))
          },
        }
      },
    })
    const heard = (event: MessageEvent) => {
      if (frame.current === null || event.source !== frame.current.contentWindow) return
      const message = readFromPage(event.data)
      if (message !== null) listener.current?.(message)
    }
    window.addEventListener("message", heard)
    return () => {
      window.removeEventListener("message", heard)
      setLineHost(undefined)
    }
  }, [])
  if (page === undefined) return null
  return createElement("iframe", {
    key: page.key,
    ref: frame,
    srcDoc: LINE_PAGE,
    title: "The call's sound",
    allow: "microphone; autoplay",
    "aria-hidden": true,
    tabIndex: -1,
    "data-call-line": "",
    style: { position: "fixed", width: 1, height: 1, left: -10, top: -10, border: 0, opacity: 0 },
  })
}
