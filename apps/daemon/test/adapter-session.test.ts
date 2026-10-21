import { chmod, mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import type { Command } from "../src/adapters/command.ts"
import { discoverSession } from "../src/adapters/session.ts"

const uid = process.getuid?.() ?? 0
const clean: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of clean.reverse()) await dispose()
  clean.length = 0
})
const runFor =
  (
    owner: number,
    type = "wayland",
    ids = `3 ${owner} me seat0 tty2\n8 ${owner + 1} somebody seat1 tty3`,
  ): Command =>
  async (file, args, options) => {
    options?.signal?.throwIfAborted()
    expect(file).toBe("loginctl")
    if (args[0] === "list-sessions") return Buffer.from(ids)
    expect(args[1]).not.toBe("8")
    return Buffer.from(`User=${owner}\nType=${type}\nActive=yes\nDisplay=:77\n`)
  }
async function socket(path: string) {
  await mkdir(join(path, ".."), { recursive: true })
  const server: Server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(path, resolve)
  })
  clean.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  )
}
async function runtime() {
  const path = await mkdtemp(join(tmpdir(), "dc-screen-"))
  clean.push(() => rm(path, { recursive: true, force: true }))
  await socket(join(path, "wayland-7"))
  await socket(join(path, "hypr", "owned-instance", ".socket.sock"))
  return path
}

