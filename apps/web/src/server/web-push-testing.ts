import { fromBase64Url, toBase64Url } from "./web-push.ts"

/**
 * The browser's half of Web Push, for tests: keys to subscribe with, and reading a message that
 * was encrypted for them (RFC 8291). Written apart from the code that encrypts, so that the two
 * agreeing means something.
 */
export type FakeBrowser = {
  /** What a browser hands the server when it subscribes. */
  subscription(endpoint: string): { endpoint: string; keys: { p256dh: string; auth: string } }
  /** The text of a request body a push service was sent for this browser. */
  read(body: Uint8Array): Promise<string>
}

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const

async function derive(
  salt: Uint8Array<ArrayBuffer>,
  material: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveBits"])
  const params = { name: "HKDF", hash: "SHA-256", salt, info }
  return new Uint8Array(await crypto.subtle.deriveBits(params, key, bytes * 8))
}

export async function fakeBrowser(): Promise<FakeBrowser> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])
  const point = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const ascii = (text: string) => new TextEncoder().encode(text)
  return {
    subscription: (endpoint) => ({
      endpoint,
      keys: { p256dh: toBase64Url(point), auth: toBase64Url(auth) },
    }),
    async read(body) {
      const salt = body.slice(0, 16)
      const sender = body.slice(21, 21 + body[20]!)
      const shared = await crypto.subtle.deriveBits(
        { name: "ECDH", public: await crypto.subtle.importKey("raw", sender, ECDH, false, []) },
        pair.privateKey,
        256,
      )
      const info = new Uint8Array([...ascii("WebPush: info\0"), ...point, ...sender])
      const material = await derive(auth, new Uint8Array(shared), info, 32)
      const key = await derive(salt, material, ascii("Content-Encoding: aes128gcm\0"), 16)
      const nonce = await derive(salt, material, ascii("Content-Encoding: nonce\0"), 12)
      const plain = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce },
          await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]),
          body.slice(21 + body[20]!),
        ),
      )
      // The last byte marks the end of the message.
      return new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2)))
    },
  }
}

/** Whether a push request's `Authorization` was signed by the holder of the key it names. */
export async function readVapid(
  authorization: string,
): Promise<{ key: string; valid: boolean; claims: { aud: string; exp: number; sub: string } }> {
  const [, token = "", key = ""] = /^vapid t=([^,]+), k=(.+)$/.exec(authorization) ?? []
  const [header = "", claims = "", signature = ""] = token.split(".")
  const verifier = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(key),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  )
  return {
    key,
    valid: await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifier,
      fromBase64Url(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    ),
    claims: JSON.parse(new TextDecoder().decode(fromBase64Url(claims))),
  }
}
