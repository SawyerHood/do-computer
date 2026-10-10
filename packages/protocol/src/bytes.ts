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
  /**
   * How long the sender says the body is, where it says. Believed only as far as making room
   * goes: a body of that length is then held once while it is read, and not twice.
   */
  declared?: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (body === null) return new Uint8Array()
  const reader = body.getReader()
  const room =
    declared !== undefined && Number.isInteger(declared) && declared > 0
      ? Math.min(declared, limit)
      : 0
  // Filled as the body arrives. What arrives past it, from a sender that said too little or
  // nothing, is kept in pieces and joined at the end.
  const whole = new Uint8Array(room)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (size + value.byteLength > limit) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLarge(limit)
    }
    const fits = Math.max(0, Math.min(value.byteLength, room - size))
    if (fits > 0) whole.set(fits === value.byteLength ? value : value.subarray(0, fits), size)
    if (fits < value.byteLength) chunks.push(fits === 0 ? value : value.subarray(fits))
    size += value.byteLength
  }
  // Exactly what was said: these are the bytes, with no copy made of them.
  if (size === room) return whole
  const bytes = new Uint8Array(size)
  bytes.set(size < room ? whole.subarray(0, size) : whole)
  let offset = Math.min(size, room)
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
