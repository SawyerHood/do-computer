import { env } from "cloudflare:test"
import type { SavedLogin, SavedLoginsState } from "@do-computer/protocol"
import { durableObjectNamespace } from "@do-computer/runtime/cloudflare"
import { describe, expect, it } from "vitest"
import { CALLER_HEADER, encodeCaller, Sealer, vault } from "../../src/index.ts"
import type { Env } from "./worker.ts"

const namespace = durableObjectNamespace((env as unknown as Env).MODEL_ACCESS)
const PASSWORD = "kept in a Durable Object"

async function call(workspace: string, path: string, method = "GET", payload?: unknown) {
  const response = await namespace.get(workspace).fetch(
    new Request(`http://models/passwords${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        [CALLER_HEADER]: encodeCaller({ id: "user-1", name: "Ada" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  )
  return { status: response.status, text: await response.text() }
}

/**
 * The same store as on Node, in the runtime the hosted app runs in: what it seals with is the
 * runtime's own cryptography, which is not the one Node has.
 */
describe("a workspace's saved logins in a Durable Object", () => {
  it("seals and opens", async () => {
    const sealer = await Sealer.for("secret", "ws")
    const sealed = await sealer.seal("l1", PASSWORD)
    expect(sealed).not.toContain(PASSWORD)
    expect(await sealer.open("l1", sealed)).toBe(PASSWORD)
    expect(await sealer.open("l2", sealed)).toBeUndefined()
    expect(await (await Sealer.for("other", "ws")).open("l1", sealed)).toBeUndefined()
  })

  it("keeps a login, shows it without its password, and hands the password to an agent", async () => {
    const made = await call("ws-vault", "", "POST", {
      name: "GitHub",
      username: "ada@example.com",
      password: PASSWORD,
      sites: ["github.com"],
    })
    expect(made.status).toBe(201)
    expect(made.text).not.toContain(PASSWORD)
    const { login } = JSON.parse(made.text) as { login: SavedLogin }
    const listed = await call("ws-vault", "")
    expect((JSON.parse(listed.text) as SavedLoginsState).logins.map((entry) => entry.name)).toEqual(
      ["GitHub"],
    )
    expect(listed.text).not.toContain(PASSWORD)

    const actor = namespace.get("ws-vault")
    expect(await vault.use(actor, login.id, "Pip")).toEqual({
      name: "GitHub",
      username: "ada@example.com",
      password: PASSWORD,
      sites: ["github.com"],
    })
    expect((await vault.list(actor))[0]?.usedBy).toBe("Pip")
    // Another workspace has nothing of it.
    expect(await vault.list(namespace.get("ws-other"))).toEqual([])
  })
})
