import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatSummary } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAgentActor } from "../src/index.ts"

type Body = {
  system?: { text: string }[]
  tools?: { name: string }[]
  messages?: { role: string; content: unknown }[]
}

const MODEL = "anthropic/claude-opus-5-5"

/** Anthropic's stream of an answer that calls one tool. */
function callingTool(name: string, input: object): Response {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_1", name, input: {} },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ]
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  )
}

const turnedDown = () =>
  Response.json(
    { type: "error", error: { type: "invalid_request_error", message: "Turned down." } },
    { status: 400 },
  )

const namespaces: NodeActorNamespace[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const namespace of namespaces.splice(0)) await namespace.close().catch(() => {})
})

/** An agent whose model is Claude, through a stand-in for Anthropic that `answer` plays. */
function agent(answer: (body: Body, count: number) => Response) {
  const bodies: Body[] = []
  const real = globalThis.fetch
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith("https://api.anthropic.com/")) return real(input, init)
    const body = JSON.parse(String(init?.body)) as Body
    bodies.push(body)
    return answer(body, bodies.length)
  }) as typeof fetch)
  const models = createModels({
    authContext: {
      env: async (name) => (name === "ANTHROPIC_API_KEY" ? "sk-ant-api-test" : undefined),
      fileExists: async () => false,
    },
  })
  models.setProvider(anthropicProvider())
  const directory = mkdtempSync(join(tmpdir(), "dc-size-"))
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: MODEL,
        modelOptions: [{ id: MODEL, name: "Claude", reasoning: true, inputCost: 0, outputCost: 0 }],
        keepAliveMs: 60_000,
        // As a deployment has them: shared pages, and searching the web.
        sites: {
          list: async () => [],
          publish: async () => {
            throw new Error("not used")
          },
          setPublic: async () => {
            throw new Error("not used")
          },
          remove: async () => false,
        },
        webSearch: { apiKey: "sk-or-test", model: "test/search" },
      }),
  })
  namespace.start()
  namespaces.push(namespace)
  const request = async <T>(path: string, method = "GET", payload?: unknown): Promise<T> => {
    const response = await namespace.get("agent-1").fetch(
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
  return { bodies, request }
}

/** Send the main chat of a fresh agent `text`, and wait for `count` requests to the model. */
async function firstRequests(
  world: ReturnType<typeof agent>,
  text: string,
  count: number,
): Promise<Body[]> {
  await world.request("/init", "POST", { ownerId: "user-1" })
  const main = await world.request<ChatSummary>("/chats/main", "POST")
  await world.request(`/chats/${main.id}/messages`, "POST", {
    text,
    requestId: crypto.randomUUID(),
  })
  const deadline = Date.now() + 15_000
  while (world.bodies.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  expect(world.bodies.length).toBeGreaterThanOrEqual(count)
  return world.bodies
}

const sizes = (body: Body) => ({
  system: (body.system ?? []).map((block) => block.text).join("\n").length,
  tools: JSON.stringify(body.tools ?? []).length,
  total: JSON.stringify(body).length,
})

/**
 * What the first request of a fresh agent's main chat to Anthropic weighs, read from the request
 * it makes (turned down here, so nothing is asked of Anthropic). Each request after it carries
 * the same prefix, so a few hundred characters here are paid in every request of every chat.
 *
 * Measured on 2026-10-23, in characters of the JSON sent, for an agent with shared sites and web
 * search and no computer: before tools were deferred and what is said twice was said once,
 * system 18,817, tools 33,987, the whole body 53,525; after, system 14,601, tools 16,877, the
 * whole body 32,195. The budget leaves a little room above that: a change that goes past it
 * should be one that was meant to.
 */
const BUDGET = { system: 16_000, tools: 18_500, total: 34_500 }

/** The agent's own tools that are described only once loaded. */
const DEFERRED = [
  "connectors",
  "pin",
  "request_secret",
  "schedule",
  "screen",
  "settings",
  "share",
  "skill",
  "visual",
]

describe("the first request of a main chat", () => {
  it("stays within its budget, and leaves out the tools that are loaded on demand", async () => {
    const world = agent(() => turnedDown())
    const [body] = await firstRequests(world, "hello", 1)
    const size = sizes(body!)
    expect(size.system).toBeLessThanOrEqual(BUDGET.system)
    expect(size.tools).toBeLessThanOrEqual(BUDGET.tools)
    expect(size.total).toBeLessThanOrEqual(BUDGET.total)
    const names = (body!.tools ?? []).map((tool) => tool.name)
    for (const name of ["load_tools", "bash", "send", "subagent", "browser", "memory"]) {
      expect(names).toContain(name)
    }
    for (const name of DEFERRED) expect(names).not.toContain(name)
    // Each is named in the prompt in a line, and the rules for pages wait for a page's tool.
    const system = (body!.system ?? []).map((block) => block.text).join("\n")
    expect(system).toContain("first call `load_tools` with its name")
    for (const name of DEFERRED) expect(system).toContain(`\n- ${name}: `)
    expect(system).not.toContain("design tokens")
    expect(system).not.toContain("<pins>")
  })

  it("sends a tool loaded mid-chat as an addition, leaving the cached list of tools as it was", async () => {
    const world = agent((_, count) =>
      count === 1 ? callingTool("load_tools", { names: ["visual"] }) : turnedDown(),
    )
    const [first, second] = (await firstRequests(world, "draw me something", 2)) as [Body, Body]
    // The list at the top, which the cache holds, is the same; the tool comes after it, and the
    // rules every page is held to with it.
    expect(second.tools).toEqual(first.tools)
    expect(second.system).toEqual(first.system)
    const later = JSON.stringify(second.messages)
    expect(later).toContain('"type":"tool_addition"')
    expect(later).toContain('"name":"visual"')
    expect(later).toContain("design tokens")
  })
})
