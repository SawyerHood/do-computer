import type { AppState } from "../api.ts"

const at = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const server = at<HTMLInputElement>("server")
const share = at<HTMLInputElement>("share")
const login = at<HTMLInputElement>("login")
const go = at<HTMLButtonElement>("go")
const error = at<HTMLParagraphElement>("error")

function show(state: AppState): void {
  server.value = state.suggestedServer
  // On a first run the deployment's welcome asks both of these, with the agent they are about.
  at("share-row").hidden = !state.welcomed
  at("login-row").hidden = !state.welcomed || !state.canOpenAtLogin
  if (state.server !== undefined) {
    // Coming back to choose another: as things are, not as a first run would have them.
    share.checked = state.sharing.state !== "off"
    login.checked = state.openAtLogin
    const leaving = at<HTMLParagraphElement>("leaving")
    leaving.hidden = state.sharing.state === "off"
    leaving.textContent = `With another server, this computer stops being shared with ${state.server} and is paired again.`
  }
  server.focus()
  server.select()
}

at<HTMLFormElement>("form").addEventListener("submit", (event) => {
  event.preventDefault()
  error.hidden = true
  go.disabled = true
  go.textContent = "Connecting…"
  void window.desktop
    .connect({
      server: server.value,
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
