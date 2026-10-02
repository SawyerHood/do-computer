import { getPlatform } from "#platform"
import { BodyTooLarge, declaredTooLarge, readLimited } from "@durable-computer/protocol"
import { fail, json } from "./agents.ts"

/** Dictation is a sentence or two; this is minutes of compressed audio. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/** The `format` OpenRouter's transcription endpoint wants, from what the recorder said it made. */
const FORMATS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "video/webm": "webm",
}

export function audioFormat(contentType: string | null): string | undefined {
  // Recorders append the codec: "audio/webm;codecs=opus".
  return FORMATS[(contentType ?? "").split(";")[0]!.trim().toLowerCase()]
}

export class TranscriptionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function base64(bytes: Uint8Array): string {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/** Turn recorded speech into text with OpenRouter's speech-to-text endpoint. */
export async function transcribeAudio(
  audio: Uint8Array,
  contentType: string | null,
  options: { apiKey: string; model: string; fetch?: typeof fetch },
): Promise<string> {
  const format = audioFormat(contentType)
  if (format === undefined) {
    throw new TranscriptionError(415, `Audio of type "${contentType}" cannot be transcribed.`)
  }
  if (audio.length === 0) throw new TranscriptionError(400, "The recording is empty.")
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new TranscriptionError(413, "The recording is too long. Try a shorter one.")
  }
  const response = await (options.fetch ?? fetch)(
    "https://openrouter.ai/api/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: options.model, input_audio: { data: base64(audio), format } }),
    },
  )
  if (!response.ok) {
    throw new TranscriptionError(502, `The transcription service answered ${response.status}.`)
  }
  const result = (await response.json()) as { text?: unknown }
  if (typeof result.text !== "string") {
    throw new TranscriptionError(502, "The transcription service sent no text.")
  }
  return result.text.trim()
}

/** The recording is the request body; the answer is its text. */
export async function transcribe(request: Request): Promise<Response> {
  const { config } = getPlatform()
  if (config.openrouterApiKey === undefined) {
    return fail(503, "Dictation needs a model key, and this deployment has none configured.")
  }
  const tooLong = () => fail(413, "The recording is too long. Try a shorter one.")
  if (declaredTooLarge(request.headers, MAX_AUDIO_BYTES)) return tooLong()
  let audio: Uint8Array
  try {
    audio = await readLimited(request.body, MAX_AUDIO_BYTES)
  } catch (error) {
    if (error instanceof BodyTooLarge) return tooLong()
    return fail(400, "The recording was cut off before it arrived.")
  }
  try {
    const text = await transcribeAudio(audio, request.headers.get("content-type"), {
      apiKey: config.openrouterApiKey,
      model: config.transcriptionModel,
    })
    return json({ text })
  } catch (error) {
    if (error instanceof TranscriptionError) return fail(error.status, error.message)
    throw error
  }
}
