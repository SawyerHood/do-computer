import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatState, ChatSummary, ToolPart } from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import { justBashSandbox } from "@durable-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterAll, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"
import { isInherited, own } from "../src/own.ts"

/**
 * Ids and names come from URLs and from the model, and are looked up in plain objects. A name
 * every object inherits must never be found there: writing through it changes every object in the
 * process, which on Node is shared by all users.
 */
const NAMES = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]

const directory = mkdtempSync(join(tmpdir(), "dc-inherited-"))
const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 50_000 })
const models = createModels()
models.setProvider(faux.provider)
const agents = new NodeActorNamespace({
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
      sandbox: (host) => justBashSandbox({ id: host.name, database: host.sql }),
    }),
})
agents.start()
afterAll(() => agents.close())

const request = (path: string, method = "GET", payload?: unknown) =>
  agents.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )

/** Everything a clean object answers to. If anything was written through a lookup, this changes. */
const inherited = () =>
  JSON.stringify(
    Object.getOwnPropertyNames(Object.prototype)
      .sort()
      .map((name) => [name, typeof (Object.prototype as Record<string, unknown>)[name]]),
  )
const clean = inherited()
const untouched = () => {
  expect(inherited()).toBe(clean)
  expect(Object.keys({})).toEqual([])
  expect(({} as Record<string, unknown>).title).toBe(undefined)
  expect(({} as Record<string, unknown>).enabled).toBe(undefined)
}

describe("own", () => {
  it("finds entries and nothing an object merely inherits", () => {
    const record: Record<string, number> = { a: 1 }
    expect(own(record, "a")).toBe(1)
    expect(own(record, "b")).toBe(undefined)
    for (const name of NAMES) {
      expect(own(record, name)).toBe(undefined)
      expect(isInherited(name)).toBe(true)
    }
    expect(own(undefined, "a")).toBe(undefined)
    expect(isInherited("a1b2c3d4")).toBe(false)
  })
})

describe("names every object inherits", () => {
  it("are never an id or a name in a URL, whatever the route", async () => {
    await request("/init", "POST", { ownerId: "user-1" })
    const change = {
      title: "polluted",
      enabled: false,
      prompt: "x",
      archived: true,
      decision: "always",
    }
    for (const name of NAMES) {
      const attempts: [string, string, unknown?][] = [
        [`/schedules/${name}`, "PATCH", change],
        [`/schedules/${name}`, "DELETE"],
        [`/schedules/${name}/run`, "POST", {}],
        [`/skills/${name}`, "GET"],
        [`/skills/${name}`, "PATCH", change],
        [`/skills/${name}`, "DELETE"],
        [`/library/${name}`, "GET"],
        [`/library/${name}`, "DELETE"],
        [`/connectors/${name}`, "PATCH", change],
        [`/connectors/${name}`, "DELETE"],
        [`/connectors/${name}/authorize`, "POST", { code: "x" }],
        [`/approvals/${name}`, "POST", change],
        [`/chats/${name}`, "GET"],
        [`/chats/${name}`, "PATCH", change],
        [`/chats/${name}/history`, "GET"],
        [
          `/computers/${name}`,
          "PUT",
          { name: "x", platform: "linux", hostname: "h", home: "/", readOnly: false, pairedAt: 1 },
        ],
        [`/computers/${name}`, "DELETE"],
      ]
      for (const [path, method, payload] of attempts) {
        const response = await request(path, method, payload)
        expect(`${method} ${path} -> ${response.status}`).toBe(`${method} ${path} -> 404`)
        untouched()
      }
    }
  })

  it("are never an id or a name the model can use in a tool", async () => {
    const chat = (await (await request("/chats", "POST", {})).json()) as ChatSummary
    const attempt = async (tool: string, args: Record<string, string | boolean>) => {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }),
        fauxAssistantMessage("done"),
      ])
      await request(`/chats/${chat.id}/messages`, "POST", {
        text: "go",
        requestId: crypto.randomUUID(),
      })
      for (let attempt = 0; attempt < 400; attempt++) {
        const state = (await (await request(`/chats/${chat.id}`)).json()) as ChatState
        const last = state.messages.at(-1)
        if (
          !state.busy &&
          last?.role === "assistant" &&
          last.parts.some((p) => p.type === "text")
        ) {
          return state.messages
            .flatMap((m) => m.parts)
            .findLast((p) => p.type === "tool") as ToolPart
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error("The run did not finish")
    }
    for (const name of NAMES) {
      for (const [tool, args] of [
        ["schedule", { action: "update", id: name, title: "polluted" }],
        ["schedule", { action: "pause", id: name }],
        ["schedule", { action: "remove", id: name }],
        ["skill", { action: "view", name }],
        ["skill", { action: "view", name: "writing-skills", path: name }],
        [
          "skill",
          { action: "patch", name: "writing-skills", path: name, old_text: "a", new_text: "b" },
        ],
        ["skill", { action: "write_file", name: "writing-skills", path: name, content: "x" }],
        ["skill", { action: "delete", name }],
        ["library", { action: "get", file: name }],
        ["history", { action: "read", chat: name }],
      ] as [string, Record<string, string>][]) {
        const result = await attempt(tool, args)
        expect(`${tool} ${JSON.stringify(args)} -> ${result.status}`).toBe(
          `${tool} ${JSON.stringify(args)} -> error`,
        )
        untouched()
      }
    }
  }, 60_000)
})
