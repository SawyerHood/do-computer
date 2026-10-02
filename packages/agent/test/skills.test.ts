import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ChatState,
  ChatSummary,
  SkillDetail,
  SkillSummary,
  ToolPart,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import { justBashSandbox, type Sandbox } from "@durable-computer/sandbox"
import { createLocalProcessSandbox } from "@durable-computer/sandbox/testing"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor, fetchSkill, parseFrontmatter, validateSkill } from "../src/index.ts"

describe("skill format", () => {
  it("reads plain, quoted and block descriptions", () => {
    expect(parseFrontmatter("---\nname: a\ndescription: Plain text here\n---\nBody")).toEqual({
      name: "a",
      description: "Plain text here",
      body: "Body",
    })
    expect(
      parseFrontmatter('---\nname: a\ndescription: "Has: a colon"\nlicense: MIT\n---\n')
        .description,
    ).toBe("Has: a colon")
    expect(
      parseFrontmatter(
        "---\nname: a\ndescription: >\n  Folded across\n  two lines.\nother: x\n---\nB",
      ).description,
    ).toBe("Folded across two lines.")
    expect(parseFrontmatter("No frontmatter at all")).toEqual({ body: "No frontmatter at all" })
  })

  it("rejects skills that could not be used", () => {
    const skill = (frontmatter: string) => ({ "SKILL.md": `---\n${frontmatter}\n---\nBody` })
    expect(validateSkill("good-name", skill("name: good-name\ndescription: Does a thing"))).toBe(
      "Does a thing",
    )
    expect(() => validateSkill("Bad Name", skill("description: x"))).toThrow(
      "not a valid skill name",
    )
    expect(() => validateSkill("a", { "README.md": "x" })).toThrow("needs a SKILL.md")
    expect(() => validateSkill("a", skill("name: a"))).toThrow("needs a description")
    expect(() => validateSkill("a", skill("name: b\ndescription: x"))).toThrow('named "b"')
    expect(() => validateSkill("a", { ...skill("description: x"), "../escape.sh": "x" })).toThrow(
      "not a valid file path",
    )
    expect(() =>
      validateSkill("a", { ...skill("description: x"), "big.txt": "x".repeat(600_000) }),
    ).toThrow("the limit is")
  })
})

describe("installing a skill", () => {
  const SKILL = "---\nname: pdf-tools\ndescription: Work with PDF files\n---\n# PDF tools\n"
  /** A tiny GitHub: the contents API and raw files for one repository. */
  const github = (requests: string[]) => async (url: string) => {
    requests.push(url)
    const listing = (entries: object[]) => Response.json(entries)
    const file = (path: string, size = 10) => ({
      type: "file",
      path,
      size,
      download_url: `https://raw.githubusercontent.com/acme/skills/main/${path}`,
    })
    if (url === "https://api.github.com/repos/acme/skills/contents/skills/pdf-tools?ref=main") {
      return listing([
        file("skills/pdf-tools/SKILL.md"),
        { type: "dir", path: "skills/pdf-tools/scripts", size: 0, download_url: null },
      ])
    }
    if (
      url === "https://api.github.com/repos/acme/skills/contents/skills/pdf-tools/scripts?ref=main"
    ) {
      return listing([file("skills/pdf-tools/scripts/merge.sh")])
    }
    if (url.endsWith("/skills/pdf-tools/SKILL.md")) return new Response(SKILL)
    if (url.endsWith("/scripts/merge.sh")) return new Response("#!/bin/sh\necho merge\n")
    if (url === "https://api.github.com/repos/acme/empty/contents/")
      return listing([file("README.md")])
    return new Response("not found", { status: 404 })
  }

  it("fetches every file of a GitHub directory, however it was linked", async () => {
    for (const url of [
      "https://github.com/acme/skills/tree/main/skills/pdf-tools",
      "https://github.com/acme/skills/blob/main/skills/pdf-tools/SKILL.md",
    ]) {
      const requests: string[] = []
      const skill = await fetchSkill(url, github(requests))
      expect(skill.name).toBe("pdf-tools")
      expect(Object.keys(skill.files).sort()).toEqual(["SKILL.md", "scripts/merge.sh"])
      expect(skill.files["scripts/merge.sh"]).toContain("echo merge")
    }
  })

  it("fetches a single SKILL.md from a plain URL", async () => {
    const skill = await fetchSkill(
      "https://example.com/skills/pdf-tools/SKILL.md",
      async () => new Response(SKILL),
    )
    expect(skill).toEqual({ name: "pdf-tools", files: { "SKILL.md": SKILL } })
  })

  it("refuses what is not a skill, and explains", async () => {
    const requests: string[] = []
    await expect(fetchSkill("http://example.com/SKILL.md", github(requests))).rejects.toThrow(
      "https",
    )
    await expect(fetchSkill("not a url", github(requests))).rejects.toThrow("not a URL")
    await expect(fetchSkill("https://github.com/acme/empty", github(requests))).rejects.toThrow(
      "No SKILL.md",
    )
    await expect(fetchSkill("https://github.com/acme/missing", github(requests))).rejects.toThrow(
      "HTTP 404",
    )
    await expect(
      fetchSkill("https://example.com/page.html", async () => new Response("<html>hello</html>")),
    ).rejects.toThrow("not a SKILL.md")
    await expect(
      fetchSkill("https://github.com/acme/limited", async () => new Response("", { status: 403 })),
    ).rejects.toThrow("rate-limiting")
    await expect(
      fetchSkill("https://down.example.com/SKILL.md", async () => {
        throw new TypeError("fetch failed")
      }),
    ).rejects.toThrow("Could not reach down.example.com.")
  })
})

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  errors: unknown[]
}
const worlds: World[] = []

