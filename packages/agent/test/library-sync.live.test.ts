import { daytonaSandbox } from "@do-computer/sandbox/daytona"
import { afterAll, describe, expect, it } from "vitest"
import { listFolder } from "../src/library-sync.ts"

/**
 * The listing the library folder is read with, against a real Daytona machine. Skipped unless
 * DAYTONA_API_KEY is set, because it creates a machine on that account (and deletes it at the end).
 *
 *   DAYTONA_API_KEY=... pnpm exec vitest run test/library-sync.live.test.ts
 */
const apiKey = process.env.DAYTONA_API_KEY ?? ""
const id = `live-library-${Date.now().toString(36)}`
const open = () => daytonaSandbox({ id, apiKey })

describe.skipIf(apiKey === "")("the library folder on Daytona, for real", () => {
  afterAll(async () => {
    await open().destroy?.()
  }, 120_000)

  it("lists the folder with one command, and sees a file change", async () => {
    const sandbox = open()
    const folder = `${sandbox.home}/library`
    expect(await listFolder(sandbox, folder)).toEqual(new Map())
    const made = await sandbox.exec(
      "mkdir -p library/trip/photos library/node_modules/x library/.cache && printf '# Plan' > 'library/trip/the plan.md' && printf 1 > library/node_modules/x/i.js && printf 1 > library/.cache/c && printf pixels > library/trip/photos/a.png",
    )
    expect(made.exitCode).toBe(0)
    const listed = await listFolder(sandbox, folder)
    expect([...listed.keys()].sort()).toEqual(["trip/photos/a.png", "trip/the plan.md"])
    expect(listed.get("trip/the plan.md")).toMatchObject({ size: 6 })

    // Written through the file API, as a push from the library is, and listed again.
    await sandbox.fs.writeFile(`${folder}/trip/the plan.md`, new TextEncoder().encode("# Plan B"))
    const after = await listFolder(sandbox, folder)
    expect(after.get("trip/the plan.md")!.size).toBe(8)
    expect(after.get("trip/photos/a.png")).toEqual(listed.get("trip/photos/a.png"))
    expect(new TextDecoder().decode(await sandbox.fs.readFile(`${folder}/trip/photos/a.png`))).toBe(
      "pixels",
    )
  }, 240_000)
})
