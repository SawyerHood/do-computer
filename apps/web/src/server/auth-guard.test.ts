import { AsyncLocalStorage } from "node:async_hooks"
import { betterAuth } from "better-auth"
import { afterEach, describe, expect, it, vi } from "vitest"
import { askTwice, AUTH_STORES, authStores, seedAuthStores } from "./auth-guard.ts"

describe("Better Auth's stores", () => {
  it("are there before Better Auth asks for them, and are not made twice", () => {
    seedAuthStores()
    const first = { ...authStores() }
    for (const store of AUTH_STORES) expect(first[store]).toBeInstanceOf(AsyncLocalStorage)
    seedAuthStores()
    expect(authStores()).toEqual(first)
  })

  it("are all of the stores this version of Better Auth waits for", async () => {
    seedAuthStores()
    const seeded = { ...authStores() }
    // A call goes through each of them. One the library made for itself would be one it had
    // waited for, which is what must not happen: add its name to the list.
    const auth = betterAuth({
      secret: "a secret that is long enough for this test",
      baseURL: "http://localhost",
    })
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull()
    const stores = Object.keys(authStores()).filter((name) => name.endsWith("AsyncStorage"))
    expect(stores.sort()).toEqual([...AUTH_STORES].sort())
    for (const store of AUTH_STORES) expect(authStores()[store]).toBe(seeded[store])
  })
})

describe("asking twice", () => {
  afterEach(() => vi.useRealTimers())

  it("gives the answer when there is one", async () => {
    const renew = vi.fn()
    expect(await askTwice(async () => "here", { ms: 50, renew })).toBe("here")
    expect(renew).not.toHaveBeenCalled()
  })

  it("asks again of a new instance when the first never answers", async () => {
    vi.useFakeTimers()
    let instance = "stuck"
    const said: string[] = []
    const answer = askTwice(
      () => (instance === "stuck" ? new Promise<string>(() => {}) : Promise.resolve(instance)),
      { ms: 5_000, renew: () => (instance = "new"), report: (message) => said.push(message) },
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await answer).toBe("new")
    expect(said).toEqual(["no answer in 5000 ms: asking again of a new instance"])
  })

  it("fails when neither answers, where it would have waited for good", async () => {
    vi.useFakeTimers()
    const renew = vi.fn()
    const answer = askTwice(() => new Promise<string>(() => {}), { ms: 5_000, renew })
    const failed = expect(answer).rejects.toThrow("could not be checked")
    await vi.advanceTimersByTimeAsync(10_000)
    await failed
    expect(renew).toHaveBeenCalledTimes(2)
  })

  it("passes on a failure as it is", async () => {
    const renew = vi.fn()
    await expect(
      askTwice(() => Promise.reject(new Error("refused")), { ms: 50, renew }),
    ).rejects.toThrow("refused")
    expect(renew).not.toHaveBeenCalled()
  })
})
