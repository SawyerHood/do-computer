// A spike, not part of the app: places one real voice call paid for by a ChatGPT (Codex)
// subscription, from our own code, the way OpenAI's open-source Codex client does it. It is the
// record of what PLAN-voice-calls.md section 10 says, and a quick way to see whether the route
// still works. It speaks three sentences into the call and prints what comes back:
//
//   node prototypes/voice-calls/spike/codex-call.mjs          one call of about 45 seconds
//   node prototypes/voice-calls/spike/codex-call.mjs --dry    everything but the call
//
// It reads the Codex client's own sign-in (~/.codex/auth.json, made by `codex login`), does not
// print, refresh or write it, and sends it only to chatgpt.com and api.openai.com. The call
// counts against that subscription. It needs ffmpeg built with flite (for the voice that stands
// in for a microphone) and a Chromium (PLAYWRIGHT_CHROMIUM_PATH, or Playwright's own).
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import http from "node:http"
import { createRequire } from "node:module"
import { homedir, tmpdir } from "node:os"
const require = createRequire(new URL("../../../apps/web/package.json", import.meta.url))
const { chromium } = require("@playwright/test")
const WebSocket = require("ws")

const dry = process.argv.includes("--dry")
const auth = JSON.parse(readFileSync(`${process.env.CODEX_HOME ?? `${homedir()}/.codex`}/auth.json`, "utf8"))
const token = auth.tokens.access_token
const account = auth.tokens.account_id
const headers = {
  Authorization: `Bearer ${token}`,
  "ChatGPT-Account-ID": account,
  "openai-alpha": "quicksilver=v2",
  // pi's own name for itself, which is what the app's text requests on this sign-in carry.
  originator: "pi",
  "User-Agent": "pi/1.2.0 (do-computer voice spike)",
}
const t0 = Date.now()
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(2).padStart(6)}s`, ...a)
const scrub = (s) => String(s).replaceAll(token, "<token>").replaceAll(account, "<account>")

// What the pretend owner says, and when. A browser plays this file as its microphone.
const SAY = [
  [7, "Hello. Can you hear me. Please answer in one short sentence."],
  [9, "What is my favorite color."],
  [9, "Please look in my project folder and tell me how many files are in it."],
]
const mic = `${tmpdir()}/dc-voice-spike-mic.wav`
if (!existsSync(mic)) {
  const args = ["-loglevel", "error", "-y"]
  for (const [gap, text] of SAY) args.push("-f", "lavfi", "-t", String(gap), "-i", "anullsrc=r=48000:cl=mono", "-f", "lavfi", "-i", `flite=text='${text}':voice=slt`)
  args.push("-f", "lavfi", "-t", "40", "-i", "anullsrc=r=48000:cl=mono")
  const n = SAY.length * 2 + 1
  args.push("-filter_complex", `${Array.from({ length: n }, (_, i) => `[${i}]aresample=48000[a${i}]`).join(";")};${Array.from({ length: n }, (_, i) => `[a${i}]`).join("")}concat=n=${n}:v=0:a=1`, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", mic)
  execFileSync("ffmpeg", args)
}

const session = {
  model: "gpt-live-1-codex",
  instructions:
    "You are Juniper, a small friendly assistant on a voice call with your owner. Answer in one short sentence. " +
    "You cannot see the owner's files or projects yourself: for anything about them, delegate, and never guess.",
  // One of: juniper, maple, spruce, ember, vale, breeze, arbor, sol, cove. Any other is refused
  // with "Voice session access denied".
  audio: { output: { voice: "juniper" } },
  delegation: { type: "client" },
  // What was said before the call: up to 128 messages, 8,192 tokens.
  initial_items: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "My favorite color is teal. Remember that." }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Got it: teal." }] },
  ],
}

// A page on localhost, which a browser lets use a microphone.
const server = http.createServer((_, res) => res.end("<!doctype html><title>spike</title><audio id=a autoplay></audio>")).listen(0, "127.0.0.1")
await new Promise((r) => server.once("listening", r))
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${mic}%noloop`, "--autoplay-policy=no-user-gesture-required"],
})
const page = await browser.newPage()
page.on("console", (m) => log("browser:", m.text()))
await page.goto(`http://127.0.0.1:${server.address().port}/`)
const sdp = await page.evaluate(async () => {
  const pc = (window.pc = new RTCPeerConnection())
  pc.ontrack = (e) => (document.getElementById("a").srcObject = new MediaStream([e.track]))
  pc.onconnectionstatechange = () => console.log(`peer connection ${pc.connectionState}`)
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  for (const track of stream.getTracks()) pc.addTrack(track, stream)
  // The call does not connect without this channel. The same events arrive on it as on the
  // server's line, less the sound.
  const events = pc.createDataChannel("oai-events")
  events.onopen = () => console.log("data channel open")
  events.onmessage = (e) => /"type":"error"/.test(e.data) && console.log(`error on the data channel: ${String(e.data).slice(0, 240)}`)
  await pc.setLocalDescription(await pc.createOffer())
  await new Promise((done) => {
    if (pc.iceGatheringState === "complete") return done()
    pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && done()
    setTimeout(done, 2500)
  })
  return pc.localDescription.sdp
})
log(`offer made (${sdp.length} characters)`)
const finish = async (result) => {
  await browser.close()
  server.close()
  console.log("RESULT", JSON.stringify(result, null, 1))
  process.exit(0)
}
if (dry) await finish({ dry: true })

