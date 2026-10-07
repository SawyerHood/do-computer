import { describe, expect, it } from "vitest"
import { ConfigError, readConfig } from "./platform.ts"
import { computerChoices, offeredKinds } from "./sandbox.ts"

const ids = (env: Record<string, string>, target: "node" | "cloudflare" = "node") =>
  offeredKinds(readConfig(env), target).kinds.map((kind) => kind.id)

describe("the kinds of computer a deployment offers", () => {
  it("are the ones that need nothing, when nothing is configured", () => {
    expect(ids({})).toEqual(["just-bash", "none"])
    expect(offeredKinds(readConfig({}), "node").default).toBe("just-bash")
  })

  it("include a provider once its key is set", () => {
    expect(ids({ DAYTONA_API_KEY: "key" })).toEqual(["just-bash", "daytona", "none"])
    expect(ids({ MODAL_TOKEN_ID: "id", MODAL_TOKEN_SECRET: "secret" })).toEqual([
      "just-bash",
      "modal",
      "none",
    ])
    // Half of Modal's pair is not enough.
    expect(ids({ MODAL_TOKEN_ID: "id" })).toEqual(["just-bash", "none"])
  })

  it("leave out what the runtime cannot run", () => {
    const modal = { MODAL_TOKEN_ID: "id", MODAL_TOKEN_SECRET: "secret" }
    expect(ids(modal, "cloudflare")).toEqual(["just-bash", "none"])
  })

  it("include a container only when it is asked for", () => {
    expect(ids({}, "cloudflare")).toEqual(["just-bash", "none"])
    expect(ids({ DC_SANDBOX: "cloudflare" }, "cloudflare")).toEqual([
      "just-bash",
      "cloudflare",
      "none",
    ])
    expect(ids({ DC_SANDBOX_KINDS: "just-bash,cloudflare" }, "cloudflare")).toEqual([
      "just-bash",
      "cloudflare",
    ])
  })

  it("can be named outright, and then always include the default", () => {
    const env = { DAYTONA_API_KEY: "key", DC_SANDBOX_KINDS: " daytona " }
    expect(ids(env)).toEqual(["just-bash", "daytona"])
    expect(ids({ ...env, DC_SANDBOX: "daytona" })).toEqual(["daytona"])
  })

  it("stop the server when a named kind cannot work, saying what it lacks", () => {
    const refused = (env: Record<string, string>, target: "node" | "cloudflare" = "node") => {
      try {
        offeredKinds(readConfig(env), target)
      } catch (error) {
        if (error instanceof ConfigError) return error.message
        throw error
      }
      return undefined
    }
    expect(refused({ DC_SANDBOX: "daytona" })).toBe(
      "DC_SANDBOX is daytona, which needs DAYTONA_API_KEY.",
    )
    expect(refused({ DC_SANDBOX: "cloudflare" })).toBe(
      "DC_SANDBOX is cloudflare, which only works when the app runs on Cloudflare. This is Node.",
    )
    expect(refused({ DC_SANDBOX: "modal" }, "cloudflare")).toBe(
      "DC_SANDBOX is modal, which only works when the app runs on Node. This is Cloudflare.",
    )
    expect(refused({ DC_SANDBOX_KINDS: "just-bash,modal" })).toBe(
      "DC_SANDBOX_KINDS includes modal, which needs MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.",
    )
    expect(() => readConfig({ DC_SANDBOX_KINDS: "just-bash,daytonna" })).toThrow(
      'DC_SANDBOX_KINDS includes "daytonna". It must be one of',
    )
    expect(() => readConfig({ DC_SANDBOX: "bash" })).toThrow('DC_SANDBOX is "bash".')
  })

  it("build a computer for each kind on offer, and none for no computer or a kind not offered", () => {
    const choices = computerChoices(readConfig({ DAYTONA_API_KEY: "key" }), "node", {})
    const host = { name: "agent-1", sql: {} } as never
    expect(choices.default).toBe("just-bash")
    expect(choices.create("just-bash", "agent-1", host)?.id).toBe("just-bash:agent-1")
    expect(choices.create("daytona", "machine-1", host)?.capabilities.realBinaries).toBe(true)
    expect(choices.create("none", "agent-1", host)).toBeUndefined()
    expect(choices.create("modal", "machine-1", host)).toBeUndefined()
  })

  it("build a machine that agents share from its key alone, and the built-in shell only for an agent", () => {
    const choices = computerChoices(readConfig({ DAYTONA_API_KEY: "key" }), "node", {})
    // Whoever asks, the same key is the same machine: that is what lets agents share one.
    expect(choices.create("daytona", "machine-1")?.id).toBe("daytona:machine-1")
    expect(choices.create("daytona", "machine-1", { name: "agent-2", sql: {} } as never)?.id).toBe(
      "daytona:machine-1",
    )
    // The built-in shell's files are with one agent, so there is none without an agent.
    expect(choices.create("just-bash", "agent-1")).toBeUndefined()
  })
})
