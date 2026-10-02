/** A body was larger than the caller allows. */
export class BodyTooLarge extends Error {
  constructor(readonly limit: number) {
    super(`The body is larger than ${limit} bytes`)
  }
}

/**
 * Read a request or response body into memory, giving up the moment it passes `limit` bytes.
 *
 * A declared `content-length` is only what the sender says, and a sender can leave it out or
 * understate it, so a check of the header alone lets one request fill the memory of a server
 * that every user shares. This counts what actually arrives.
 */
export async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLarge(limit)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Whether a body's declared length already rules it out, sparing the read. */
export function declaredTooLarge(headers: Headers, limit: number): boolean {
  const declared = Number(headers.get("content-length") ?? "0")
  return Number.isFinite(declared) && declared > limit
}
