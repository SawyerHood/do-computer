import { describe, expect, it } from "vitest"
import {
  computerName,
  iconFits,
  iconPicture,
  mayUseBridge,
  provider,
  shareAnswer,
  sharingNow,
} from "../src/page-bridge.ts"

describe("who the app answers", () => {
  const page = {
    mainWindow: true,
    top: true,
    url: "https://do.example/welcome",
    server: "https://do.example",
  }

  it("is the top page of the main window, on the deployment", () => {
    expect(mayUseBridge(page)).toBe(true)
    expect(mayUseBridge({ ...page, url: "https://do.example/a/1?x=1#y" })).toBe(true)
  })

  it("is no page of anywhere else the window was led to", () => {
    expect(mayUseBridge({ ...page, url: "https://github.com/login" })).toBe(false)
    expect(mayUseBridge({ ...page, url: "https://do.example.evil.test/welcome" })).toBe(false)
    expect(mayUseBridge({ ...page, url: "http://do.example/welcome" })).toBe(false)
    expect(mayUseBridge({ ...page, url: "https://do.example:8443/welcome" })).toBe(false)
    expect(mayUseBridge({ ...page, url: "about:blank" })).toBe(false)
    expect(mayUseBridge({ ...page, url: "" })).toBe(false)
  })

  it("is no frame inside a page, even one of the deployment", () => {
    expect(mayUseBridge({ ...page, top: false })).toBe(false)
  })

  it("is no other window, and nobody before a deployment is chosen", () => {
    expect(mayUseBridge({ ...page, mainWindow: false })).toBe(false)
    expect(mayUseBridge({ ...page, server: undefined })).toBe(false)
  })
})

describe("what a computer is called", () => {
  it("is its name without the network's part", () => {
    expect(computerName("sawyers-air.local")).toBe("sawyers-air")
    expect(computerName("box.corp.example.com")).toBe("box")
    expect(computerName("DESKTOP-4F2K")).toBe("DESKTOP-4F2K")
  })

  it("is left alone when it has no such part to lose", () => {
    expect(computerName("192.168.1.20")).toBe("192.168.1.20")
    expect(computerName(".local")).toBe(".local")
    expect(computerName("")).toBe("")
  })
})

describe("what a page is told of sharing", () => {
  it("is on only once this computer is paired", () => {
    expect(sharingNow({ state: "connected", name: "air", readOnly: false })).toBe("on")
    expect(sharingNow({ state: "connecting", name: "air" })).toBe("on")
    expect(sharingNow({ state: "pairing", code: "AB-12", verifyUrl: "https://x" })).toBe("off")
    expect(sharingNow({ state: "starting" })).toBe("off")
    expect(sharingNow({ state: "off" })).toBe("off")
    expect(sharingNow({ state: "stopped", why: "failed" })).toBe("off")
  })

  it("is the code to confirm, or that there is nothing to confirm", () => {
    expect(shareAnswer({ state: "pairing", code: "AB-12", verifyUrl: "https://x" })).toEqual({
      code: "AB-12",
    })
    expect(shareAnswer({ state: "connecting", name: "air" })).toEqual({ connected: true })
    expect(shareAnswer({ state: "connected", name: "air", readOnly: true })).toEqual({
      connected: true,
    })
  })

  it("is what went wrong when the daemon could not start", () => {
    expect(shareAnswer({ state: "stopped", why: "failed" })).toEqual({
      error: "This computer could not be connected. Try again.",
    })
    expect(shareAnswer({ state: "stopped", why: "failed", detail: "no route" })).toEqual({
      error: "This computer could not be connected: no route",
    })
  })

  it("is nothing yet while the daemon is still getting there", () => {
    expect(shareAnswer({ state: "off" })).toBeUndefined()
    expect(shareAnswer({ state: "starting" })).toBeUndefined()
    expect(shareAnswer({ state: "stopped", why: "superseded" })).toBeUndefined()
  })
})

describe("the provider a page asks to sign in with", () => {
  it("is one of the two there are, or none", () => {
    expect(provider("github")).toBe("github")
    expect(provider("google")).toBe("google")
    expect(provider("evil&port=1")).toBeUndefined()
    expect(provider(undefined)).toBeUndefined()
    expect(provider({ toString: () => "github" })).toBeUndefined()
  })
})

describe("the picture a page asks the app to be shown by", () => {
  const png = `data:image/png;base64,${Buffer.from("not really a picture").toString("base64")}`

  it("is a PNG's address, or nothing for the usual one", () => {
    expect(iconPicture(png)).toBe(png)
    expect(iconPicture(null)).toBeNull()
  })

  it("is nothing else a page could send", () => {
    expect(iconPicture(undefined)).toBeUndefined()
    expect(iconPicture("")).toBeUndefined()
    expect(iconPicture({ toString: () => png })).toBeUndefined()
    expect(iconPicture("https://do.example/icon.png")).toBeUndefined()
    expect(iconPicture("file:///etc/passwd")).toBeUndefined()
    expect(iconPicture("data:image/svg+xml;base64,PHN2Zy8+")).toBeUndefined()
    expect(iconPicture("data:image/png;base64,<script>")).toBeUndefined()
    expect(iconPicture(`data:image/png;base64,${"A".repeat(2_000_000)}`)).toBeUndefined()
  })

  it("is square, and neither a speck nor a poster", () => {
    expect(iconFits({ width: 1024, height: 1024 })).toBe(true)
    expect(iconFits({ width: 512, height: 512 })).toBe(true)
    expect(iconFits({ width: 1024, height: 512 })).toBe(false)
    expect(iconFits({ width: 16, height: 16 })).toBe(false)
    expect(iconFits({ width: 4096, height: 4096 })).toBe(false)
  })
})
