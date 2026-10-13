import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SavedLogin, SavedLoginsState, SignInWith } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { afterEach, describe, expect, it } from "vitest"
import {
  CALLER_HEADER,
  createModelAccessActor,
  encodeCaller,
  Sealer,
  vault,
  VaultError,
} from "../src/index.ts"

const PASSWORD = "correct horse battery staple 9!"

type World = { workspaces: NodeActorNamespace; directory: string }
const worlds: World[] = []

function open(
  key: string | undefined = "a secret of the deployment's",
  directory = mkdtempSync(join(tmpdir(), "dc-vault-")),
): World {
  const workspaces = new NodeActorNamespace({
    directory: join(directory, "models"),
    blobs: () => fileBlobs(join(directory, "blobs")),
    factory: (host) => createModelAccessActor(host, { providers: () => [], vaultKey: key }),
    onError: (error) => {
      throw error
    },
  })
  const world = { workspaces, directory }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.workspaces.close().catch(() => {})
})

const sawyer = { id: "u1", name: "Sawyer" }

function call(world: World, workspace: string, path: string, init?: RequestInit) {
  return world.workspaces.get(workspace).fetch(
    new Request(`http://models/passwords${path}`, {
      ...init,
      headers: { "content-type": "application/json", [CALLER_HEADER]: encodeCaller(sawyer) },
    }),
  )
}

async function save(world: World, workspace: string, more: Record<string, unknown> = {}) {
  const response = await call(world, workspace, "", {
    method: "POST",
    body: JSON.stringify({
      name: "GitHub",
      username: "sawyer@example.com",
      password: PASSWORD,
      sites: ["github.com"],
      ...more,
    }),
  })
  return { response, body: (await response.json()) as { login: SavedLogin; error?: string } }
}

/** Every file under a folder, read whole. */
function everything(folder: string): Buffer[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    return statSync(path).isDirectory() ? everything(path) : [readFileSync(path)]
  })
}

