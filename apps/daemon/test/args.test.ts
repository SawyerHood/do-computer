import { describe, expect, it } from "vitest"
import { parseArguments } from "../src/args.ts"

describe("the daemon's command line", () => {
  it("takes the server as its only argument, which is how the installer runs it", () => {
    expect(parseArguments(["https://agent.example.com"])).toMatchObject({
      server: "https://agent.example.com",
      name: undefined,
      readOnly: false,
      installService: false,
    })
  })

  it("finds the server wherever it is put, without its trailing slash", () => {
    expect(parseArguments(["--read-only", "http://localhost:3000/"]).server).toBe(
      "http://localhost:3000",
    )
    expect(parseArguments(["https://a.example", "--install-service"])).toMatchObject({
      server: "https://a.example",
      installService: true,
    })
  })

  it("takes the word after --name as the name, even when it looks like an address", () => {
    expect(parseArguments(["https://a.example", "--name", "studio"])).toMatchObject({
      server: "https://a.example",
      name: "studio",
    })
    expect(parseArguments(["--name", "https://odd.example", "https://a.example"])).toMatchObject({
      server: "https://a.example",
      name: "https://odd.example",
    })
  })

  it("has no server when none was given, as when it is started again after pairing", () => {
    expect(parseArguments([]).server).toBeUndefined()
    expect(parseArguments(["--read-only"])).toMatchObject({ server: undefined, readOnly: true })
  })

  it("reads the switches", () => {
    expect(parseArguments(["--unpair"]).unpair).toBe(true)
    expect(parseArguments(["--version"]).version).toBe(true)
    expect(parseArguments(["-h"]).help).toBe(true)
    expect(parseArguments(["--help"]).help).toBe(true)
  })
})
