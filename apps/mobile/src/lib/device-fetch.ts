/** A blob's bytes. React Native's blob has no `arrayBuffer`, and its file reader does. */
function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."))
    reader.readAsArrayBuffer(blob)
  })
}

/**
 * Expo's fetch sends a blob under the blob's own type, whatever Content-Type the request names.
 * A file read from a phone's disk is a blob with no type, so a recording or a picked file
 * reached the server as nothing in particular and was refused. This hands over the blob's
 * bytes instead, and the type the request names stands.
 */
export function keepingType(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const body = init?.body
    if (typeof Blob === "undefined" || !(body instanceof Blob)) return inner(input, init)
    return inner(input, { ...init, body: await bytesOf(body) })
  }
}
