import type { AppDatabase } from "@durable-computer/runtime"
import { readMeta } from "./schema.ts"

/**
 * Web Push: notifications to a browser, or to the app on a phone's home screen, through the push
 * service its browser names. The message is encrypted for that browser (RFC 8291) and the request
 * is signed with this deployment's own key pair (VAPID, RFC 8292), so there is no account to set
 * up with anyone. Everything is done with WebCrypto, which Node and Workers both have.
 */

/** Where a browser is reached, as it gave them: an address and the keys to encrypt for it. */
export type WebPushSubscription = { endpoint: string; p256dh: string; auth: string }

/** The deployment's signing keys: the public point uncompressed and the private scalar, base64url. */
export type VapidKeys = { publicKey: string; privateKey: string }

export type WebPushResult = "sent" | "gone" | "failed"

const VAPID_META_KEY = "vapid_keys"
/** How long a push service keeps a message for a device that is off, in seconds. */
const TTL = 24 * 60 * 60
/** How long one signature is good for, in seconds. Push services refuse more than a day. */
const TOKEN_LIFETIME = 12 * 60 * 60
/** Push services take at least this much. The record size written in the header says the same. */
const MAX_PAYLOAD_BYTES = 3900

const encoder = new TextEncoder()

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const all = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    all.set(part, offset)
    offset += part.length
  }
  return all
}

/** A P-256 private key as WebCrypto imports it, from the scalar and the uncompressed point. */
function privateJwk(keys: VapidKeys): JsonWebKey {
  const point = fromBase64Url(keys.publicKey)
  return {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33, 65)),
    d: keys.privateKey,
  }
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ])
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
  return {
    publicKey: toBase64Url(
      concat(new Uint8Array([4]), fromBase64Url(jwk.x!), fromBase64Url(jwk.y!)),
    ),
    privateKey: jwk.d!,
  }
}

/**
 * The deployment's signing keys, made the first time they are asked for and kept with the app's
 * data from then on. A browser's subscription is tied to the public one, so they never change.
 */
export async function vapidKeys(db: AppDatabase): Promise<VapidKeys> {
  const kept = await readMeta(db, VAPID_META_KEY)
  if (kept !== undefined) return JSON.parse(kept) as VapidKeys
  // Two requests can both find none. Whichever writes first is the one both then read.
  await db.run(
    "INSERT INTO dc_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING",
    VAPID_META_KEY,
    JSON.stringify(await generateVapidKeys()),
  )
  return JSON.parse((await readMeta(db, VAPID_META_KEY))!) as VapidKeys
}

/** The `Authorization` header that tells a push service which deployment is sending. */
export async function vapidAuthorization(
  keys: VapidKeys,
  endpoint: string,
  subject: string,
  now = Date.now(),
): Promise<string> {
  const part = (value: unknown) => toBase64Url(encoder.encode(JSON.stringify(value)))
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + TOKEN_LIFETIME,
    sub: subject,
  })}`
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk(keys),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(unsigned),
  )
  return `vapid t=${unsigned}.${toBase64Url(new Uint8Array(signature))}, k=${keys.publicKey}`
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  material: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveBits"])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8),
  )
}

/**
 * Encrypt a message for one browser, as the body of an `aes128gcm` request. The sender's key
 * pair and the salt are new for every message; they are passed in only to test against the
 * example in the RFC.
 */
export async function encryptPayload(
  subscription: Pick<WebPushSubscription, "p256dh" | "auth">,
  plaintext: Uint8Array,
  fixed?: { sender: VapidKeys; salt: Uint8Array<ArrayBuffer> },
): Promise<Uint8Array<ArrayBuffer>> {
  const curve = { name: "ECDH", namedCurve: "P-256" }
  const receiverPoint = fromBase64Url(subscription.p256dh)
  const receiver = await crypto.subtle.importKey("raw", receiverPoint, curve, false, [])
  const sender =
    fixed === undefined
      ? (await crypto.subtle.generateKey(curve, true, ["deriveBits"])).privateKey
      : await crypto.subtle.importKey("jwk", privateJwk(fixed.sender), curve, true, ["deriveBits"])
  const jwk = await crypto.subtle.exportKey("jwk", sender)
  const senderPoint = concat(new Uint8Array([4]), fromBase64Url(jwk.x!), fromBase64Url(jwk.y!))
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiver }, sender, 256),
  )
  // The shared secret is mixed with the secret only the browser and this server know.
  const material = await hkdf(
    fromBase64Url(subscription.auth),
    shared,
    concat(encoder.encode("WebPush: info\0"), receiverPoint, senderPoint),
    32,
  )
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const key = await hkdf(salt, material, encoder.encode("Content-Encoding: aes128gcm\0"), 16)
  const nonce = await hkdf(salt, material, encoder.encode("Content-Encoding: nonce\0"), 12)
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]),
    // One record, which is also the last: the 2 after the text says so.
    concat(plaintext, new Uint8Array([2])),
  )
  // The header: salt, record size, and the sender's public key for the browser to answer with.
  const header = new Uint8Array(21)
  header.set(salt)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = senderPoint.length
  return concat(header, senderPoint, new Uint8Array(sealed))
}

/**
 * Send one message to one browser. `gone` means its push service no longer knows the
 * subscription, which will never work again.
 */
export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: string,
  vapid: VapidKeys & { subject: string },
  fetcher: typeof fetch = fetch,
): Promise<WebPushResult> {
  try {
    const text = encoder.encode(payload)
    if (text.length > MAX_PAYLOAD_BYTES) return "failed"
    const response = await fetcher(subscription.endpoint, {
      method: "POST",
      headers: {
        authorization: await vapidAuthorization(vapid, subscription.endpoint, vapid.subject),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(TTL),
        // Someone is waiting on these: a phone that is saving its battery still shows them now.
        urgency: "high",
      },
      body: await encryptPayload(subscription, text),
      // The address came from a browser. It is called as given, and nowhere it points on to.
      redirect: "manual",
    })
    if (response.status === 404 || response.status === 410) return "gone"
    return response.ok ? "sent" : "failed"
  } catch {
    return "failed"
  }
}

/**
 * Who a push service can write to about this deployment. Apple's refuses an address on
 * localhost, so the app's own address is given only when it is a public one.
 */
export function vapidSubject(baseUrl: string | undefined): string {
  try {
    const url = new URL(baseUrl ?? "")
    if (url.protocol === "https:" && url.hostname.includes(".")) return url.origin
  } catch {
    // No address is set.
  }
  return "mailto:notifications@durable-computer.invalid"
}

/** What a browser sent as its subscription, if it is one. */
export function readSubscription(input: unknown): WebPushSubscription | undefined {
  const value = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = value?.endpoint
  const p256dh = value?.keys?.p256dh
  const auth = value?.keys?.auth
  if (typeof endpoint !== "string" || endpoint.length > 2048) return undefined
  if (typeof p256dh !== "string" || typeof auth !== "string") return undefined
  try {
    const point = fromBase64Url(p256dh)
    if (point.length !== 65 || point[0] !== 4 || fromBase64Url(auth).length !== 16) return undefined
    new URL(endpoint)
  } catch {
    return undefined
  }
  // Stored without padding, however the browser wrote them.
  return { endpoint, p256dh: p256dh.replace(/=+$/, ""), auth: auth.replace(/=+$/, "") }
}
