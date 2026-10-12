import { expect, test, vi } from "vitest"
import { keepingType } from "../src/lib/device-fetch.ts"

test("a blob with no type of its own is sent as bytes, under the type the request names", async () => {
  const inner = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}"))
  const send = keepingType(inner as unknown as typeof fetch)
  const headers = new Headers({ "content-type": "audio/mp4" })

  await send("https://example.test/api/transcribe", {
    method: "POST",
    headers,
    body: new Blob([new Uint8Array([1, 2, 3])]),
  })

  const init = inner.mock.calls[0]![1]!
  expect(init.body).toBeInstanceOf(ArrayBuffer)
  expect([...new Uint8Array(init.body as ArrayBuffer)]).toEqual([1, 2, 3])
  expect(init.headers).toBe(headers)
  expect(init.method).toBe("POST")
})

test("anything that is not a blob goes through as it came", async () => {
  const inner = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}"))
  const send = keepingType(inner as unknown as typeof fetch)
  const init = { method: "POST", body: JSON.stringify({ a: 1 }) }

  await send("https://example.test/api", init)
  await send("https://example.test/api")

  expect(inner.mock.calls[0]![1]).toBe(init)
  expect(inner.mock.calls[1]![1]).toBeUndefined()
})
