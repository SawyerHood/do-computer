// The pieces every screen of the mock-up is put together from: icons, the phone and its bars,
// lists, and the creatures' pictures. Everything returns a string of HTML.
import { existsSync, readFileSync } from "node:fs"

const C = JSON.parse(readFileSync(new URL("creatures.json", import.meta.url), "utf8"))

const P = {
  chevL: '<path d="m15 5-7 7 7 7"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="m16 16 4 4"/>',
  compose: '<path d="M12 4H6.500A2.500 2.500 0 0 0 4 6.500v11A2.500 2.500 0 0 0 6.500 20h11a2.500 2.500 0 0 0 2.500-2.500V12"/><path d="m10 14 .700-3L19 2.800l2.200 2.200L13 13.300z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  dots: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="2.800"/>',
  chats: '<path d="M14 9.500A5.500 5.500 0 0 0 8.500 4h-1A5.500 5.500 0 0 0 4 13.700V17l3-1.600h1.500"/><path d="M11 13.500a4.500 4.500 0 0 1 4.500-4.500h1a4.500 4.500 0 0 1 3 7.900V20l-2.800-1.500h-1.200a4.500 4.500 0 0 1-4.500-4.500z"/>',
  folder: '<path d="M3 7.500A1.500 1.500 0 0 1 4.500 6h4.600l2 2.200h8.400A1.500 1.500 0 0 1 21 9.700v7.800a1.500 1.500 0 0 1-1.500 1.500h-15A1.500 1.500 0 0 1 3 17.500z"/>',
  doc: '<path d="M7 3h7l4 4v12.500A1.500 1.500 0 0 1 16.500 21h-9A1.500 1.500 0 0 1 6 19.500v-15A1.500 1.500 0 0 1 7.500 3z"/><path d="M14 3v4h4M9 12h6M9 16h4"/>',
  clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
  shield: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  desktop: '<rect x="3" y="4.500" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.500V20"/>',
  person: '<circle cx="12" cy="8.500" r="3.500"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  people: '<circle cx="9" cy="9" r="3.500"/><path d="M2.500 19.500a6.500 6.500 0 0 1 13 0M16 5.700a3.500 3.500 0 0 1 0 6.600M18.500 15a6.500 6.500 0 0 1 3 4.500"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800"/>',
  bell: '<path d="M6 16.500V11a6 6 0 0 1 12 0v5.500l1.500 2h-15zM10 20.500a2 2 0 0 0 4 0"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  share: '<path d="M12 15V3.500M8 7l4-4 4 4M6 11H5.500A1.500 1.500 0 0 0 4 12.500v6A1.500 1.500 0 0 0 5.500 20h13a1.500 1.500 0 0 0 1.500-1.500v-6a1.500 1.500 0 0 0-1.500-1.500H18"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2.500"/><circle cx="8.500" cy="10" r="1.500"/><path d="m4 17 5-4.500 3.500 3 3-2.500L21 17"/>',
  camera: '<path d="M4 8.500A1.500 1.500 0 0 1 5.500 7h2l1.500-2h6l1.500 2h2A1.500 1.500 0 0 1 20 8.500v9a1.500 1.500 0 0 1-1.500 1.500h-13A1.500 1.500 0 0 1 4 17.500z"/><circle cx="12" cy="13" r="3.500"/>',
  trash: '<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l.800 12.500h9.400L17.500 7M10 11v5M14 11v5"/>',
  pause: '<path d="M8.500 6v12M15.500 6v12" stroke-width="2.600"/>',
  play: '<path d="M8 5.500v13l10.500-6.500z" fill="currentColor"/>',
  gift: '<rect x="4" y="10" width="16" height="10" rx="1.500"/><path d="M3 7h18v3H3zM12 7v13M12 7c-1.500-4-6-3.500-5-1 .600 1.300 3 1 5 1zm0 0c1.500-4 6-3.500 5-1-.600 1.300-3 1-5 1z"/>',
  hanger: '<path d="M12 8.500c0-1.500 2-1.700 2-3.500a2 2 0 0 0-4 0M12 8.500l8.500 6.300c1 .800.500 2.200-.700 2.200H4.200c-1.200 0-1.700-1.400-.700-2.200z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>',
  globe: '<circle cx="12" cy="12" r="8.500"/><path d="M3.500 12h17M12 3.500c3 3 3 14 0 17M12 3.500c-3 3-3 14 0 17"/>',
  pencil: '<path d="m5 19 .800-3.800L16.500 4.500l3 3L8.800 18.200z"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.500-5.800M4 4.500v4h4M12 8v4.500l3 1.500"/>',
  eye: '<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z"/><circle cx="12" cy="12" r="2.800"/>',
  term: '<rect x="3" y="4.500" width="18" height="15" rx="2.500"/><path d="m7 9.500 3 2.500-3 2.500M12.500 15h4"/>',
  clip: '<path d="m20 11-8.500 8.500a5 5 0 0 1-7-7L13 4a3.300 3.300 0 0 1 4.700 4.700l-8.500 8.500a1.700 1.700 0 0 1-2.400-2.400L14.500 7"/>',
  note: '<path d="M5 4.500h14v10l-5 5H5zM14 19.500v-5h5M8.500 9h7M8.500 12.500h4"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" stroke-width="2.400"/>',
  refresh: '<path d="M19.500 12a7.500 7.500 0 1 1-2.300-5.400M19.500 4v4h-4"/>',
  hash: '<path d="M9 3.500 7.500 20.500M16.500 3.500 15 20.500M4 9h16.500M3.500 15H20"/>',
  wave: '<path d="M4 10v4M8 6.500v11M12 3.500v17M16 7.500v9M20 10.500v3" stroke-width="2"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1.500 5.500A3.200 3.200 0 0 0 7 17a3 3 0 0 0 5 1.500V5.500A2.500 2.500 0 0 0 9 4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 1.500 5.500A3.200 3.200 0 0 1 17 17a3 3 0 0 1-5 1.500"/>',
  cpu: '<rect x="6.500" y="6.500" width="11" height="11" rx="2"/><path d="M10 3.500v3M14 3.500v3M10 17.500v3M14 17.500v3M3.500 10h3M3.500 14h3M17.500 10h3M17.500 14h3"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2.500v2.500H14zM18 18h2v2h-2zM18 14h2M14 19h1.500"/>',
  heart: '<path d="M12 20s-7.500-4.600-7.500-10A4.200 4.200 0 0 1 12 7.500 4.200 4.200 0 0 1 19.500 10c0 5.400-7.500 10-7.500 10z"/>',
  moon: '<path d="M20 14.500A8.500 8.500 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.500"/><path d="m3.500 7.500 8.500 6 8.500-6"/>',
  list: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  arrowUR: '<path d="M8 16 16.500 7.500M9.500 7.500h7v7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.500"/><path d="M16 8V6.500A2.500 2.500 0 0 0 13.500 4h-7A2.500 2.500 0 0 0 4 6.500v7A2.500 2.500 0 0 0 6.500 16H8"/>',
  download: '<path d="M12 4v11M7.500 10.500 12 15l4.500-4.500M5 19.500h14"/>',
  spark: '<path d="M12 3.500 13.800 10l6.700 2-6.700 2L12 20.500 10.200 14l-6.700-2 6.700-2z"/>',
  pointer: '<path d="M6 3.500 18.500 13l-5.600.600L10 19z" fill="currentColor"/>',
}
export const ic = (n, s = 22, w = 1.8) =>
  `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`