const res = await fetch("https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas", {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ sdp, session }),
})
const answer = await res.text()
const result = { status: res.status, heard: [], said: [], handoffs: 0 }
log("call:", res.status, res.statusText)
if (!res.ok || !answer.startsWith("v=0")) {
  log(scrub(answer).slice(0, 600))
  await finish(result)
}
const callId = (res.headers.get("location") ?? "").split("?")[0].split("/").filter(Boolean).pop()
await page.evaluate((a) => window.pc.setRemoteDescription({ type: "answer", sdp: a }), answer)

// The server's own line onto the same call. It answers 404 until the browser's sound connects.
const connect = (tries = 0) =>
  new Promise((done, fail) => {
    const side = new WebSocket(`wss://api.openai.com/v1/live/${callId}`, { headers })
    side.once("open", () => done(side))
    side.once("unexpected-response", (_, r) => (r.statusCode === 404 && tries < 6 ? setTimeout(() => connect(tries + 1).then(done, fail), 300) : fail(new Error(`the server's line was refused: ${r.statusCode}`))))
    side.once("error", fail)
  })
const side = await connect().catch((e) => (log(e.message), null))
if (!side) await finish(result)
side.on("message", (data) => {
  const ev = JSON.parse(data.toString())
  if (ev.type === "session.started") log("session started")
  else if (ev.type === "turn.done") {
    log(`${ev.turn.role === "user" ? "heard" : "said "}:`, JSON.stringify(ev.turn.transcript.trim()))
    ;(ev.turn.role === "user" ? result.heard : result.said).push(ev.turn.transcript.trim())
  } else if (ev.type === "delegation.created") {
    result.handoffs += 1
    log("handed on:", JSON.stringify(ev.item.content.map((c) => c.text).join("")))
    const append = (channel, text) => side.send(JSON.stringify({ type: "delegation.context.append", delegation_item_id: ev.item.id, channel, content: [{ type: "input_text", text }] }))
    // What the Dood would send: progress while it works, then its answer.
    setTimeout(() => append("commentary", "Counting the files in the project folder now."), 300)
    setTimeout(() => append("speakable", "There are forty-two files in the project folder."), 2500)
  } else if (ev.type === "session.closed") {
    result.seconds = Math.round(ev.usage.audio_duration_ms / 1000)
    log("session closed:", ev.reason)
  } else if (ev.type === "error") log("error:", scrub(JSON.stringify(ev)).slice(0, 300))
})

const until = Date.now() + 62_000
while (Date.now() < until && !result.said.some((s) => /forty|42/i.test(s))) await new Promise((r) => setTimeout(r, 1000))
await new Promise((r) => setTimeout(r, 2000))
result.sound = await page.evaluate(async () => {
  for (const s of (await window.pc.getStats()).values()) if (s.type === "inbound-rtp" && s.kind === "audio") return { packets: s.packetsReceived, energy: +s.totalAudioEnergy.toFixed(3) }
  return null
})
side.send(JSON.stringify({ type: "session.close" }))
await new Promise((r) => setTimeout(r, 1500))
side.close()
await finish(result)
