/**
 * A random id, 32 hex characters. Built on `getRandomValues`, which every browser has everywhere.
 * `crypto.randomUUID` is tidier and is missing on a page served over plain http from anything but
 * localhost, which is how a self-hosted install on a home network or a tailnet is often reached.
 */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