export const GH =
  '<svg class="ic" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 .2a8 8 0 0 0-2.500 15.600c.400.100.500-.200.500-.400v-1.400c-2.200.500-2.700-1-2.700-1-.400-.900-.900-1.200-.900-1.200-.700-.500.100-.500.100-.500.800.100 1.200.800 1.200.800.700 1.200 1.900.900 2.300.700.100-.500.300-.900.500-1.100-1.800-.200-3.600-.900-3.600-4 0-.900.300-1.600.800-2.100-.100-.200-.400-1 .100-2.100 0 0 .700-.200 2.200.800a7.500 7.500 0 0 1 4 0c1.500-1 2.200-.800 2.200-.800.400 1.100.200 1.900.100 2.100.500.600.800 1.300.800 2.100 0 3.100-1.900 3.700-3.700 3.900.300.300.600.800.600 1.500v2.200c0 .200.100.500.600.400A8 8 0 0 0 8 .2z"/></svg>'
export const GOOGLE =
  '<svg class="ic" width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22 12.200c0-.700-.100-1.400-.200-2H12v3.900h5.600a4.800 4.800 0 0 1-2.100 3.100v2.600h3.400c2-1.800 3.100-4.500 3.100-7.600z"/><path fill="#34A853" d="M12 22.500c2.800 0 5.200-.900 6.900-2.500l-3.400-2.600c-.900.600-2.100 1-3.500 1-2.700 0-5-1.800-5.800-4.300H2.700v2.700A10.500 10.500 0 0 0 12 22.500z"/><path fill="#FBBC05" d="M6.200 14.100a6.300 6.300 0 0 1 0-4V7.400H2.700a10.500 10.500 0 0 0 0 9.400z"/><path fill="#EA4335" d="M12 5.700c1.500 0 2.900.500 4 1.500l3-3A10.500 10.500 0 0 0 2.700 7.400l3.500 2.700C7 7.500 9.300 5.700 12 5.700z"/></svg>'

