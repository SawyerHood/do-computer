import type { AppState, DeviceLink } from "../api.ts"

const at = <T extends Element>(id: string) => document.getElementById(id) as unknown as T
const reach = at<HTMLInputElement>("reach")
const fixOpen = at<HTMLButtonElement>("fix-open")
const code = at<SVGSVGElement>("code")
const codeWords = at<HTMLElement>("code-words")
const SVG = "http://www.w3.org/2000/svg"

let now: AppState | undefined
/** The way in that is on show, and when it stops working. */
let shown: { link: DeviceLink; until: number } | undefined
let asking = false

/** How this computer stands with Tailscale, in a line, and what to do about it in another. */
function standing(state: AppState): { headline: string; words: string; fix?: string } {
  const { status, on, address } = state.tailnet
  switch (status.state) {
    case "missing":
      return {
        headline: "Tailscale is not installed",
        words:
          "Tailscale joins your devices into a private network of your own. Install it on this computer and on the devices you want to use, sign in on each, then come back here.",
        fix: "Get Tailscale",
      }
    case "stopped":
      return {
        headline: "Tailscale is not connected",
        words: "Open Tailscale on this computer and sign in, then look again.",
      }
    case "no-https":
      return {
        headline: "Your network gives no certificates yet",
        words:
          "Do Computer is served with a certificate of its own, which your Tailscale network has to allow once: turn on HTTPS Certificates in Tailscale’s admin console, under DNS.",
        fix: "Open the admin console",
      }
    case "ready":
      return on && address !== undefined
        ? { headline: "Your other devices can reach it", words: `This computer is ${status.name}.` }
        : {
            headline: "Only this computer can reach it",
            words: `Tailscale is connected, as ${status.name}.`,
          }
  }
}

/** Draw the code: a dark square for each cell that is one, with the quiet edge a scanner wants. */
function draw(link: DeviceLink): void {
  const edge = 4
  const side = link.size + edge * 2
  code.setAttribute("viewBox", `0 0 ${side} ${side}`)
  code.setAttribute("shape-rendering", "crispEdges")
  const ground = document.createElementNS(SVG, "rect")
  ground.setAttribute("width", String(side))
  ground.setAttribute("height", String(side))
  ground.setAttribute("fill", "#fff")
  let path = ""
  for (let y = 0; y < link.size; y++) {
    for (let x = 0; x < link.size; x++) {
      if (link.cells[y * link.size + x] === 1) path += `M${x + edge} ${y + edge}h1v1h-1z`
    }
  }
  const cells = document.createElementNS(SVG, "path")
  cells.setAttribute("d", path)
  cells.setAttribute("fill", "#000")
  code.replaceChildren(ground, cells)
}

/** How long the code on show still works, said as it runs down. */
function tick(): void {
  if (shown === undefined) return
  const left = Math.max(0, Math.round((shown.until - Date.now()) / 1000))
  code.dataset.spent = String(left === 0)
  codeWords.textContent =
    left === 0
      ? "That code has run out."
      : left > 90
        ? `Works once, for the next ${Math.round(left / 60)} minutes.`
        : `Works once, for the next ${left} seconds.`
}

async function newCode(): Promise<void> {
  if (asking) return
  asking = true
  codeWords.textContent = "Making a code…"
  const link = await window.desktop.deviceLink().finally(() => (asking = false))
  if ("error" in link) {
    shown = undefined
    code.replaceChildren()
    codeWords.textContent = link.error
    return
  }
  shown = { link, until: Date.now() + link.seconds * 1000 }
  draw(link)
  tick()
}

function show(state: AppState): void {
  now = state
  const { status, on, address, problem, busy } = state.tailnet
  const stands = standing(state)
  at<HTMLElement>("headline").textContent = busy ? "One moment…" : stands.headline
  at<HTMLElement>("words").textContent = stands.words
  at<HTMLElement>("dot").dataset.tone =
    address !== undefined ? "on" : status.state === "ready" ? "off" : "busy"
  at<HTMLElement>("fix").hidden = status.state === "ready"
  fixOpen.hidden = stands.fix === undefined
  fixOpen.textContent = stands.fix ?? ""
  at<HTMLElement>("reach-row").hidden = status.state !== "ready"
  reach.checked = on && address !== undefined
  reach.disabled = busy
  const said = at<HTMLElement>("problem")
  said.hidden = problem === undefined || status.state !== "ready"
  said.textContent = problem ?? ""
  const reached = address !== undefined
  at<HTMLElement>("reached").hidden = !reached
  at<HTMLElement>("address").textContent = address ?? ""
  if (!reached) {
    shown = undefined
    code.replaceChildren()
  } else if (shown === undefined && !asking) void newCode()
}

/** A button that says it did what it does, for a moment. */
function copies(id: string, text: () => string | undefined): void {
  const button = at<HTMLButtonElement>(id)
  const label = button.textContent
  button.addEventListener("click", () => {
    const words = text()
    if (words === undefined) return
    void window.desktop.copy(words).then(() => {
      button.textContent = "Copied"
      setTimeout(() => (button.textContent = label), 1_400)
    })
  })
}

reach.addEventListener("change", () => void window.desktop.setTailnet(reach.checked))
at<HTMLButtonElement>("look").addEventListener("click", () => void window.desktop.lookForTailnet())
fixOpen.addEventListener("click", () => {
  const state = now?.tailnet.status.state
  if (state === "missing") void window.desktop.open("tailscale")
  if (state === "no-https") void window.desktop.open("tailscale-https")
})
at<HTMLButtonElement>("new-code").addEventListener("click", () => void newCode())
copies("copy-address", () => now?.tailnet.address)
copies("copy-link", () =>
  shown !== undefined && shown.until > Date.now() ? shown.link.link : undefined,
)

void window.desktop.state().then(show)
window.desktop.watch(show)
setInterval(tick, 1_000)
