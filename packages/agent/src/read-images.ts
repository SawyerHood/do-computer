import { IMAGE_MAX_EDGE, IMAGE_MAX_PIXELS, type ImageLimits } from "@do-computer/protocol"
import type { Sandbox } from "@do-computer/sandbox"
import type { Context } from "@earendil-works/chord"
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"

/**
 * The pictures `read` has the computer prepare: the formats its daemon decodes. Others (WebP, GIF)
 * are read as they are, as is a picture whose name does not say what it is.
 */
export const PREPARED_IMAGE_FILE = /\.(?:png|jpe?g)$/i

/** Spaces a model writes for a plain one, and the `@` it puts before a path: as `read` takes them. */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g

/** pi-durable's default limit on a picture's base64, below Anthropic's 5 MB. */
const DEFAULT_MAX_BASE64 = 4.5 * 1024 * 1024

/**
 * What the conversation's model takes, as pi-durable's `read` works it out: whether it sees
 * pictures, and how large. A model that cannot be found counts as one that sees them.
 */
async function imageModel(
  api: ToolExecutionApi,
  context: Context,
): Promise<{ vision: boolean; limits: ImageLimits }> {
  const ref = (await api.agent(context)).model
  const model = ref === undefined ? undefined : api.models.getModel(ref.provider, ref.modelId)
  const resize = (
    model as
      { inputLimits?: { images?: { resize?: Record<string, number | undefined> } } } | undefined
  )?.inputLimits?.images?.resize
  return {
    vision: model?.input.includes("image") ?? true,
    limits: {
      maxEdge: Math.min(
        IMAGE_MAX_EDGE,
        resize?.maxWidth ?? Infinity,
        resize?.maxHeight ?? Infinity,
      ),
      maxPixels: IMAGE_MAX_PIXELS,
      maxBytes: Math.floor(((resize?.maxBytes ?? DEFAULT_MAX_BASE64) / 4) * 3),
    },
  }
}

/**
 * `read` of a picture, prepared on the computer it is on so that the agent is sent and keeps no
 * more of it than its model can see: scaled to what the provider would scale it to, and as a
 * JPEG where that is smaller (`prepareImage` in `@do-computer/computers`). A conversation keeps
 * every picture it was shown and sends them all with every request, so a picture that came in
 * whole would be held, many times over, in the memory of the agent's actor. The result is the
 * one pi-durable's `read` gives, with the same notes about what was done.
 *
 * Undefined, for `read` to do as it always has, where the file is not a PNG or JPEG by its name,
 * the model does not look at pictures, the computer cannot prepare them (a daemon from before it
 * could, a machine not reached through one), or anything goes wrong on the way: `read` then says
 * what, in its own words. The actor never decodes a picture.
 */
export async function readPreparedImage(
  args: { path?: unknown },
  env: ExecutionEnv,
  sandbox: Sandbox,
  api: ToolExecutionApi,
  context: Context,
): Promise<ToolExecutionResult | undefined> {
  const readImage = sandbox.fs.readImage
  if (readImage === undefined || typeof args.path !== "string") return undefined
  const spaced = args.path.replace(UNICODE_SPACES, " ")
  const path = spaced.startsWith("@") ? spaced.slice(1) : spaced
  if (!PREPARED_IMAGE_FILE.test(path)) return undefined
  try {
    const { vision, limits } = await imageModel(api, context)
    if (!vision) return undefined
    const absolute = await env.absolutePath(path, context)
    if (!absolute.ok) return undefined
    const image = await readImage.call(sandbox.fs, absolute.value, limits)
    if (image === undefined) return undefined
    const notes = [`Read image file [${image.mimeType}].`]
    if (image.from.mimeType !== image.mimeType) {
      notes.push(`Converted from ${image.from.mimeType} to ${image.mimeType}.`)
    }
    if (image.from.width !== image.width || image.from.height !== image.height) {
      const scale = (image.from.width / image.width).toFixed(2)
      notes.push(
        `Resized from ${image.from.width}x${image.from.height} to ${image.width}x${image.height}. Multiply coordinates by ${scale} to map them to the original.`,
      )
    }
    return {
      output: [{ type: "image", data: image.data, mimeType: image.mimeType }],
      diagnostics: [{ severity: "info", code: "image", message: notes.join(" ") }],
    }
  } catch {
    return undefined
  }
}
