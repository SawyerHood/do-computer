import { describe, expect, it } from "vitest"
import { answerClientOrigin } from "./client-origins.ts"

const ORIGINS = ["http://127.0.0.1:8766"]
const ok = () => new Response("yes", { headers: { "set-auth-token": "t" } })

describe("answerClientOrigin", () => {
  it("leaves a request from the app itself as it was", async () => {
    const response = await answerClientOrigin(new Request("http://dc.test/api/me"), ORIGINS, ok)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  it("leaves a request from an origin nobody named as it was", async () => {
    const request = new Request("http://dc.test/api/me", {
      headers: { origin: "http://evil.test" },
    })
    const response = await answerClientOrigin(request, ORIGINS, ok)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  it("lets a named origin read the reply and the session it was handed, with no cookies", async () => {
    const request = new Request("http://dc.test/api/me", { headers: { origin: ORIGINS[0]! } })
    const response = await answerClientOrigin(request, ORIGINS, ok)
    expect(await response.text()).toBe("yes")
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGINS[0])
    expect(response.headers.get("access-control-expose-headers")).toBe("set-auth-token")
    expect(response.headers.get("access-control-allow-credentials")).toBeNull()
    expect(response.headers.get("vary")).toBe("origin")
  })

  it("answers a browser's asking first without calling the app", async () => {
    const request = new Request("http://dc.test/api/agents", {
      method: "OPTIONS",
      headers: { origin: ORIGINS[0]!, "access-control-request-method": "POST" },
    })
    let called = false
    const response = await answerClientOrigin(request, ORIGINS, () => {
      called = true
      return ok()
    })
    expect(called).toBe(false)
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization")
  })
})
