import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatState, ChatSummary, LibraryFile, ToolPart } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { justBashSandbox } from "@do-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterAll, describe, expect, it } from "vitest"
import { cleanFileName, contentTypeFor } from "../src/library.ts"
import { createAgentActor } from "../src/index.ts"

const directory = mkdtempSync(join(tmpdir(), "dc-library-"))
const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
const models = createModels()
models.setProvider(faux.provider)
const open = () =>
  new NodeActorNamespace({
    directory: join(directory, "agents"),
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
let agents = open()
afterAll(() => agents.close())

const request = (path: string, init?: RequestInit) =>
  agents.get("agent-1").fetch(new Request(`http://actor${path}`, init))

async function call<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await request(path, {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
  })
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

async function say(chatId: string, text: string): Promise<ChatState> {
  const before = (await call<ChatState>(`/chats/${chatId}`)).messages.length
  await call(`/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  const deadline = Date.now() + 8_000
  for (;;) {
    const state = await call<ChatState>(`/chats/${chatId}`)
    if (!state.busy && state.messages.length > before + 1) return state
    if (Date.now() > deadline) throw new Error("run did not finish")
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

const lastTool = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).findLast((part): part is ToolPart => part.type === "tool")!
const files = async () => (await call<{ files: LibraryFile[] }>("/library")).files

describe("file names and types", () => {
  it("strips paths and characters that do not belong in a file name", () => {
    expect(cleanFileName("/workspace/reports/Q3 report.pdf")).toBe("Q3 report.pdf")
    expect(cleanFileName("..\\..\\evil\r\n.txt")).toBe("evil.txt")
    expect(cleanFileName('say "hi".md')).toBe("say hi.md")
    expect(cleanFileName("..")).toBe("file")
  })

  it("knows common types and falls back to plain bytes", () => {
    expect(contentTypeFor("chart.PNG")).toBe("image/png")
    expect(contentTypeFor("notes.md")).toBe("text/markdown")
    expect(contentTypeFor("mystery.bin")).toBe("application/octet-stream")
  })
})

describe("library", () => {
  let chat: ChatSummary

  it("keeps a file the agent sends, and shows it in the chat", async () => {
    await call("/init", "POST", { ownerId: "user-1" })
    chat = await call<ChatSummary>("/chats", "POST", {})
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("bash", {
            command: "mkdir -p out && printf 'name,total\\nwidgets,42\\n' > out/report.csv",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxToolCall("send_file", { path: "out/report.csv" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Here is the report."),
    ])
    const sent = lastTool(await say(chat.id, "make me a report"))
    expect(sent).toMatchObject({ name: "send_file", status: "done" })
    expect(sent.details).toMatchObject({
      name: "report.csv",
      size: 22,
      contentType: "text/csv",
      source: "agent",
    })

    const [file] = await files()
    expect(file).toMatchObject({ name: "report.csv", chatId: chat.id, source: "agent" })
    const response = await request(`/library/${file!.id}`)
    expect(await response.text()).toBe("name,total\nwidgets,42\n")
  })

  it("serves files as downloads that a browser will not run", async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("write", { path: "page.html", content: "<script>alert(1)</script>" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("send_file", { path: "page.html", name: "My page.html" })],
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage("Sent."),
    ])
    await say(chat.id, "send me a page")
    const page = (await files()).find((file) => file.name === "My page.html")!
    const response = await request(`/library/${page.id}`)
    expect(response.headers.get("content-type")).toBe("application/octet-stream")
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''My%20page.html",
    )
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-security-policy")).toContain("sandbox")
  })

  it("accepts a file from the user, byte for byte, and survives a restart", async () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => (index * 13) % 256)
    const uploaded = await request(
      `/library?name=${encodeURIComponent("photo.png")}&chat=${chat.id}`,
      {
        method: "POST",
        body: bytes,
        headers: { "content-type": "image/png" },
      },
    )
    expect(uploaded.status).toBe(201)
    const file = (await uploaded.json()) as LibraryFile
    expect(file).toMatchObject({
      name: "photo.png",
      size: 70_000,
      source: "user",
      contentType: "image/png",
    })

    await agents.close()
    agents = open()
    const response = await request(`/library/${file.id}`)
    // Images are shown in place; everything else is a download.
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(response.headers.get("content-disposition")).toContain("inline")
    const back = new Uint8Array(await response.arrayBuffer())
    expect(back.length).toBe(bytes.length)
    expect(back.every((byte, index) => byte === bytes[index])).toBe(true)
  })

  it("lets the agent find an uploaded file and bring it onto its computer", async () => {
    const report = "quarter,revenue\nQ1,120\nQ2,135\n"
    await request("/library?name=revenue.csv", { method: "POST", body: report })

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("library", { action: "list" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("listed"),
    ])
    const listed = lastTool(await say(chat.id, "what did I upload?"))
    expect(listed.output).toContain("revenue.csv (30 bytes, uploaded by the user,")
    expect(listed.output).toContain("photo.png (70000 bytes, uploaded by the user,")

    // By name, in whatever case the user said it, to the default place.
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("library", { action: "get", file: "Revenue.CSV" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "cat uploads/revenue.csv" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("read"),
    ])
    const state = await say(chat.id, "read the revenue file I uploaded")
    const tools = state.messages.flatMap((m) => m.parts).filter((p) => p.type === "tool")
    expect(tools.at(-2)).toMatchObject({ name: "library", status: "done" })
    expect((tools.at(-2) as ToolPart).output).toMatch(
      /^Copied revenue\.csv \(30 bytes\) to .*\/uploads\/revenue\.csv\.$/,
    )
    expect((tools.at(-1) as ToolPart).output).toBe(report)

    // Binary files arrive whole, at a path the agent chose.
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("library", { action: "get", file: "photo.png", path: "pictures/p.png" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxToolCall("bash", { command: "wc -c < pictures/p.png" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("counted"),
    ])
    expect(lastTool(await say(chat.id, "and the photo")).output?.trim()).toBe("70000")

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("library", { action: "get", file: "missing.pdf" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("no"),
    ])
    expect(lastTool(await say(chat.id, "the pdf"))).toMatchObject({
      status: "error",
      output: 'There is no "missing.pdf" in the library. Use the list action to see it.',
    })
  })

  it("explains what it cannot send", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("send_file", { path: "nope.txt" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxToolCall("send_file", { path: "out" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Neither worked."),
    ])
    const state = await say(chat.id, "send things that are not files")
    const outputs = state.messages
      .flatMap((m) => m.parts)
      .filter((part): part is ToolPart => part.type === "tool" && part.status === "error")
      .map((part) => part.output)
    expect(outputs.at(-2)).toContain("Could not find nope.txt")
    expect(outputs.at(-1)).toBe("out is not a file.")
  })

  it("deletes a file and its bytes", async () => {
    const before = await files()
    await call(`/library/${before[0]!.id}`, "DELETE")
    expect((await files()).length).toBe(before.length - 1)
    expect((await request(`/library/${before[0]!.id}`)).status).toBe(404)
    await expect(call(`/library/${before[0]!.id}`, "DELETE")).rejects.toThrow("404")
  })
})
