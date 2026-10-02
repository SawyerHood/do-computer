import { describe, expect, it } from "vitest"
import {
  BlockedAddressError,
  checkAddress,
  guardedFetch,
  isPrivateHost,
} from "../src/guarded-fetch.ts"

describe("isPrivateHost", () => {
  it.each([
    "localhost",
    "LOCALHOST.",
    "app.localhost",
    "printer.local",
    "metadata.google.internal",
    "intranet",
    "127.0.0.1",
    "127.8.9.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "[::1]",
    "[::]",
    "[fd00::1]",
    "[fe80::1]",
    "[::ffff:10.0.0.1]",
    "[::ffff:7f00:1]",
  ])("treats %s as private", (host) => {
    expect(isPrivateHost(host)).toBe(true)
  })

  it.each(["example.com", "mcp.linear.app", "8.8.8.8", "172.32.0.1", "[2606:4700::1111]"])(
    "treats %s as public",
    (host) => {
      expect(isPrivateHost(host)).toBe(false)
    },
  )
})

describe("checkAddress", () => {
  it("requires https and a public host", () => {
    expect(checkAddress("https://mcp.example.com/mcp", false).hostname).toBe("mcp.example.com")
    expect(() => checkAddress("http://mcp.example.com/mcp", false)).toThrow(BlockedAddressError)
    expect(() => checkAddress("https://169.254.169.254/latest", false)).toThrow(/private network/)
    // The form a URL parser normalises a decimal address to.
    expect(() => checkAddress("https://2130706433/", false)).toThrow(/private network/)
  })

  it("allows private hosts and http when the deployment says so, but nothing stranger", () => {
    expect(checkAddress("http://127.0.0.1:9000/mcp", true).port).toBe("9000")
    expect(() => checkAddress("file:///etc/passwd", true)).toThrow(BlockedAddressError)
  })
})

describe("guardedFetch", () => {
  const redirect = (location: string, status = 302) =>
    new Response(null, { status, headers: { location } })

  it("refuses a private address without calling it", async () => {
    const seen: string[] = []
    const guarded = guardedFetch(async (input) => {
      seen.push(String(input))
      return new Response("ok")
    }, false)
    await expect(guarded("https://10.0.0.5/mcp")).rejects.toThrow(BlockedAddressError)
    expect(seen).toEqual([])
  })

  it("follows redirects itself and refuses one that leads inside", async () => {
    const seen: string[] = []
    const guarded = guardedFetch(async (input, init) => {
      seen.push(`${init?.method ?? "GET"} ${String(input)}`)
      expect(init?.redirect).toBe("manual")
      if (String(input) === "https://a.example/start") return redirect("https://b.example/next")
      if (String(input) === "https://b.example/next")
        return redirect("http://169.254.169.254/latest/meta-data")
      return new Response("secret")
    }, false)
    await expect(guarded("https://a.example/start")).rejects.toThrow(BlockedAddressError)
    expect(seen).toEqual(["GET https://a.example/start", "GET https://b.example/next"])
  })

  it("repeats the request for a 307 and switches to GET for a 302", async () => {
    const seen: { method: string; url: string; body: unknown }[] = []
    const guarded = guardedFetch(async (input, init) => {
      seen.push({ method: init?.method ?? "GET", url: String(input), body: init?.body })
      if (String(input).endsWith("/one")) return redirect("/two", 307)
      if (String(input).endsWith("/two")) return redirect("/three", 302)
      return new Response("done")
    }, false)
    const response = await guarded("https://a.example/one", { method: "POST", body: "{}" })
    expect(await response.text()).toBe("done")
    expect(seen).toEqual([
      { method: "POST", url: "https://a.example/one", body: "{}" },
      { method: "POST", url: "https://a.example/two", body: "{}" },
      { method: "GET", url: "https://a.example/three", body: undefined },
    ])
  })

  it("gives up on a redirect loop", async () => {
    const guarded = guardedFetch(async () => redirect("https://a.example/again"), false)
    await expect(guarded("https://a.example/again")).rejects.toThrow(/Too many redirects/)
  })

  it("is the plain fetch when private hosts are allowed", async () => {
    const guarded = guardedFetch(async (input) => new Response(String(input)), true)
    expect(await (await guarded("http://127.0.0.1:1/x")).text()).toBe("http://127.0.0.1:1/x")
  })
})
