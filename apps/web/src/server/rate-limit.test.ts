import { describe, expect, it } from "vitest"
import { limitedAs, type Limiter, overLimit } from "./rate-limit.ts"

const ask = (path: string, init: RequestInit & { from?: string } = {}) =>
  new Request(`https://app.example${path}`, {
    method: "POST",
    ...init,
    headers: init.from === undefined ? {} : { "cf-connecting-ip": init.from },
  })

/** Lets each key through `limit` times, as the binding does within one of its periods. */
function counting(limit: number): Limiter & { keys: string[] } {
  const counts = new Map<string, number>()
  const keys: string[] = []
  return {
    keys,
    async limit({ key }) {
      keys.push(key)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      return { success: counts.get(key)! <= limit }
    },
  }
}

describe("rate limit", () => {
  it("counts what anyone can call without an account, by address", () => {
    expect(limitedAs(ask("/api/auth/sign-in/email", { from: "203.0.113.7" }))).toBe(
      "auth:203.0.113.7",
    )
    expect(limitedAs(ask("/api/auth/sign-up/email", { from: "203.0.113.7" }))).toBe(
      "auth:203.0.113.7",
    )
    expect(limitedAs(ask("/api/computers/pair/start", { from: "2001:db8::1" }))).toBe(
      "pair:2001:db8::1",
    )
    // A Dood is hatched, stroked and fed by people with no account.
    for (const path of ["/api/doods", "/api/doods/abc/treat", "/api/doods/abc/claim"]) {
      expect(limitedAs(ask(path, { from: "203.0.113.7" }))).toBe("dood:203.0.113.7")
    }
    expect(limitedAs(ask("/api/doods/abc/pats", { from: "203.0.113.7" }))).toBe("pat:203.0.113.7")
    expect(limitedAs(ask("/api/doods/abc", { method: "GET", from: "203.0.113.7" }))).toBeUndefined()
  })

  it("counts nothing else", () => {
    // Reading who is signed in, which every page does.
    expect(
      limitedAs(ask("/api/auth/get-session", { method: "GET", from: "203.0.113.7" })),
    ).toBeUndefined()
    // A daemon waiting to be confirmed asks every few seconds.
    expect(limitedAs(ask("/api/computers/pair/poll", { from: "203.0.113.7" }))).toBeUndefined()
    expect(
      limitedAs(ask("/api/agents/a/chats/1/messages", { from: "203.0.113.7" })),
    ).toBeUndefined()
    // Nothing in front that says where it came from: nothing to count by.
    expect(limitedAs(ask("/api/auth/sign-in/email"))).toBeUndefined()
  })

  it("refuses one address over its limit and nobody else", async () => {
    const limiter = counting(2)
    const signIn = (from: string) => overLimit(ask("/api/auth/sign-in/email", { from }), limiter)
    expect(await signIn("203.0.113.7")).toBeUndefined()
    expect(await signIn("203.0.113.7")).toBeUndefined()
    const refused = await signIn("203.0.113.7")
    expect(refused?.status).toBe(429)
    expect(refused?.headers.get("retry-after")).toBe("60")
    expect(await refused?.json()).toMatchObject({ code: "rate_limited" })
    expect(await signIn("203.0.113.8")).toBeUndefined()
    // Pairing is counted apart from signing in.
    expect(
      await overLimit(ask("/api/computers/pair/start", { from: "203.0.113.7" }), limiter),
    ).toBeUndefined()
  })

  it("asks nothing of the limiter for what is not counted", async () => {
    const limiter = counting(0)
    expect(
      await overLimit(ask("/api/agents", { method: "GET", from: "203.0.113.7" }), limiter),
    ).toBeUndefined()
    expect(limiter.keys).toEqual([])
  })

  it("lets everything through without a limiter, or with one that fails", async () => {
    const request = () => ask("/api/auth/sign-in/email", { from: "203.0.113.7" })
    expect(await overLimit(request(), undefined)).toBeUndefined()
    const broken: Limiter = { limit: () => Promise.reject(new Error("unavailable")) }
    expect(await overLimit(request(), broken)).toBeUndefined()
  })
})