/**
 * A creature's picture, drawn by the app's own code and kept as a still. Each picture is in the
 * page once, as a rule of the stylesheet (see `creatureRules`), however often it is shown.
 */
export const cre = (key, size, style = "") =>
  `<span class="cre c-${key}" style="width:${size}px;height:${size}px;${style}"></span>`
export const creatureRules = (page) =>
  Object.entries(C)
    .filter(([key]) => page.includes(`c-${key}"`))
    .map(([key, url]) => `.c-${key}{background-image:url(${url})}`)
    .join("\n")
/** A picture file as an address the page carries in itself, so the page is one file. */
export function picture(path) {
  if (!existsSync(path)) return path
  const kind = path.endsWith(".png") ? "png" : "jpeg"
  return `data:image/${kind};base64,${readFileSync(path).toString("base64")}`
}
export const face = (ini, color, size = 28) =>
  `<span class="face" style="width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size * 0.4)}px">${ini}</span>`
export const PEOPLE = { me: ["SH", "#127a78"], maya: ["MO", "#c0607a"], jon: ["JR", "#c9952c"], priya: ["PN", "#7d5a9a"] }
export const who = (id, size) => face(PEOPLE[id][0], PEOPLE[id][1], size)

const STATUS = `<i><svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx=".8"/><rect x="5" y="5.500" width="3" height="6.500" rx=".8"/><rect x="10" y="3" width="3" height="9" rx=".8"/><rect x="15" y="0" width="3" height="12" rx=".8"/></svg><svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="currentColor" stroke-width="1.900" stroke-linecap="round"><path d="M1.500 4.300a10 10 0 0 1 14 0M4 7a6.400 6.400 0 0 1 9 0"/><circle cx="8.500" cy="10" r="1.200" fill="currentColor" stroke="none"/></svg><svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x=".500" y=".500" width="23" height="12" rx="3.800" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.500" fill="currentColor"/><path d="M25 4.500v4c.800-.300 1.500-1 1.500-2s-.700-1.700-1.500-2z" fill="currentColor" opacity=".45"/></svg></i>`