it.skipIf(uid === 0 || process.platform === "win32")(
  "discovers a unique owned runtime without reading another user's session",
  async () => {
    const path = await runtime()
    const env = { XDG_RUNTIME_DIR: path }
    const discovered = await discoverSession(env, runFor(uid))
    expect(discovered.reason).toBeUndefined()
    expect(discovered.env).toMatchObject({
      XDG_RUNTIME_DIR: path,
      XDG_SESSION_ID: "3",
      XDG_SESSION_TYPE: "wayland",
      WAYLAND_DISPLAY: "wayland-7",
      HYPRLAND_INSTANCE_SIGNATURE: "owned-instance",
    })
    expect(env).toEqual({ XDG_RUNTIME_DIR: path })
  },
)
it.skipIf(uid === 0 || process.platform === "win32")(
  "refuses ambiguous Wayland sockets and accepts an explicit choice",
  async () => {
    const path = await runtime()
    await socket(join(path, "wayland-9"))
    const discovered = await discoverSession({ XDG_RUNTIME_DIR: path }, runFor(uid))
    expect(discovered.reason).toMatch(/Multiple owned Wayland/)
    expect(discovered.env.WAYLAND_DISPLAY).toBeUndefined()
    const explicit = await discoverSession(
      { XDG_RUNTIME_DIR: path, WAYLAND_DISPLAY: "wayland-9" },
      runFor(uid),
    )
    expect(explicit.env.WAYLAND_DISPLAY).toBe("wayland-9")
    expect(explicit.reason).toBeUndefined()
  },
)
it.skipIf(uid === 0 || process.platform === "win32")(
  "refuses ambiguous Hyprland instances",
  async () => {
    const path = await runtime()
    await socket(join(path, "hypr", "other-instance", ".socket.sock"))
    const discovered = await discoverSession({ XDG_RUNTIME_DIR: path }, runFor(uid))
    expect(discovered.reason).toMatch(/Multiple owned Hyprland/)
    expect(discovered.env.HYPRLAND_INSTANCE_SIGNATURE).toBeUndefined()
    expect(discovered.blocked).toBe(true)
  },
)
it.skipIf(uid === 0 || process.platform === "win32")(
  "will not follow a runtime directory symlink",
  async () => {
    const path = await runtime()
    const link = `${path}-link`
    await symlink(path, link)
    clean.push(() => rm(link, { force: true }))
    const discovered = await discoverSession({ XDG_RUNTIME_DIR: link }, runFor(uid))
    expect(discovered.reason).toMatch(/not owned/)
    expect(discovered.env.WAYLAND_DISPLAY).toBeUndefined()
  },
)
it.skipIf(uid === 0 || process.platform === "win32")(
  "rejects a writable runtime or a symlinked Hyprland runtime",
  async () => {
    const path = await runtime()
    await chmod(path, 0o777)
    expect((await discoverSession({ XDG_RUNTIME_DIR: path }, runFor(uid))).reason).toMatch(
      /writable by others/,
    )
    await chmod(path, 0o700)
    const outside = await runtime()
    await rm(join(path, "hypr"), { recursive: true, force: true })
    await symlink(join(outside, "hypr"), join(path, "hypr"))
    const discovered = await discoverSession({ XDG_RUNTIME_DIR: path }, runFor(uid))
    expect(discovered.reason).toMatch(/not a private owned/)
    expect(discovered.env.HYPRLAND_INSTANCE_SIGNATURE).toBeUndefined()
  },
)
it.skipIf(uid === 0 || process.platform === "win32")(
  "identifies generic Wayland as unsupported rather than choosing XWayland",
  async () => {
    const path = await runtime()
    await rm(join(path, "hypr", "owned-instance", ".socket.sock"))
    const discovered = await discoverSession({ XDG_RUNTIME_DIR: path, DISPLAY: ":0" }, runFor(uid))
    expect(discovered.reason).toMatch(/generic Wayland is not supported/)
    expect(discovered.blocked).toBe(false)
    expect(discovered.env.HYPRLAND_INSTANCE_SIGNATURE).toBeUndefined()
  },
)
it("refuses multiple owned graphical logins even if a socket name would be unambiguous", async () => {
  const discovered = await discoverSession(
    {},
    runFor(1000, "wayland", "3 1000 me seat0\n4 1000 me seat1"),
    1000,
  )
  expect(discovered.reason).toMatch(/Multiple owned graphical sessions/)
  expect(discovered.env.XDG_SESSION_ID).toBeUndefined()
  expect(discovered.blocked).toBe(true)
})
it("never discovers for root or accepts another user's explicit session", async () => {
  expect(
    (
      await discoverSession(
        {},
        async () => {
          throw new Error("must not run")
        },
        0,
      )
    ).reason,
  ).toMatch(/non-root/)
  const discovered = await discoverSession(
    { XDG_SESSION_ID: "3", XDG_RUNTIME_DIR: "/must-not-be-read" },
    runFor(2000),
    1000,
  )
  expect(discovered.reason).toMatch(/does not belong/)
  expect(discovered.env.WAYLAND_DISPLAY).toBeUndefined()
})
it("discovers an owned X11 display using logind, not another user's Xauthority", async () => {
  const discovered = await discoverSession({}, runFor(1000, "x11"), 1000)
  expect(discovered.env).toMatchObject({
    XDG_SESSION_ID: "3",
    XDG_SESSION_TYPE: "x11",
    DISPLAY: ":77",
  })
  expect(discovered.env.XAUTHORITY).toBeUndefined()
})
it("does not overwrite an explicit environment or scan its sockets", async () => {
  const env = {
    XDG_SESSION_ID: "3",
    WAYLAND_DISPLAY: "wayland-owner",
    HYPRLAND_INSTANCE_SIGNATURE: "chosen",
    XDG_RUNTIME_DIR: "/explicit-not-scanned",
  }
  expect((await discoverSession(env, runFor(1000), 1000)).env).toMatchObject(env)
})
it("cancels discovery before running any command", async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    discoverSession(
      {},
      async () => {
        throw new Error("must not run")
      },
      1000,
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" })
})
it.skipIf(uid === 0 || process.platform === "win32")(
  "accepts group-writable Hyprland directories (umask 0002) but not world-writable ones",
  async () => {
    const path = await runtime()
    await chmod(join(path, "hypr"), 0o775)
    await chmod(join(path, "hypr", "owned-instance"), 0o775)
    const discovered = await discoverSession({ XDG_RUNTIME_DIR: path }, runFor(uid))
    expect(discovered.reason).toBeUndefined()
    expect(discovered.env.HYPRLAND_INSTANCE_SIGNATURE).toBe("owned-instance")
    await chmod(join(path, "hypr", "owned-instance"), 0o777)
    const instance = await discoverSession({ XDG_RUNTIME_DIR: path }, runFor(uid))
    expect(instance.env.HYPRLAND_INSTANCE_SIGNATURE).toBeUndefined()
    await chmod(join(path, "hypr", "owned-instance"), 0o700)
    await chmod(join(path, "hypr"), 0o777)
    expect((await discoverSession({ XDG_RUNTIME_DIR: path }, runFor(uid))).reason).toMatch(
      /not a private owned/,
    )
  },
)
