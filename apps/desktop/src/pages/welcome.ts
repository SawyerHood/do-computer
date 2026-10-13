import type { AppState } from "../api.ts"

const at = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const here = at<HTMLInputElement>("here")
const there = at<HTMLInputElement>("there")
const server = at<HTMLInputElement>("server")
const tailnet = at<HTMLInputElement>("tailnet")
const share = at<HTMLInputElement>("share")
const login = at<HTMLInputElement>("login")
const go = at<HTMLButtonElement>("go")
const error = at<HTMLParagraphElement>("error")
const leaving = at<HTMLParagraphElement>("leaving")

let now: AppState | undefined

/** What changes with which of the two is chosen. */
function chosen(): void {
  tailnet.disabled = !here.checked
  at("here-row").dataset.on = String(here.checked)
  at("there-row").dataset.on = String(there.checked)
  if (now?.server === undefined) return
  // Coming back to choose another: what leaving the one in use means.
  const staying = now.local ? here.checked : false
  leaving.hidden = staying || (!now.local && now.sharing.state === "off")
  leaving.textContent = now.local
    ? "What you have on this computer is kept, and is here when you come back to it. This computer is paired again with the server."
    : `With another, this computer stops being shared with ${now.server} and is paired again.`
}

function show(state: AppState): void {
  now = state
  // A copy of the app that does not bring Do Computer with it has only somewhere else to show.
  at("here-row").hidden = !state.canRunLocally
  const local = state.canRunLocally && (state.local || state.suggestedServer === "")
  here.checked = local
  there.checked = !local
  server.value = state.local ? "" : state.suggestedServer
  // Offered where Tailscale is there to do it. Where it is not, the app says how later.
  const ready = state.tailnet.status.state === "ready"
  at("tailnet-row").hidden = !ready
  tailnet.checked = state.tailnet.on
  if (state.tailnet.status.state === "ready") {
    at("tailnet-words").textContent =
      `As ${state.tailnet.status.name}, for the devices on your Tailscale network and nobody else.`
  }
  // On a first run the deployment's welcome asks both of these, with the Dood they are about.
  at("share-row").hidden = !state.welcomed
  at("login-row").hidden = !state.welcomed || !state.canOpenAtLogin
  if (state.server !== undefined) {
    // Coming back to choose another: as things are, not as a first run would have them.
    share.checked = state.sharing.state !== "off"
    login.checked = state.openAtLogin
  }
  chosen()
  if (there.checked) {
    server.focus()
    server.select()
  } else here.focus()
}

for (const choice of [here, there]) choice.addEventListener("change", chosen)
// Anywhere on one of the two chooses it, and so does writing an address.
for (const [row, choice] of [
  [at("here-row"), here],
  [at("there-row"), there],
] as const) {
  row.addEventListener("click", (event) => {
    if (choice.checked || (event.target as Element).closest("label, input[type=checkbox]")) return
    choice.checked = true
    chosen()
  })
}
server.addEventListener("input", () => {
  if (there.checked) return
  there.checked = true
  chosen()
})

at<HTMLFormElement>("form").addEventListener("submit", (event) => {
  event.preventDefault()
  error.hidden = true
  go.disabled = true
  go.textContent = here.checked ? "Starting…" : "Connecting…"
  void window.desktop
    .connect({
      local: here.checked,
      server: server.value,
      tailnet: here.checked && !at("tailnet-row").hidden && tailnet.checked,
      share: share.checked,
      openAtLogin: !at("login-row").hidden && login.checked,
    })
    .then((wrong) => {
      if (wrong === undefined) return
      error.textContent = wrong
      error.hidden = false
    })
    .finally(() => {
      go.disabled = false
      go.textContent = "Continue"
    })
})

void window.desktop.state().then(show)
// Tailscale is looked for as the page opens, and what it says comes a moment after.
window.desktop.watch((state) => {
  if (now === undefined || go.disabled) return
  const was = now.tailnet.status.state
  now = state
  if (state.tailnet.status.state === was) return
  at("tailnet-row").hidden = state.tailnet.status.state !== "ready"
  if (state.tailnet.status.state === "ready") {
    at("tailnet-words").textContent =
      `As ${state.tailnet.status.name}, for the devices on your Tailscale network and nobody else.`
  }
})
void window.desktop.lookForTailnet()
