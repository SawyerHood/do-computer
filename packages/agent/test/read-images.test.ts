import type { ImageLimits, PreparedImage } from "@do-computer/protocol"
import { type Sandbox, SandboxEnv } from "@do-computer/sandbox"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { describe, expect, it } from "vitest"
import { readPreparedImage } from "../src/read-images.ts"

const PREPARED: PreparedImage = {
  data: "/9j/AA==",
  mimeType: "image/jpeg",
  width: 1516,
  height: 758,
  from: { mimeType: "image/png", width: 2000, height: 1000, bytes: 900_000 },
}

/** A machine whose daemon prepares pictures as `answer` says, remembering what it was asked. */
function machine(answer: (path: string) => Promise<PreparedImage | undefined>) {
  const asked: { path: string; limits: ImageLimits }[] = []
  const sandbox = {
    id: "box",
    home: "/home/me",
    capabilities: { realBinaries: true, network: true },
    fs: {
      readImage: (path: string, limits: ImageLimits) => {
        asked.push({ path, limits })
        return answer(path)
      },
    },
  } as unknown as Sandbox
  return { sandbox, env: new SandboxEnv(sandbox, "/home/me/work"), asked }
}

/** What a tool is given, for a conversation on a model that takes `input`. */
const api = (input: string[], resize?: Record<string, number>) =>
  ({
    agent: async () => ({ model: { provider: "p", modelId: "m" } }),
    models: {
      getModel: () => ({
        input,
        ...(resize === undefined ? {} : { inputLimits: { images: { resize } } }),
      }),
    },
  }) as never

describe("a picture read on a computer", () => {
  it("is the picture the machine prepared, with what was done to it", async () => {
    const { sandbox, env, asked } = machine(async () => PREPARED)
    const result = await readPreparedImage(
      { path: "@shots/a\u202Fb.PNG" },
      env,
      sandbox,
      api(["text", "image"]),
      BACKGROUND_CONTEXT,
    )
    expect(asked).toEqual([
      {
        path: "/home/me/work/shots/a b.PNG",
        limits: { maxEdge: 1568, maxPixels: 1_150_000, maxBytes: 3_538_944 },
      },
    ])
    expect(result).toEqual({
      output: [{ type: "image", data: PREPARED.data, mimeType: "image/jpeg" }],
      diagnostics: [
        {
          severity: "info",
          code: "image",
          message:
            "Read image file [image/jpeg]. Converted from image/png to image/jpeg. Resized from 2000x1000 to 1516x758. Multiply coordinates by 1.32 to map them to the original.",
        },
      ],
    })
  })

  it("keeps within a model's own smaller limits", async () => {
    const { sandbox, env, asked } = machine(async () => PREPARED)
    await readPreparedImage(
      { path: "a.jpg" },
      env,
      sandbox,
      api(["text", "image"], { maxWidth: 1000, maxHeight: 1200, maxBytes: 400_000 }),
      BACKGROUND_CONTEXT,
    )
    expect(asked[0]!.limits).toEqual({ maxEdge: 1000, maxPixels: 1_150_000, maxBytes: 300_000 })
  })

  it("is left to `read` where the machine does not prepare it, or anything goes wrong", async () => {
    const read = (
      path: string,
      answer: () => Promise<PreparedImage | undefined>,
      input = ["image"],
    ) => {
      const { sandbox, env } = machine(answer)
      return readPreparedImage({ path }, env, sandbox, api(input), BACKGROUND_CONTEXT)
    }
    // Not a PNG or JPEG by its name; a model that does not look at pictures.
    expect(await read("notes.txt", async () => PREPARED)).toBeUndefined()
    expect(await read("a.webp", async () => PREPARED)).toBeUndefined()
    expect(await read("a.png", async () => PREPARED, ["text"])).toBeUndefined()
    // The daemon said to read it as it is, or failed.
    expect(await read("a.png", async () => undefined)).toBeUndefined()
    expect(
      await read("a.png", async () => {
        throw new Error("No such file")
      }),
    ).toBeUndefined()
    // A machine that prepares no pictures at all.
    const bare = { ...machine(async () => PREPARED).sandbox, fs: {} } as unknown as Sandbox
    expect(
      await readPreparedImage(
        { path: "a.png" },
        new SandboxEnv(bare),
        bare,
        api(["image"]),
        BACKGROUND_CONTEXT,
      ),
    ).toBeUndefined()
  })
})
