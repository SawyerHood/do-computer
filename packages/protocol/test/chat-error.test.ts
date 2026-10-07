import { describe, expect, it } from "vitest"
import { type ChatMessage, describeChatError, foldFailures } from "../src/index.ts"

const OVERLOADED = `503: {"message":"Provider returned error","code":503,"metadata":{"raw":"{\\"error\\":{\\"code\\":\\"service_overloaded\\",\\"message\\":\\"The backend is temporarily overloaded. Please retry.\\",\\"param\\":null,\\"type\\":\\"server_error\\"}}","provider_name":"Meta","is_byok":false,"provider_error_code":"service_overloaded","retry_after_seconds":60,"retry_after_seconds_raw":60,"headers":{"Retry-After":"60"}}} {"error":{"code":"service_overloaded","message":"The backend is temporarily overloaded. Please retry.","param":null,"type":"server_error"}}`
const INTERNAL = `502: {"message":"Provider returned error","code":502,"metadata":{"raw":"{\\"error\\":{\\"code\\":null,\\"message\\":\\"internal server error\\",\\"param\\":null,\\"type\\":\\"server_error\\"}}","provider_name":"Meta","is_byok":false}} {"error":{"code":null,"message":"internal server error","param":null,"type":"server_error"}}`
const NOT_SERVED = `404: {"message":"Provider returned error","code":404,"metadata":{"raw":"{\\"error\\":{\\"code\\":404,\\"message\\":\\"Publisher model was not found\\",\\"status\\":\\"NOT_FOUND\\"}}","provider_name":"Google","is_byok":false}}`

describe("describeChatError", () => {
  it("says an overloaded provider plainly, and keeps what it answered for a closer look", () => {
    const view = describeChatError(OVERLOADED)
    expect(view).toMatchObject({
      kind: "overloaded",
      title: "The model is overloaded right now.",
      retryable: true,
      facts: ["503", "Meta", "service_overloaded", "retry after 60s"],
    })
    // The answer carried as a string is opened up, and its repeat after the wrapper is dropped.
    expect(view.detail).toContain('"raw": {\n      "error": {')
    expect(view.detail?.match(/temporarily overloaded/g)).toHaveLength(1)
  })

  it("calls a failure on the provider's side a problem of the provider's", () => {
    expect(describeChatError(INTERNAL)).toMatchObject({
      kind: "provider",
      facts: ["502", "Meta"],
      retryable: true,
    })
  })

  it("does not call a model gone when one provider of it says so", () => {
    expect(describeChatError(NOT_SERVED)).toMatchObject({
      kind: "provider",
      facts: ["404", "Google"],
      retryable: true,
    })
  })

  it.each([
    ["429: Too Many Requests", "rateLimit"],
    [
      '429: {"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}',
      "credit",
    ],
    ['402: {"error":{"message":"Insufficient credits"}}', "credit"],
    ['401: {"error":{"message":"No auth credentials found","code":401}}', "key"],
    ['404: {"error":{"message":"No endpoints found for acme/gone","code":404}}', "modelGone"],
    [
      '400: {"error":{"message":"This endpoint\'s maximum context length is 128000 tokens."}}',
      "tooLong",
    ],
    ["fetch failed", "network"],
    ["Request timed out.", "timeout"],
    ["504: Gateway Timeout", "timeout"],
    ["529: overloaded_error", "overloaded"],
  ])("reads %s as %s", (error, kind) => {
    expect(describeChatError(error).kind).toBe(kind)
  })

  it("passes on the provider's own words for a failure it does not know", () => {
    const view = describeChatError(
      '{"error":{"message":"the tensor shape was not what the sampler expected","type":"weird"}}',
    )
    expect(view).toMatchObject({
      kind: "unknown",
      title: "Something went wrong generating this reply.",
      hint: "The tensor shape was not what the sampler expected.",
      retryable: true,
    })
    expect(view.detail).toContain('"type": "weird"')
  })

  it("passes on a short plain message as it is, once", () => {
    expect(describeChatError("the stream ended early")).toEqual({
      kind: "unknown",
      title: "Something went wrong generating this reply.",
      hint: "The stream ended early.",
      retryable: true,
      facts: [],
    })
  })

  it("keeps a long or unreadable message out of the sentence and under the detail", () => {
    const noise = "x".repeat(400)
    const view = describeChatError(noise)
    expect(view.hint).toBeUndefined()
    expect(view.detail).toBe(noise)
  })

  it("has something to say when nothing was reported", () => {
    expect(describeChatError(undefined)).toEqual({
      kind: "unknown",
      title: "Something went wrong generating this reply.",
      retryable: true,
      facts: [],
    })
  })
})

describe("foldFailures", () => {
  const user = (id: string): ChatMessage => ({
    id,
    role: "user",
    parts: [{ type: "text", text: "hi" }],
    status: "done",
  })
  const failed = (id: string, text?: string): ChatMessage => ({
    id,
    role: "assistant",
    parts: text === undefined ? [] : [{ type: "text", text }],
    status: "error",
    error: id,
  })

  it("says failures in a row once, as the last of them", () => {
    const folded = foldFailures([user("u1"), failed("a"), failed("b"), failed("c"), user("u2")])
    expect(folded.map(({ message, failures }) => [message.id, failures])).toEqual([
      ["u1", 0],
      ["c", 3],
      ["u2", 0],
    ])
  })

  it("leaves alone a reply that said something before it failed", () => {
    const folded = foldFailures([failed("a"), failed("b", "Here is the first half"), failed("c")])
    expect(folded.map(({ message, failures }) => [message.id, failures])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ])
  })

  const said = (id: string): ChatMessage => ({
    id,
    role: "assistant",
    parts: [{ type: "text", text: "On it" }],
    status: "done",
  })

  it("leaves out a failure that was tried again and got its reply", () => {
    const folded = foldFailures([user("u1"), failed("a"), failed("b"), said("c"), failed("d")])
    expect(folded.map(({ message, failures }) => [message.id, failures])).toEqual([
      ["u1", 0],
      ["c", 0],
      ["d", 1],
    ])
  })

  it("leaves out a failure that is being tried again", () => {
    const messages = [user("u1"), said("a"), failed("b")]
    expect(foldFailures(messages, true).map(({ message }) => message.id)).toEqual(["u1", "a"])
    expect(foldFailures(messages, false).map(({ message }) => message.id)).toEqual(["u1", "a", "b"])
  })
})
