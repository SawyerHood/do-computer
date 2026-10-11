import { describe, expect, it } from "vitest"
import { agentPrompt, GUIDES, guideOf, headingId, readGuide } from "./docs"

describe("a guide read from its file", () => {
  const text = [
    "# Running it",
    "",
    "What this is for,",
    "on two lines.",
    "",
    "## First, this",
    "",
    "```sh",
    "## not a heading",
    "```",
    "",
    "## Then `that`",
    "",
    "The end.",
    "",
  ].join("\n")

  it("has its title, what it is for, and the rest", () => {
    const guide = readGuide("running", text)
    expect(guide).toMatchObject({
      slug: "running",
      title: "Running it",
      summary: "What this is for, on two lines.",
      text,
    })
    expect(guide?.body.startsWith("## First, this")).toBe(true)
  })

  it("has a section for each heading, and none for a comment among commands", () => {
    expect(readGuide("running", text)?.sections).toEqual([
      { id: "first-this", title: "First, this" },
      { id: "then-that", title: "Then `that`" },
    ])
  })

  it("is not a guide without a title", () => {
    expect(readGuide("notes", "Some notes.\n")).toBeUndefined()
  })
})

describe("the guides of the repository", () => {
  it("start with self-hosting", () => {
    expect(GUIDES[0]?.slug).toBe("self-hosting")
    expect(guideOf("self-hosting")?.title).toBe("Self-hosting")
    expect(guideOf("nothing")).toBeUndefined()
  })

  it("each say what they are for, and have sections no two of which share an address", () => {
    for (const guide of GUIDES) {
      expect(guide.summary.length, guide.slug).toBeGreaterThan(20)
      expect(guide.sections.length, guide.slug).toBeGreaterThan(0)
      const ids = guide.sections.map((section) => section.id)
      expect(new Set(ids).size, guide.slug).toBe(ids.length)
    }
  })

  it("are given to an agent by the address of their file", () => {
    const guide = guideOf("self-hosting")
    if (guide === undefined) throw new Error("no guide")
    expect(agentPrompt("https://agent.example.com", guide)).toBe(
      "Follow https://agent.example.com/docs/self-hosting.md and set up Do Computer for me.",
    )
  })

  it("address a heading by its words", () => {
    expect(headingId("On a machine of yours")).toBe("on-a-machine-of-yours")
    expect(headingId("Then `that`")).toBe("then-that")
  })
})
