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
