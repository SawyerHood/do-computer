import { describe, expect, it } from "vitest"
import { parseSettings, settingsAddress, validateAppSearch } from "./settings.ts"

describe("a place in the settings, as the address has it", () => {
  it("is read back as it was written", () => {
    for (const place of [
      { at: "top" },
      { at: "top", section: "agents" },
      { at: "agent", agentId: "a1b2" },
      { at: "agent", agentId: "a1b2", section: "memory" },
      { at: "workspace", workspaceId: "personal:u1" },
      { at: "workspace", workspaceId: "personal:u1", section: "computers" },
    ] as const) {
      expect(parseSettings(settingsAddress(place))).toEqual(place)
    }
    expect(settingsAddress({ at: "agent", agentId: "a1b2", section: "memory" })).toBe(
      "agent.a1b2.memory",
    )
  })

  it("is nowhere when it names a section there is not", () => {
    expect(parseSettings("agent.a1b2.people")).toBeUndefined()
    expect(parseSettings("workspace.w1.memory")).toBeUndefined()
    expect(parseSettings("agent.a1b2.memory.more")).toBeUndefined()
    expect(parseSettings("nowhere")).toBeUndefined()
  })

  it("still opens from an address of before there was one window", () => {
    // `?settings=<section>` was the agent on screen, and two of its sections are now one.
    expect(parseSettings("identity")).toEqual({ at: "agent", section: "profile" })
    expect(parseSettings("manage")).toEqual({ at: "agent", section: "profile" })
    expect(parseSettings("slack")).toEqual({ at: "agent", section: "slack" })
    // `?workspace=<section>` was the workspace on screen, and held what is now the user's own.
    const was = (section: string) =>
      parseSettings(validateAppSearch({ workspace: section }).settings!)
    expect(was("team")).toEqual({ at: "workspace", section: "people" })
    expect(was("computers")).toEqual({ at: "workspace", section: "computers" })
    expect(was("agents")).toEqual({ at: "top", section: "general" })
    expect(was("notifications")).toEqual({ at: "top", section: "notifications" })
    expect(was("server")).toEqual({ at: "top", section: "server" })
    expect(validateAppSearch({ workspace: "nowhere" })).toEqual({})
    expect(validateAppSearch({ settings: "nowhere", connected: "c1" })).toEqual({ connected: "c1" })
  })
})
