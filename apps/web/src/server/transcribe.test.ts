import { describe, expect, it, vi } from "vitest"

vi.mock("#platform", () => ({ getPlatform: () => ({ config: {} }) }))

const { audioFormat, MAX_AUDIO_BYTES, transcribeAudio } = await import("./transcribe.ts")

const options = { apiKey: "sk-or-test", model: "openai/whisper-large-v3" }

describe("transcription", () => {
  it("maps what recorders produce to the format the service wants", () => {
    expect(audioFormat("audio/webm;codecs=opus")).toBe("webm")
    expect(audioFormat("audio/mp4")).toBe("m4a")
    expect(audioFormat("Audio/WAV")).toBe("wav")
    expect(audioFormat("text/plain")).toBe(undefined)
    expect(audioFormat(null)).toBe(undefined)
  })

  it("sends the audio base64-encoded with the key, and returns the text", async () => {
    let sent: { url: string; headers: Headers; body: Record<string, unknown> } | undefined
    const text = await transcribeAudio(new Uint8Array([1, 2, 3, 250]), "audio/x-m4a", {
      ...options,
      fetch: async (url, init) => {
        sent = {
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        }
        return Response.json({ text: "  remind me to call mom  ", usage: { seconds: 2 } })
      },
    })
    expect(text).toBe("remind me to call mom")
    expect(sent?.url).toBe("https://openrouter.ai/api/v1/audio/transcriptions")
    expect(sent?.headers.get("authorization")).toBe("Bearer sk-or-test")
    expect(sent?.body).toEqual({
      model: "openai/whisper-large-v3",
      input_audio: { data: "AQID+g==", format: "m4a" },
    })
  })

  it("refuses audio it cannot send, without calling the service", async () => {
    const never = async () => {
      throw new Error("should not be called")
    }
    await expect(
      transcribeAudio(new Uint8Array([1]), "video/quicktime", { ...options, fetch: never }),
    ).rejects.toMatchObject({ status: 415 })
    await expect(
      transcribeAudio(new Uint8Array(), "audio/wav", { ...options, fetch: never }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      transcribeAudio(new Uint8Array(MAX_AUDIO_BYTES + 1), "audio/wav", {
        ...options,
        fetch: never,
      }),
    ).rejects.toMatchObject({ status: 413 })
  })

  it("reports a failing service as a bad gateway, not as its own error", async () => {
    await expect(
      transcribeAudio(new Uint8Array([1]), "audio/wav", {
        ...options,
        fetch: async () => new Response("quota", { status: 429 }),
      }),
    ).rejects.toMatchObject({ status: 502, message: "The transcription service answered 429." })
    await expect(
      transcribeAudio(new Uint8Array([1]), "audio/wav", {
        ...options,
        fetch: async () => Response.json({ nothing: true }),
      }),
    ).rejects.toMatchObject({ status: 502 })
  })
})