/**
 * A phone with one screen in it. `page` is a white page (a chat, a document); without it the
 * screen is the grey a list of grouped rows sits on. `white` draws the clock for a dark picture,
 * and `keep` leaves the phone as it is when the page's theme is switched. A chat takes its
 * accent from its agent, as the web app's pages do: every chat here is Juniper's, whose amber is
 * the phone's own `--a`.
 */
export const phone = (inner, o = {}) =>
  `<div class="ph${o.dark ? " dark" : ""}${o.keep ? " keep" : ""}"><div class="scr${o.page ? " page" : ""}">` +
  `<div class="island"></div><div class="sb${o.white ? " w" : ""}"><span>9:41</span>${STATUS}</div>` +
  inner +
  `<div class="home${o.white ? " w" : ""}"></div></div></div>`

/** A round glass button, or several in one capsule. */
export const gb = (inner, cls = "") => `<span class="gb g ${cls}">${inner}</span>`
export const back = () => gb(ic("chevL", 22, 2.200))
export const nav = (left = "", mid = "", right = "") =>
  `<div class="nav"><span>${left}</span>${mid ? `<span class="mid">${mid}</span>` : ""}<span style="display:flex;gap:8px">${right}</span></div>`

/** One row of a grouped list. */
export function row(o) {
  const icon = o.sq ? `<span class="sq" style="background:${o.sq[1]}">${ic(o.sq[0], 19, 1.900)}</span>` : (o.lead ?? "")
  const cls = ["row", icon ? "i" : "", o.cls ?? ""].join(" ")
  const title = `<b${o.bold ? ' class="w"' : ""}>${o.t}</b>${o.s ? `<span>${o.s}</span>` : ""}`
  const tail =
    (o.v ? `<span class="v">${o.v}</span>` : "") +
    (o.sw !== undefined ? `<span class="sw${o.sw ? " on" : ""}"></span>` : "") +
    (o.tail ?? "") +
    (o.go ? `<span class="ch">${ic("chevR", 16, 2.400)}</span>` : "")
  return `<div class="${cls}">${icon}<div class="t">${title}</div>${tail}</div>`
}
export const sect = (head, rows, foot, cls = "") =>
  `<div class="sect">${head ? `<h5 class="${cls}">${head}</h5>` : ""}<div class="grp">${rows.join("")}</div>${foot ? `<small>${foot}</small>` : ""}</div>`
export const seg = (items, on) =>
  `<div class="seg">${items.map((x, i) => `<span${i === on ? ' class="on"' : ""}>${x}</span>`).join("")}</div>`
export const menu = (items, style) =>
  `<div class="menu g" style="${style}">${items
    .map((m) =>
      m === "-" ? "<hr>" : typeof m === "string" ? `<h6>${m}</h6>` : `<div class="mi${m[2] ? " " + m[2] : ""}"><span>${m[0]}</span>${m[1] ? ic(m[1], 20) : ""}</div>`,
    )
    .join("")}</div>`

/** The box a message is written in, with the keyboard down. */
export function composer(o = {}) {
  const text = o.text ? `<div class="ph-t has">${o.text}</div>` : `<div class="ph-t">${o.hint ?? "Message Juniper"}</div>`
  const end = o.busy
    ? `<span class="b stop">${ic("stop", 20)}</span>`
    : o.text
      ? `<span class="b send">${ic("up", 19, 2.400)}</span>`
      : `<span class="b">${ic("mic", 22)}</span>`
  return `<div class="comp" style="${o.style ?? ""}"><span class="plus g">${ic("plus", 22, 2)}</span><div class="box g">${text}${end}</div></div>`
}
export const keyboard = () => {
  const keys = (s) => [...s].map((k) => `<span>${k}</span>`).join("")
  return `<div class="kb"><div>${keys("qwertyuiop")}</div><div>${keys("asdfghjkl")}</div><div><span class="w">⇧</span>${keys("zxcvbnm")}<span class="w">⌫</span></div><div><span class="x">123</span><span class="sp">space</span><span class="x">return</span></div></div>`
}
