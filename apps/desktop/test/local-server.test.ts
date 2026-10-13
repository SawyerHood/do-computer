import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { cookieDetails } from "../src/cookies.ts"
import { localAddress, ownerKey, pickPort, serverEnv } from "../src/local-server.ts"
import { ownerName } from "../src/page-bridge.ts"
import { loadSettings, saveSettings } from "../src/settings.ts"

const scratch = () => mkdtempSync(join(tmpdir(), "dc-desktop-test-"))

describe("the app's own server", () => {
  it("is on this computer alone, and told so", () => {
    const env = serverEnv({ port: 4310, dir: "/data/server", key: "secret" })
    expect(localAddress(4310)).toBe("http://127.0.0.1:4310")
    expect(env).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      PORT: "4310",
      HOST: "127.0.0.1",
      DC_DATA_DIR: "/data/server",
      DC_OWNER_KEY: "secret",
      DC_STOP_WITH_INPUT: "1",
      DC_BASE_URL: "http://127.0.0.1:4310",
      DC_ALSO_AT: "",
    })
  })

  it("goes by the address its owner's other devices reach it at, and still by this one", () => {
    const env = serverEnv({
      port: 4310,
      dir: "/data/server",
      key: "secret",
      reachedAt: "https://bee.tail1234.ts.net:4310",
    })
    expect(env.DC_BASE_URL).toBe("https://bee.tail1234.ts.net:4310")
    expect(env.DC_ALSO_AT).toBe("http://127.0.0.1:4310")
    // Listening is still on this computer alone: Tailscale is what the others reach.
    expect(env.HOST).toBe("127.0.0.1")
  })

  it("is not what the shell the app was started from says a deployment is", () => {
    const env = {
      DC_SIGNUP: "open",
      DC_LANDING: "1",
      ...serverEnv({ port: 1, dir: "/d", key: "k" }),
    }
    expect(env.DC_SIGNUP).toBe("invite")
    expect(env.DC_LANDING).toBe("")
  })

  it("has a key only the app and it know, made once", () => {
    const dir = join(scratch(), "server")
    const key = ownerKey(dir)
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(ownerKey(dir)).toBe(key)
    expect(readFileSync(join(dir, "owner-key"), "utf8").trim()).toBe(key)
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "owner-key")).mode & 0o777).toBe(0o600)
    }
    expect(ownerKey(join(scratch(), "another"))).not.toBe(key)
  })

  it("is given a port nothing else has", async () => {
    const taken = createServer()
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve))
    const { port } = taken.address() as { port: number }
    try {
      const picked = await pickPort(port)
      expect(picked).not.toBe(port)
      expect(picked).toBeGreaterThan(0)
    } finally {
      await new Promise((resolve) => taken.close(resolve))
    }
  })
})

describe("what the app remembers about its own server", () => {
  const kept = (content: object) => {
    const file = join(scratch(), "settings.json")
    saveSettings(file, content as never)
    return loadSettings(file)
  }

  it("is that it runs one, at which port, and whether other devices reach it", () => {
    const settings = kept({
      server: "http://127.0.0.1:4310",
      local: true,
      localPort: 4310,
      tailnet: true,
      welcomed: true,
    })
    expect(settings).toMatchObject({ local: true, localPort: 4310, tailnet: true })
  })

  it("is not one without a port to be at, and nothing is served that is not the app's", () => {
    expect(kept({ server: "http://127.0.0.1:4310", local: true })).toMatchObject({
      local: false,
      tailnet: false,
    })
    expect(kept({ server: "https://do.example", localPort: 4310, tailnet: true })).toMatchObject({
      local: false,
      localPort: 4310,
      tailnet: false,
    })
    expect(kept({ server: "x", local: true, localPort: 70_000 }).local).toBe(false)
  })
})

describe("a cookie the app's own server set, as the window is given it", () => {
  const HERE = "http://127.0.0.1:4310"

  it("keeps its name and what it holds as they were sent", () => {
    const cookie = cookieDetails(
      "__Secure-better-auth.session_token=abc.def%3D%3D; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
      HERE,
      1_000_000,
    )
    expect(cookie).toEqual({
      url: HERE,
      name: "__Secure-better-auth.session_token",
      value: "abc.def%3D%3D",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      expirationDate: 1_000 + 604_800,
    })
  })

  it("lasts as long as the app runs where the server did not say how long", () => {
    const cookie = cookieDetails("a=b=c", HERE)
    expect(cookie).toMatchObject({
      name: "a",
      value: "b=c",
      secure: false,
      sameSite: "unspecified",
    })
    expect(cookie).not.toHaveProperty("expirationDate")
  })

  it("is nothing where the header names none", () => {
    expect(cookieDetails("", HERE)).toBeUndefined()
    expect(cookieDetails("=value; Path=/", HERE)).toBeUndefined()
  })
})

describe("what a page says its owner is called", () => {
  it("is a name, without the room around it, and no longer than a name is", () => {
    expect(ownerName("  Sawyer ")).toBe("Sawyer")
    expect(ownerName("x".repeat(200))).toHaveLength(80)
  })

  it("is nothing where it said none", () => {
    for (const none of ["", "   ", undefined, null, 7, { name: "Sawyer" }]) {
      expect(ownerName(none)).toBeUndefined()
    }
  })
})
