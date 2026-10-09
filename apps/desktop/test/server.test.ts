import { describe, expect, it } from "vitest"
import { isWebAddress, onServer, serverAddress } from "../src/server.ts"

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
})
