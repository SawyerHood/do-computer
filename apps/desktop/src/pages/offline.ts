const at = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

void window.desktop.state().then((state) => {
  at("server").textContent = state.server ?? "The server"
})
at("retry").addEventListener("click", () => void window.desktop.retry())
at("change").addEventListener("click", () => void window.desktop.changeServer())
// A laptop that was closed comes back to this page. It should not stay on it.
setInterval(() => void window.desktop.retry(), 5_000)
