import { describe, expect, it } from "vitest"
import { readConfig } from "./platform.ts"

const github = { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" }

describe("sign-in with a password", () => {
  it("is offered unless it is turned off", () => {
    expect(readConfig({}).passwordSignIn).toBe(true)
    expect(readConfig(github).passwordSignIn).toBe(true)
    expect(readConfig({ ...github, DC_PASSWORD_SIGNIN: "" }).passwordSignIn).toBe(true)
    for (const off of ["off", "OFF", "0", "false"]) {
      expect(readConfig({ ...github, DC_PASSWORD_SIGNIN: off }).passwordSignIn).toBe(false)
    }
  })

  it("stays where it is the only way in", () => {
    expect(readConfig({ DC_PASSWORD_SIGNIN: "off" }).passwordSignIn).toBe(true)
    // Half of a provider's settings is not a provider.
    expect(readConfig({ DC_PASSWORD_SIGNIN: "off", GOOGLE_CLIENT_ID: "id" }).passwordSignIn).toBe(
      true,
    )
    expect(
      readConfig({ DC_PASSWORD_SIGNIN: "off", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" })
        .passwordSignIn,
    ).toBe(false)
  })
})

describe("a server the desktop app runs for its owner", () => {
  it("is one only where it was given the app's key, and its owner signs it in to models", () => {
    expect(readConfig({}).ownerKey).toBeUndefined()
    expect(readConfig({ DC_OWNER_KEY: "" }).ownerKey).toBeUndefined()
    expect(readConfig({ DC_ADMIN_EMAILS: "A@example.com" }).adminEmails).toEqual(["a@example.com"])
    const local = readConfig({ DC_OWNER_KEY: "key", DC_ADMIN_EMAILS: "A@example.com" })
    expect(local.ownerKey).toBe("key")
    expect(local.adminEmails).toEqual(["a@example.com", "you@localhost"])
  })
})

describe("the other addresses a server is reached at", () => {
  it("are origins, as a browser says them, and nothing that is not an address", () => {
    expect(readConfig({}).alsoAt).toEqual([])
    expect(
      readConfig({
        DC_ALSO_AT:
          "http://127.0.0.1:4310/, https://box.tail1234.ts.net:4310/welcome, nonsense, file:///etc",
      }).alsoAt,
    ).toEqual(["http://127.0.0.1:4310", "https://box.tail1234.ts.net:4310"])
  })
})

describe("a switch only a test turns on", () => {
  it("is off unless it is turned on, and refused on a server run for real", () => {
    expect(readConfig({}).testOldSideChats).toBe(false)
    expect(readConfig({ DC_TEST_OLD_SIDE_CHATS: "1" }).testOldSideChats).toBe(true)
    expect(() => readConfig({ DC_TEST_OLD_SIDE_CHATS: "1", NODE_ENV: "production" })).toThrow(
      /DC_TEST_OLD_SIDE_CHATS is for tests/,
    )
    expect(readConfig({ NODE_ENV: "production" }).testOldSideChats).toBe(false)
  })
})
