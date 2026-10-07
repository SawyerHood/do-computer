import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openNodeAppDatabase } from "@durable-computer/runtime/node"
import { describe, expect, it } from "vitest"
import { registerBrowser, registerPushToken, sendPush, sendTestPush } from "./push.ts"
import { migrateAppDatabase } from "./schema.ts"
import { fakeBrowser, readVapid } from "./web-push-testing.ts"
import {
  encryptPayload,
  fromBase64Url,
  generateVapidKeys,
  readSubscription,
  toBase64Url,
  vapidAuthorization,
  vapidKeys,
  vapidSubject,
} from "./web-push.ts"

async function database() {
  const { app } = openNodeAppDatabase(
    join(mkdtempSync(join(tmpdir(), "dc-webpush-")), "app.sqlite"),
  )
  await migrateAppDatabase(app)
  return app
}

const ENDPOINT = "https://push.example.net/send/abc"
const message = { title: "Juniper", body: "Done.", data: { agentId: "a1", chatId: "4" } }

/** A push service that keeps what it is sent and answers with `status`. */
function pushService(status = 201) {
  const requests: { url: string; headers: Headers; body: Uint8Array }[] = []
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: new Uint8Array(init?.body as ArrayBuffer),
    })
    return new Response(null, { status })
  }) as typeof fetch
  return { requests, fetcher }
}