function open(directory: string, sandbox?: () => Sandbox): World {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const errors: unknown[] = []
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        sandbox: (host) => sandbox?.() ?? justBashSandbox({ id: host.name, database: host.sql }),
        fetch: async (url) =>
          url === "https://example.com/tea/SKILL.md"
            ? new Response(
                "---\nname: making-tea\ndescription: Brew tea properly\n---\nBoil water.\n",
              )
            : new Response("nope", { status: 404 }),
        onReport: (error) => errors.push(error),
      }),
    onError: (error) => errors.push(error),
  })
  namespace.start()
  const world = { namespace, faux, errors }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

async function call<T>(world: World, path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

async function say(world: World, chatId: string, text: string): Promise<ChatState> {
  const before = (await call<ChatState>(world, `/chats/${chatId}`)).messages.length
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  const deadline = Date.now() + 8_000
  for (;;) {
    const state = await call<ChatState>(world, `/chats/${chatId}`)
    if (!state.busy && state.messages.length > before + 1) return state
    if (Date.now() > deadline) throw new Error("run did not finish")
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

const lastTool = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).findLast((part): part is ToolPart => part.type === "tool")
const useTool = (name: string, args: Record<string, string>) => [
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
  fauxAssistantMessage("done"),
]
const skills = async (world: World) =>
  (await call<{ skills: SkillSummary[] }>(world, "/skills")).skills
const temporary = () => mkdtempSync(join(tmpdir(), "dc-skills-"))

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats", "POST", {})
}

describe("the browsing skill", () => {
  it("is given to an agent whose computer runs real programs, with its script", async () => {
    const computer = createLocalProcessSandbox()
    const world = open(temporary(), () => computer)
    const chat = await setup(world)
    expect((await skills(world)).map((skill) => skill.name)).toContain("browsing-the-web")

    world.faux.setResponses(useTool("skill", { action: "view", name: "browsing-the-web" }))
    const viewed = lastTool(await say(world, chat.id, "look something up on a website"))!
    expect(viewed.status).toBe("done")
    expect(viewed.output).toContain("node browse.mjs text <url>")
    const folder = `${computer.home}/.agents/skills/browsing-the-web`
    expect(viewed.output).toContain(`Its files are in ${folder} on your computer.`)

    // The script is on the computer, whole, and is a program Node accepts.
    const check = await computer.exec(`node --check ${folder}/browse.mjs && echo valid`)
    expect(check.output.trim()).toBe("valid")
    const usage = await computer.exec(`grep -c 'node browse.mjs' ${folder}/browse.mjs`)
    expect(Number(usage.output.trim())).toBeGreaterThan(4)
  })

  it("is not given to an agent whose computer cannot run a browser", async () => {
    const world = open(temporary())
    await setup(world)
    expect((await skills(world)).map((skill) => skill.name)).not.toContain("browsing-the-web")
  })
})

describe("agent skills", () => {
  it("starts with the bundled skills, listed in the prompt", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    expect((await skills(world)).map((skill) => [skill.name, skill.source])).toEqual([
      ["planning-automations", "bundled"],
      ["writing-skills", "bundled"],
    ])
    let prompt = ""
    world.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage("ok")
      },
    ])
    await say(world, chat.id, "hi")
    expect(prompt).toContain("- writing-skills: How to write a skill that works.")
    // Only the description is in the prompt; the body is loaded on demand.
    expect(prompt).not.toContain("The description decides everything")
  })

  it("lets the agent save a skill, then load and follow it in a later chat", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses(
      useTool("skill", {
        action: "create",
        name: "weekly-report",
        description: "Build the weekly sales report. Use when asked for the weekly numbers.",
        content: "# Weekly report\n\n1. Read sales.csv\n2. Sum the totals\n",
      }),
    )
    expect(
      lastTool(await say(world, chat.id, "remember how to do the weekly report")),
    ).toMatchObject({
      status: "done",
      output: 'Saved skill "weekly-report".',
    })
    expect((await skills(world)).find((skill) => skill.name === "weekly-report")).toMatchObject({
      source: "agent",
      enabled: true,
      files: ["SKILL.md"],
    })

    const later = await call<ChatSummary>(world, "/chats", "POST", {})
    let prompt = ""
    world.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage(
          [fauxToolCall("skill", { action: "view", name: "weekly-report" })],
          {
            stopReason: "toolUse",
          },
        )
      },
      fauxAssistantMessage("Following it."),
    ])
    const viewed = lastTool(await say(world, later.id, "weekly numbers please"))
    expect(prompt).toContain("- weekly-report: Build the weekly sales report.")
    expect(viewed!.output).toContain("1. Read sales.csv")
    expect(viewed!.output).toContain("name: weekly-report")
  })

  it("edits skills in place and puts their files on the computer when loaded", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    const act = async (args: Record<string, string>) => {
      world.faux.setResponses(useTool("skill", args))
      return lastTool(await say(world, chat.id, "go"))!
    }
    await act({
      action: "create",
      name: "greeter",
      description: "Greet people",
      content: "Say hello.",
    })
    await act({
      action: "write_file",
      name: "greeter",
      path: "scripts/hi.sh",
      content: "echo hi from the skill\n",
    })
    expect(
      (
        await act({
          action: "patch",
          name: "greeter",
          old_text: "Say hello.",
          new_text: "Say hello warmly.",
        })
      ).status,
    ).toBe("done")
    expect(
      (await act({ action: "patch", name: "greeter", old_text: "not there", new_text: "x" }))
        .output,
    ).toBe("old_text was not found in the file.")
    expect(
      (await act({ action: "create", name: "greeter", description: "x", content: "y" })).status,
    ).toBe("error")
    expect(
      (await act({ action: "write_file", name: "greeter", path: "../out.sh", content: "x" }))
        .output,
    ).toContain("not a valid file path")

    const viewed = await act({ action: "view", name: "greeter" })
    expect(viewed.output).toContain("Say hello warmly.")
    expect(viewed.output).toContain("Other files in this skill: scripts/hi.sh.")
    expect(viewed.output).toContain("/workspace/.agents/skills/greeter")
    world.faux.setResponses(useTool("bash", { command: "sh .agents/skills/greeter/scripts/hi.sh" }))
    expect(lastTool(await say(world, chat.id, "run it"))!.output).toContain("hi from the skill")

    const detail = await call<SkillDetail>(world, "/skills/greeter")
    expect(Object.keys(detail.contents).sort()).toEqual(["SKILL.md", "scripts/hi.sh"])
  })

  it("leaves a disabled skill out of the prompt, and a removed bundled skill removed", async () => {
    const directory = temporary()
    const world = open(directory)
    const chat = await setup(world)
    await call(world, "/skills/writing-skills", "PATCH", { enabled: false })
    await call(world, "/skills/planning-automations", "DELETE")
    let prompt = ""
    world.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage("ok")
      },
    ])
    await say(world, chat.id, "hi")
    expect(prompt).toContain("(No skills yet.)")
    await world.namespace.close()

    const reopened = open(directory)
    expect((await skills(reopened)).map((skill) => [skill.name, skill.enabled])).toEqual([
      ["writing-skills", false],
    ])
  })

  it("installs a skill from a URL, and says why when it cannot", async () => {
    const world = open(temporary())
    await setup(world)
    const installed = await call<SkillSummary>(world, "/skills/install", "POST", {
      url: "https://example.com/tea/SKILL.md",
    })
    expect(installed).toMatchObject({
      name: "making-tea",
      source: "installed",
      origin: "https://example.com/tea/SKILL.md",
      description: "Brew tea properly",
    })
    await expect(
      call(world, "/skills/install", "POST", { url: "https://example.com/missing/SKILL.md" }),
    ).rejects.toThrow("400: Could not fetch")
    await expect(call(world, "/skills/nope")).rejects.toThrow('400: There is no skill "nope".')
    expect(world.errors).toEqual([])
  })
})
