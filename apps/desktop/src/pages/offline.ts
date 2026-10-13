import type { AppState } from "../api.ts"

const at = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function show(state: AppState): void {
  if (!state.local) {
    at("server").textContent = state.server ?? "The server"
    return
  }
  // The app runs Do Computer itself, and starts it again when it stops.
  const { serving } = state
  at("title").textContent =
    serving.state === "stopped" ? "Do Computer stopped" : "Starting Do Computer…"
  at("words").textContent =
    serving.state === "stopped"
      ? `It is being started again on this computer.${serving.detail === undefined ? "" : ` The last thing it said: ${serving.detail}`}`
      : "It runs on this computer, and will be here in a moment."
  // It is here: no need to wait for the next look.
  if (serving.state === "running") void window.desktop.retry()
}

void window.desktop.state().then(show)
window.desktop.watch(show)
at("retry").addEventListener("click", () => void window.desktop.retry())
at("change").addEventListener("click", () => void window.desktop.changeServer())
// A laptop that was closed comes back to this page. It should not stay on it.
setInterval(() => void window.desktop.retry(), 5_000)