describe("web push", () => {
  it("encrypts a message exactly as the example in RFC 8291 does", async () => {
    const body = await encryptPayload(
      {
        p256dh:
          "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      {
        sender: {
          publicKey:
            "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
          privateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
        },
        salt: fromBase64Url("DGv6ra1nlYgDCS1FRnbzlw"),
      },
    )
    expect(toBase64Url(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
        "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
        "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    )
  })

  it("encrypts so that only the browser it is for can read it, differently every time", async () => {
    const browser = await fakeBrowser()
    const other = await fakeBrowser()
    const { keys } = browser.subscription(ENDPOINT)
    const text = new TextEncoder().encode("Two meetings today. ☕")
    const first = await encryptPayload(keys, text)
    const second = await encryptPayload(keys, text)
    expect(await browser.read(first)).toBe("Two meetings today. ☕")
    expect(toBase64Url(first)).not.toBe(toBase64Url(second))
    await expect(other.read(first)).rejects.toThrow()
  })

  it("signs a request for the push service it goes to, for half a day", async () => {
    const keys = await generateVapidKeys()
    const now = Date.UTC(2026, 9, 7)
    const header = await vapidAuthorization(keys, ENDPOINT, "https://agent.example.com", now)
    const { key, valid, claims } = await readVapid(header)
    expect(valid).toBe(true)
    expect(key).toBe(keys.publicKey)
    expect(claims).toEqual({
      aud: "https://push.example.net",
      exp: now / 1000 + 12 * 60 * 60,
      sub: "https://agent.example.com",
    })
  })

  it("makes the deployment's keys once and keeps them", async () => {
    const db = await database()
    const [first, second] = await Promise.all([vapidKeys(db), vapidKeys(db)])
    expect(fromBase64Url(first.publicKey).length).toBe(65)
    expect(fromBase64Url(first.privateKey).length).toBe(32)
    expect(second).toEqual(first)
    expect(await vapidKeys(db)).toEqual(first)
  })

  it("names the app's own address to push services only when it is a public one", () => {
    expect(vapidSubject("https://agent.example.com/")).toBe("https://agent.example.com")
    for (const address of ["http://agent.example.com", "https://localhost:3000", undefined]) {
      expect(vapidSubject(address)).toMatch(/^mailto:/)
    }
  })

  it("takes a browser's subscription and nothing that only looks like one", async () => {
    const good = (await fakeBrowser()).subscription(ENDPOINT)
    expect(readSubscription(good)).toEqual({ endpoint: ENDPOINT, ...good.keys })
    expect(readSubscription({ ...good, endpoint: "not an address" })).toBeUndefined()
    expect(readSubscription({ ...good, keys: { ...good.keys, auth: "short" } })).toBeUndefined()
    expect(readSubscription({ ...good, keys: { ...good.keys, p256dh: "AAAA" } })).toBeUndefined()
    expect(readSubscription({ endpoint: ENDPOINT })).toBeUndefined()
    expect(readSubscription(null)).toBeUndefined()
  })

  it("sends a browser the notification and the page to open, signed and encrypted", async () => {
    const db = await database()
    const browser = await fakeBrowser()
    await registerBrowser(
      db,
      "user-1",
      readSubscription(browser.subscription(ENDPOINT))!,
      "https://agent.example.com",
    )
    const service = pushService()
    expect(await sendPush(db, "user-1", message, service.fetcher)).toBe(1)
    const [request] = service.requests
    expect(request!.url).toBe(ENDPOINT)
    expect(request!.headers.get("content-encoding")).toBe("aes128gcm")
    expect(Number(request!.headers.get("ttl"))).toBeGreaterThan(0)
    expect(JSON.parse(await browser.read(request!.body))).toEqual({
      title: "Juniper",
      body: "Done.",
      url: "/a/a1/c/4",
    })
    const vapid = await readVapid(request!.headers.get("authorization")!)
    expect(vapid.valid).toBe(true)
    expect(vapid.key).toBe((await vapidKeys(db)).publicKey)
    expect(vapid.claims.sub).toBe("https://agent.example.com")
  })

  it("opens the agent's page when the notification is about no chat", async () => {
    const db = await database()
    const browser = await fakeBrowser()
    await registerBrowser(db, "user-1", readSubscription(browser.subscription(ENDPOINT))!, "")
    const service = pushService()
    await sendPush(
      db,
      "user-1",
      { ...message, data: { agentId: "a1", chatId: null } },
      service.fetcher,
    )
    expect(JSON.parse(await browser.read(service.requests[0]!.body)).url).toBe("/a/a1")
  })

  it("reaches a user's phones and browsers alike", async () => {
    const db = await database()
    const browser = await fakeBrowser()
    await registerBrowser(db, "user-1", readSubscription(browser.subscription(ENDPOINT))!, "")
    await registerPushToken(db, "user-1", "ExpoPushToken[phone]", "ios")
    const to: string[] = []
    const fetcher = (async (url: unknown, init?: RequestInit) => {
      to.push(String(url))
      if (String(url) === ENDPOINT) return new Response(null, { status: 201 })
      const batch = JSON.parse(String(init?.body)) as { to: string }[]
      expect(batch.map((entry) => entry.to)).toEqual(["ExpoPushToken[phone]"])
      return Response.json({ data: [{ status: "ok" }] })
    }) as typeof fetch
    expect(await sendPush(db, "user-1", message, fetcher)).toBe(2)
    expect(to.sort()).toEqual(["https://exp.host/--/api/v2/push/send", ENDPOINT].sort())
  })

  it("forgets a browser its push service no longer knows, and keeps one that only failed", async () => {
    const db = await database()
    const browser = await fakeBrowser()
    await registerBrowser(db, "user-1", readSubscription(browser.subscription(ENDPOINT))!, "")
    expect(await sendPush(db, "user-1", message, pushService(500).fetcher)).toBe(0)
    expect(await db.all("SELECT token FROM dc_push_tokens")).toEqual([{ token: ENDPOINT }])
    expect(await sendPush(db, "user-1", message, pushService(410).fetcher)).toBe(0)
    expect(await db.all("SELECT token FROM dc_push_tokens")).toEqual([])
  })

  it("moves a browser to whoever signs in on it last", async () => {
    const db = await database()
    const subscription = readSubscription((await fakeBrowser()).subscription(ENDPOINT))!
    await registerBrowser(db, "user-1", subscription, "")
    await registerBrowser(db, "user-2", subscription, "")
    const service = pushService()
    expect(await sendPush(db, "user-1", message, service.fetcher)).toBe(0)
    expect(await sendPush(db, "user-2", message, service.fetcher)).toBe(1)
  })

  it("sends a test to one browser of the user's own", async () => {
    const db = await database()
    const browser = await fakeBrowser()
    await registerBrowser(db, "user-1", readSubscription(browser.subscription(ENDPOINT))!, "")
    const service = pushService()
    expect(await sendTestPush(db, "user-2", ENDPOINT, service.fetcher)).toBe(false)
    expect(service.requests).toEqual([])
    expect(await sendTestPush(db, "user-1", ENDPOINT, service.fetcher)).toBe(true)
    expect(JSON.parse(await browser.read(service.requests[0]!.body))).toMatchObject({ url: "/" })
  })
})