describe("a workspace's saved logins", () => {
  it("keeps a login and shows everything of it but the password", async () => {
    const world = open()
    const { response, body } = await save(world, "team1")
    expect(response.status).toBe(201)
    expect(body.login).toMatchObject({
      name: "GitHub",
      username: "sawyer@example.com",
      sites: ["github.com"],
      addedBy: sawyer,
      usedAt: null,
    })
    const listed = (await (await call(world, "team1", "")).json()) as SavedLoginsState
    expect(listed.logins).toHaveLength(1)
    expect(JSON.stringify({ body, listed })).not.toContain(PASSWORD)
  })

  it("writes nothing of the password to disk as it was typed", async () => {
    const world = open()
    await save(world, "team1")
    await world.workspaces.close()
    const files = everything(world.directory)
    expect(files.length).toBeGreaterThan(0)
    // The whole of it, and any long piece of it, in the bytes of every file there is.
    for (const bytes of files) {
      expect(bytes.includes(PASSWORD)).toBe(false)
      expect(bytes.includes("horse battery")).toBe(false)
    }
    // What is there is the username, which is not secret.
    expect(files.some((bytes) => bytes.includes("sawyer@example.com"))).toBe(true)
  })

  it("hands the password to an agent that is about to use it, and writes that down", async () => {
    const world = open()
    const { body } = await save(world, "team1")
    const actor = world.workspaces.get("team1")
    const login: SignInWith = await vault.use(actor, body.login.id, "Juniper")
    expect(login).toEqual({
      name: "GitHub",
      username: "sawyer@example.com",
      password: PASSWORD,
      sites: ["github.com"],
    })
    const [after] = await vault.list(actor)
    expect(after?.usedBy).toBe("Juniper")
    expect(after?.usedAt).toBeTypeOf("number")
  })

  it("keeps what one workspace saved out of another's reach", async () => {
    const world = open()
    const { body } = await save(world, "team1")
    expect(await vault.list(world.workspaces.get("team2"))).toEqual([])
    await expect(vault.use(world.workspaces.get("team2"), body.login.id, "Moss")).rejects.toThrow(
      "no such saved login",
    )
  })

  it("takes a site as a name, an address or a name in capitals, and refuses what is not one", async () => {
    const world = open()
    const { body } = await save(world, "team1", {
      sites: ["https://GitHub.com/login", "github.com", "gist.github.com"],
    })
    expect(body.login.sites).toEqual(["github.com", "gist.github.com"])
    for (const sites of [[], ["com"], ["not a site"], ["10.0.0.1"], ["javascript:alert(1)"]]) {
      const refused = await save(world, "team1", { sites })
      expect(refused.response.status).toBe(400)
    }
  })

  it("refuses a password of more than one line, an empty one, and a login with no username", async () => {
    const world = open()
    for (const more of [{ password: "two\nlines" }, { password: "" }, { username: " " }]) {
      const refused = await save(world, "team1", more)
      expect(refused.response.status).toBe(400)
      expect(refused.body.error).not.toContain(PASSWORD)
    }
  })

  it("keeps a password exactly as typed, spaces at its ends included", async () => {
    const world = open()
    const { body } = await save(world, "team1", { password: "  spaced out  " })
    const login = await vault.use(world.workspaces.get("team1"), body.login.id, "Juniper")
    expect(login.password).toBe("  spaced out  ")
  })

  it("gives a second login of the same name a number", async () => {
    const world = open()
    await save(world, "team1")
    const second = await save(world, "team1", { username: "work@example.com" })
    expect(second.body.login.name).toBe("GitHub (2)")
  })

  it("replaces a password, changes the rest, and removes a login", async () => {
    const world = open()
    const { body } = await save(world, "team1")
    const actor = world.workspaces.get("team1")
    const changed = await call(world, "team1", `/${body.login.id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: "a new one", sites: ["github.com", "example.org"] }),
    })
    expect(changed.status).toBe(200)
    expect(await changed.text()).not.toContain("a new one")
    const login = await vault.use(actor, body.login.id, "Juniper")
    expect(login.password).toBe("a new one")
    expect(login.sites).toEqual(["github.com", "example.org"])
    expect((await call(world, "team1", `/${body.login.id}`, { method: "DELETE" })).status).toBe(200)
    expect(await vault.list(actor)).toEqual([])
    expect((await call(world, "team1", `/${body.login.id}`, { method: "DELETE" })).status).toBe(404)
  })

  it("says a login cannot be read once the deployment's key has changed, and takes a new password for it", async () => {
    const first = open("the first key")
    const { body } = await save(first, "team1")
    await first.workspaces.close()
    const second = open("another key", first.directory)
    const actor = second.workspaces.get("team1")
    const [listed] = await vault.list(actor)
    expect(listed?.unreadable).toBe(true)
    const failure = await vault.use(actor, body.login.id, "Juniper").catch((error) => error)
    expect(failure).toBeInstanceOf(VaultError)
    expect((failure as VaultError).code).toBe("unreadable")
    await call(second, "team1", `/${body.login.id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: "given again" }),
    })
    expect((await vault.use(actor, body.login.id, "Juniper")).password).toBe("given again")
    expect((await vault.list(actor))[0]?.unreadable).toBeUndefined()
  })

  it("saves nothing where the deployment has no key", async () => {
    const world = open("")
    const { response, body } = await save(world, "team1")
    expect(response.status).toBe(503)
    expect(body.error).toContain("DC_SECRETS_KEY")
    expect(await vault.list(world.workspaces.get("team1"))).toEqual([])
  })
})

describe("sealing", () => {
  it("opens what it sealed, under the label it was sealed under and no other", async () => {
    const sealer = await Sealer.for("secret", "team1")
    const sealed = await sealer.seal("l1", PASSWORD)
    expect(sealed).not.toContain(PASSWORD)
    expect(await sealer.open("l1", sealed)).toBe(PASSWORD)
    expect(await sealer.open("l2", sealed)).toBeUndefined()
  })

  it("does not open for another workspace or another secret", async () => {
    const sealed = await (await Sealer.for("secret", "team1")).seal("l1", PASSWORD)
    expect(await (await Sealer.for("secret", "team2")).open("l1", sealed)).toBeUndefined()
    expect(await (await Sealer.for("other", "team1")).open("l1", sealed)).toBeUndefined()
  })

  it("seals the same thing differently each time, and hides how long it is", async () => {
    const sealer = await Sealer.for("secret", "team1")
    const one = await sealer.seal("l1", "a")
    const two = await sealer.seal("l1", "a")
    expect(one).not.toBe(two)
    expect((await sealer.seal("l1", "a much longer password than that")).length).toBe(one.length)
  })

  it("does not open what was changed", async () => {
    const sealer = await Sealer.for("secret", "team1")
    const sealed = await sealer.seal("l1", PASSWORD)
    const flipped = `${sealed.slice(0, 30)}${sealed[30] === "A" ? "B" : "A"}${sealed.slice(31)}`
    expect(await sealer.open("l1", flipped)).toBeUndefined()
  })
})
