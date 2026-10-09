import type { AppState } from "../api.ts"

const at = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const readOnly = at<HTMLInputElement>("read-only")
const login = at<HTMLInputElement>("login")
const toggle = at<HTMLButtonElement>("toggle")
const log = at<HTMLOListElement>("log")

let now: AppState | undefined
let shown = 0

/** A line of the daemon's, with the time it carries shortened to the time of day. */
function entry(line: string): HTMLLIElement {
  const item = document.createElement("li")
  const stamped = /^\[(\d{4}-\d\d-\d\dT[\d:.]+Z)\] (.*)$/.exec(line)
  if (stamped === null) {
    item.textContent = line
    return item
  }
  const time = document.createElement("time")
  time.dateTime = stamped[1]!
  time.textContent = new Date(stamped[1]!).toLocaleTimeString([], { hour12: false })
  item.append(time, stamped[2]!)
  return item
}

function show(state: AppState): void {
  now = state
  const { sharing } = state
  const off = sharing.state === "off"
  at("headline").textContent = state.headline
  at("dot").dataset.tone = sharing.state === "connected" ? "on" : off ? "off" : "busy"
  at("pairing").hidden = sharing.state !== "pairing"
  if (sharing.state === "pairing") at("code").textContent = sharing.code
  const detail = at("detail")
  detail.hidden = !(sharing.state === "stopped" && sharing.detail !== undefined)
  if (sharing.state === "stopped") detail.textContent = sharing.detail ?? ""
  // Whether agents may change anything is said when the computer is shared, not after.
  at("read-only-row").hidden = !off
  if (off) readOnly.checked = state.readOnly
  toggle.textContent = off ? "Let agents use this computer" : "Stop letting agents use it"
  toggle.className = off ? "primary" : ""
  toggle.disabled = state.server === undefined
  at("login-row").hidden = !state.canOpenAtLogin
  login.checked = state.openAtLogin
  at("server").textContent = state.server ?? "None chosen yet"

  // Only what is new is added, so that what its owner selected or scrolled to stays put.
  const pinned = log.scrollTop + log.clientHeight >= log.scrollHeight - 4
  if (state.log.length < shown) {
    log.replaceChildren()
    shown = 0
  }
  for (const line of state.log.slice(shown)) log.append(entry(line))
  shown = state.log.length
  if (pinned) log.scrollTop = log.scrollHeight
}

toggle.addEventListener("click", () => {
  toggle.disabled = true
  void window.desktop.share(now?.sharing.state === "off", readOnly.checked)
})
at("confirm").addEventListener("click", () => void window.desktop.confirm())
at("change").addEventListener("click", () => void window.desktop.changeServer())
login.addEventListener("change", () => void window.desktop.setOpenAtLogin(login.checked))

window.desktop.watch(show)
void window.desktop.state().then(show)
