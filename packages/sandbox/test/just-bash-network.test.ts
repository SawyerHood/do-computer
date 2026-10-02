import { guardedFetch } from "@durable-computer/runtime"
import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node"
import { describe, expect, it } from "vitest"
import { createJustBashSandbox } from "../src/index.ts"

type Seen = { url: string; method: string; body: string | undefined; redirect: string | undefined }

/** A small web, standing in for the network. */
function web() {
  const seen: Seen[] = []
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    seen.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body === undefined || init.body === null ? undefined : String(init.body),
      redirect: init?.redirect,
    })
    const { pathname, hostname } = new URL(url)
    if (hostname === "example.test" && pathname === "/hello") {
      return new Response("hello from the web\n", { headers: { "content-type": "text/plain" } })
    }
    if (pathname === "/data.json") return Response.json({ items: [1, 2, 3] })
    if (pathname === "/echo") return new Response(`got ${init?.method}: ${String(init?.body)}`)
    if (pathname === "/moved") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://example.test/hello" },
      })
    }
    if (pathname === "/inside") {
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest" },
      })
    }
    if (pathname === "/huge") return new Response(new Uint8Array(11 * 1024 * 1024))
    return new Response("not found", { status: 404 })
  }
  return { fetch, seen }
}

async function open(network = true) {
  const { fetch, seen } = web()
  const sandbox = await createJustBashSandbox({
    id: "net",
    database: await openNodeSqliteDatabase(":memory:"),
    // As the app passes it: public hosts only, over http or https.
    ...(network ? { fetch: guardedFetch(fetch, false, { allowHttp: true }) } : {}),
  })
  return { sandbox, seen }
}

describe("just-bash: network", () => {
  it("has none unless it is given one", async () => {
    const { sandbox } = await open(false)
    expect(sandbox.capabilities.network).toBe(false)
    const result = await sandbox.exec("curl -s https://example.test/hello")
    expect(result.exitCode).not.toBe(0)
    expect(result.output).toContain("command not found")
  })

  it("fetches pages with curl, and can pipe and save what it gets", async () => {
    const { sandbox, seen } = await open()
    expect(sandbox.capabilities.network).toBe(true)
    expect((await sandbox.exec("curl -s https://example.test/hello")).output).toBe(
      "hello from the web\n",
    )
    // Plain http to a public host works too; plenty of the web still is.
    expect((await sandbox.exec("curl -s http://example.test/hello | tr a-z A-Z")).output).toBe(
      "HELLO FROM THE WEB\n",
    )
    const piped = await sandbox.exec(
      "curl -s https://example.test/data.json | jq '.items | length'",
    )
    expect(piped.output.trim()).toBe("3")
    await sandbox.exec("curl -s -o page.txt https://example.test/hello")
    expect((await sandbox.exec("cat page.txt")).output).toBe("hello from the web\n")
    expect(seen.every((request) => request.url.includes("example.test"))).toBe(true)
  })

  it("sends data, and follows a redirect to where the page went", async () => {
    const { sandbox, seen } = await open()
    expect(
      (await sandbox.exec(`curl -s -X POST -d 'name=ada' https://example.test/echo`)).output,
    ).toBe("got POST: name=ada")
    // This shell's curl follows redirects without being told to, unlike the real one.
    expect((await sandbox.exec("curl -s https://example.test/moved")).output).toBe(
      "hello from the web\n",
    )
    // Each hop was made, and checked, by the guard rather than left to the runtime.
    expect(seen.slice(-2).map((request) => [request.url, request.redirect])).toEqual([
      ["https://example.test/moved", "manual"],
      ["https://example.test/hello", "manual"],
    ])
  })

  it("cannot reach the server's own network, directly or by a redirect", async () => {
    const { sandbox, seen } = await open()
    for (const address of [
      "http://127.0.0.1:3000/api/health",
      "http://localhost:8080/",
      "http://169.254.169.254/latest/meta-data/",
      "https://10.0.0.4/admin",
      "http://[::1]/",
    ]) {
      const result = await sandbox.exec(`curl -s ${address}`)
      expect(`${address} -> ${result.exitCode === 0 ? "reached" : "refused"}`).toBe(
        `${address} -> refused`,
      )
    }
    // None of those left the shell.
    expect(seen).toEqual([])

    const redirected = await sandbox.exec("curl -s -L https://example.test/inside")
    expect(redirected.exitCode).not.toBe(0)
    expect(seen.map((request) => request.url)).toEqual(["https://example.test/inside"])
  })

  it("refuses a response too large to hold", async () => {
    const { sandbox } = await open()
    const result = await sandbox.exec("curl -s -o big.bin https://example.test/huge")
    expect(result.exitCode).not.toBe(0)
    expect((await sandbox.exec("ls big.bin 2>&1")).exitCode).not.toBe(0)
  })
})
