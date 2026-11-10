import { describe, expect, it } from "vitest"
import { answerExactApp, EXACT_COOKIE, type ExactBuild } from "./exact-app.ts"

const files: Record<string, string> = {
  "index.html": '<!doctype html>\n<base href="/">\n<script type="module" src="./app.js"></script>',
  "app.js": "export {}",
  "markdown.wasm": "\0asm",
  "assets/fonts/Geist-Variable.ttf": "font",
  ".exact-build.json": "{}",
  "routes.json": JSON.stringify({
    routes: [
      { name: "doods", pattern: "/", render: "client", notfound: false },
      { name: "dood", pattern: "/a/:agentId", render: "client", notfound: false },
      { name: "chat", pattern: "/a/:agentId/c/:chatId", render: "client", notfound: false },
    ],
  }),
}
const build: ExactBuild = {
  read: async (path) => (path in files ? new TextEncoder().encode(files[path]) : undefined),
}
const react = () => new Response("the React app")

const PAGE = { "sec-fetch-mode": "navigate", accept: "text/html" }
const CHOSE = { ...PAGE, cookie: `theme=dark; ${EXACT_COOKIE}=exact` }
const ask = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  answerExactApp(new Request(`https://dc.test${path}`, { method, headers }), build, react)

describe("the Exact app at the server's own origin", () => {
  it("is nowhere without a build", async () => {
    for (const path of ["/x/", "/x/app.js"]) {
      const response = await answerExactApp(
        new Request(`https://dc.test${path}`, { headers: CHOSE }),
        undefined,
        react,
      )
      expect(await response.text()).toBe("the React app")
    }
  })

  it("serves its files under /x/, each as what it is", async () => {
    const script = await ask("/x/app.js")
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
    expect(await script.text()).toBe("export {}")
    expect((await ask("/x/markdown.wasm")).headers.get("content-type")).toBe("application/wasm")
    expect((await ask("/x/assets/fonts/Geist-Variable.ttf")).headers.get("content-type")).toBe(
      "font/ttf",
    )
    expect((await ask("/x/app.js", {}, "HEAD")).status).toBe(200)
    expect((await ask("/x/app.js", {}, "POST")).status).toBe(405)
  })

  it("serves nothing hidden or outside the build", async () => {
    for (const path of [
      "/x/.exact-build.json",
      "/x/%2e%2e%2fsecret",
      "/x/a/..%2f..%2fsecret",
      "/x/missing.js",
    ]) {
      expect((await ask(path)).status, path).toBe(404)
    }
  })

  it("is chosen at /x/, and a page asked for there is opened at its own address", async () => {
    const chosen = await ask("/x/", PAGE)
    expect(chosen.status).toBe(303)
    expect(chosen.headers.get("location")).toBe("/")
    const set = chosen.headers.get("set-cookie")!
    expect(set).toContain(`${EXACT_COOKIE}=exact`)
    expect(set).toContain("HttpOnly")
    expect(set).toContain("SameSite=Lax")
    expect(set).toContain("Secure")
    const deep = await ask("/x/a/agent-1/c/chat-1?q=1", PAGE)
    expect(deep.headers.get("location")).toBe("/a/agent-1/c/chat-1?q=1")
    // What is no page of the app's leads to its first, and never to another site.
    for (const path of ["/x/nowhere", "/x//evil.test", "/x/%2F%2Fevil.test"]) {
      expect((await ask(path, PAGE)).headers.get("location"), path).toBe("/")
    }
  })

  it("draws the pages of whoever chose it, finding its files under /x/", async () => {
    for (const path of ["/", "/a/agent-1", "/a/agent-1/c/chat-1"]) {
      const response = await ask(path, CHOSE)
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
      expect(response.headers.get("cache-control")).toBe("no-store")
      const page = await response.text()
      expect(page).toContain('<base href="/x/">')
      expect(page).toContain('src="./app.js"')
    }
  })

  it("leaves everything else, and everyone else, to the React app", async () => {
    // Not chosen.
    expect(await (await ask("/a/agent-1", PAGE)).text()).toBe("the React app")
    // Not a page the Exact app has, nor a page at all.
    expect(await (await ask("/login", CHOSE)).text()).toBe("the React app")
    expect(await (await ask("/api/me", { cookie: `${EXACT_COOKIE}=exact` })).text()).toBe(
      "the React app",
    )
    expect(
      await (
        await ask("/a/agent-1", { cookie: `${EXACT_COOKIE}=exact`, "sec-fetch-mode": "cors" })
      ).text(),
    ).toBe("the React app")
    expect(await (await ask("/a/agent-1", { ...CHOSE }, "POST")).text()).toBe("the React app")
  })

  it("is let go of at /x/off", async () => {
    const off = await ask("/x/off", CHOSE)
    expect(off.status).toBe(303)
    expect(off.headers.get("location")).toBe("/")
    expect(off.headers.get("set-cookie")).toContain("Max-Age=0")
  })
})
