import { describe, expect, it } from "vitest"
import { atServer, cameBack, isWebAddress, onServer, serverAddress } from "../src/server.ts"

describe("the address of a deployment", () => {
  it("is its origin, whatever page of it was pasted", () => {
    expect(serverAddress("https://do.example/a/123/c/1?x=1")).toBe("https://do.example")
    expect(serverAddress("  https://do.example/  ")).toBe("https://do.example")
  })

  it("is taken to be https where no scheme was typed, and http on this machine", () => {
    expect(serverAddress("do.example")).toBe("https://do.example")
    expect(serverAddress("localhost:3000")).toBe("http://localhost:3000")
    expect(serverAddress("127.0.0.1:3000/login")).toBe("http://127.0.0.1:3000")
    expect(serverAddress("http://box.local:3000")).toBe("http://box.local:3000")
  })

  it("is nothing when what was typed is no address a browser could open", () => {
    expect(serverAddress("")).toBeUndefined()
    expect(serverAddress("   ")).toBeUndefined()
    expect(serverAddress("file:///etc/passwd")).toBeUndefined()
    expect(serverAddress("javascript://alert(1)")).toBeUndefined()
    expect(serverAddress("not an address")).toBeUndefined()
  })
})

describe("where a link leads", () => {
  it("is the deployment only when it is the same origin", () => {
    expect(onServer("https://do.example/pair?code=AB", "https://do.example")).toBe(true)
    expect(onServer("https://do.example.evil.test/", "https://do.example")).toBe(false)
    expect(onServer("http://do.example/", "https://do.example")).toBe(false)
    expect(onServer("nonsense", "https://do.example")).toBe(false)
  })

  it("is somewhere a browser can go only when it is a web address", () => {
    expect(isWebAddress("https://github.com/login")).toBe(true)
    expect(isWebAddress("file:///Applications/Calculator.app")).toBe(false)
    expect(isWebAddress("smb://server/share")).toBe(false)
  })

  it("is back from a sign-in elsewhere only at a page of the deployment", () => {
    const server = "https://do.example"
    expect(cameBack("https://do.example/a/7/connectors?connected=linear", server)).toBe(true)
    expect(cameBack("https://do.example/", server)).toBe(true)
    // What the service answers at is on the way back, and leads to a page.
    expect(cameBack("https://do.example/api/connectors/callback?code=1&state=2", server)).toBe(
      false,
    )
    expect(cameBack("https://linear.app/oauth/authorize", server)).toBe(false)
    expect(cameBack("https://do.example.evil.test/a/7", server)).toBe(false)
    expect(cameBack("nonsense", server)).toBe(false)
  })

  it("is a page of the app's own server by either of its addresses, and shown at the first", () => {
    const server = "http://127.0.0.1:4310"
    const also = "https://box.tail1234.ts.net:4310"
    expect(atServer("http://127.0.0.1:4310/a/7", server, also)).toBe("http://127.0.0.1:4310/a/7")
    expect(atServer("https://box.tail1234.ts.net:4310/a/7/c/1?x=1#end", server, also)).toBe(
      "http://127.0.0.1:4310/a/7/c/1?x=1#end",
    )
    // Another port of the same computer is another program's.
    expect(atServer("https://box.tail1234.ts.net/a/7", server, also)).toBeUndefined()
    expect(atServer("https://linear.app/oauth/authorize", server, also)).toBeUndefined()
    // A server with one address has only that one.
    expect(atServer("https://box.tail1234.ts.net:4310/a/7", server)).toBeUndefined()
    expect(atServer("nonsense", server, also)).toBeUndefined()
  })
})
