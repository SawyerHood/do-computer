const encoder = new TextEncoder()

/** One server-sent event carrying `value` as JSON. */
export function encodeSse(value: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
}

/** A comment line: keeps proxies from closing an idle stream and is ignored by parsers. */
export const SSE_HEARTBEAT = encoder.encode(": keep-alive\n\n")

/**
 * How often a stream with nothing to say sends one. A reader that hears nothing for a few of
 * these has lost the stream, whatever its connection says.
 */
export const SSE_HEARTBEAT_MS = 15_000

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
} as const

/**
 * Decode a `text/event-stream` body into the JSON values of its `data` events. Reads with a plain
 * stream reader, so it works with `fetch` in browsers, Node, Workers and Expo alike. `onBytes` is
 * called for everything that arrives, heartbeats too: it is how a reader knows the stream lives.
 */
export async function* readSse<T>(
  body: ReadableStream<Uint8Array>,
  onBytes?: () => void,
): AsyncGenerator<T> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      onBytes?.()
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        // Events end with a blank line; tolerate CRLF.
        const match = /\r?\n\r?\n/.exec(buffer)
        if (match === null) break
        const raw = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const data = raw
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
          .join("\n")
        if (data !== "") yield JSON.parse(data) as T
      }
    }
  } finally {
    // A consumer that stops early is done with the connection, not just with reading it.
    await reader.cancel().catch(() => {})
  }
}
