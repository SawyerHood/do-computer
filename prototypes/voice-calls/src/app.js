// The voice calls mock-up. Every scene is drawn from the one call below (K), so a call started in
// one layout carries on in the others. Nothing here makes a sound or listens: the call is a script.
const C = window.CREATURES
const ST = window.STILLS
const W = 1200
const H = 770

const I = {
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  micoff: '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',
  cc: '<rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>',
  min: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
  max: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  left: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  right: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  updown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  board: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  chats: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>',
}
// Hanging up is the same handset, laid down.
I.hang = `<g transform="rotate(135 12 12)">${I.phone}</g>`
const ic = (name, size = 16, cls = "") =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`

const D = {
  juniper: { name: "Juniper", color: "#2f8f8a", seed: "Tarn", still: "scout", line: "Ticked it off, and the test starts today.", time: "2m" },
  moss: { name: "Moss", color: "#5f8a4e", seed: "Moss", still: "moss", line: "Deploy 412 is green.", time: "14m" },
  pixel: { name: "Pixel", color: "#d9962b", seed: "Juniper", still: "juniperBare", line: "Left three notes on the checkout page.", time: "1h" },
  otto: { name: "Otto", color: "#3f8fc9", seed: "Otto", still: "otto", line: "Two things need an answer today.", time: "3h" },
}

// The call, as a script: what is said, and what Juniper does while it is on the line.
const SCRIPT = [
  { you: "Hey Juniper, how did the pricing test do overnight?" },
  { say: "Morning! One second, I'll pull the numbers.", gap: 200 },
  { work: "Reading 14 days of analytics", done: "Read 14 days of analytics", kind: "search", take: 3000 },
  { say: "Sign-ups are at 3.9 percent, up from 3.4, and the one-row layout is ahead by about eleven percent. Want me to end the test early?", gap: 900 },
  { you: "Not yet. Give it till Friday, and put that on the board." },
  { say: "Will do.", gap: 200 },
  { work: "Updating Launch board", done: "Put Friday on the Launch board", kind: "file", take: 2200 },
  { say: "Done. Friday is on the board, and I'll message you if it flips before then." },
]
const lineOf = (s) => (s.work ? { work: s.done, kind: s.kind, done: true } : { who: s.you ? "you" : "dood", text: s.you ?? s.say })

const fresh = () => ({ on: false, phase: "idle", variant: "search", sec: 0, lines: [], muted: false, cc: true })
// A call caught part of the way through, for the scenes that are opened without playing one.
const snapshot = () => ({
  ...fresh(),
  on: true,
  phase: "speaking",
  sec: 41,
  lines: [...SCRIPT.slice(0, 3).map(lineOf), { who: "dood", text: "Sign-ups are at 3.9 percent, up from 3.4, and the one-row layout is ahead by about eleven", now: true }],
})
let K = fresh()
// The last call, once it is over.
let R = { sec: 52, lines: SCRIPT.map(lineOf), open: false }
let asked = false
let voice = 6

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
const long = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`)
const last = (who) => {
  for (let i = K.lines.length - 1; i >= 0; i--) if (K.lines[i].who === who) return K.lines[i].text
  return null
}
const lastYou = () => last("you") ?? ""
const lastSay = () =>
  last("dood") ?? (K.phase === "asking" ? "Waiting for your microphone." : K.phase === "connecting" ? "Calling Juniper…" : "Go ahead. Juniper is listening.")
const ringing = () => K.phase === "asking" || K.phase === "connecting"
const ph = () => (!K.on ? "idle" : K.muted && K.phase === "hearing" ? "listening" : K.phase)
function phaseText() {
  if (K.phase === "asking") return "Needs your microphone"
  if (K.phase === "connecting") return "Connecting…"
  if (K.phase === "speaking") return "Talking"
  if (K.phase === "working") return `${K.lines.findLast((l) => l.work)?.work ?? "Working on it"}…`
  return K.muted ? "You're muted" : "Listening"
}

function side({ open = "juniper" } = {}) {
  const rows = Object.entries(D)
    .map(([key, d]) => {
      const live = key === "juniper" && K.on
      return `<a class="row${key === open ? " sel" : ""}" data-go="${key === "juniper" ? (K.on ? "a" : "start") : key === "otto" && K.on ? "away" : ""}"><img class="cr" src="${C[d.still]}" alt=""><div class="rt"><div class="nm"><span>${d.name}</span><time>${
        live ? "" : d.time
      }</time></div><div class="ln${live ? " live" : ""}">${
        live ? `<span class="wave"><i></i><i></i><i></i><i></i></span>${ringing() ? "Calling…" : `On a call · <span data-b="time">${fmt(K.sec)}</span>`}` : key === "juniper" && cur === "after" ? "Put Friday on the Launch board." : d.line
      }</div></div></a>`
    })
    .join("")
  return `<div class="side"><div class="shead"><span class="av">SA</span><b>Personal</b>${ic("updown", 14, "muted")}<button class="ib">${ic("left", 17)}</button></div>
    <div class="slbl"><span>Doods</span>${ic("plus", 17)}</div>${rows}
    <div class="sfoot"><span class="av">SA</span>Sawyer${ic("updown", 14)}</div></div>`
}

function strip({ who = "juniper" } = {}) {
  const live = who === "juniper" && K.on
  return `<div class="strip"><div class="who"><img src="${C[D[who].still]}" alt="">${D[who].name}${ic("down", 15)}</div>
    <div class="tabs"><a class="tab on">Chat</a><a class="tab">Library</a><a class="tab">Automations</a></div>
    <div class="sr"><span class="sc">${ic("chats", 16)}Side chats<span class="n">1</span></span><button class="ib${live ? " live" : ""}" data-act="${live ? "" : "call"}" title="${
      live ? "On a call" : `Call ${D[who].name}`
    }">${ic("phone", 16)}</button><button class="ib" data-go="voice" title="Settings">${ic("sliders", 16)}</button><button class="ib">${ic("right", 17)}</button></div></div>`
}

const composer = (who, { call = false, pic = false } = {}) =>
  `<div class="comp">${pic ? '<div class="pic"><span></span></div>' : ""}<div class="ph">${
    call ? (pic ? "This is the old page, for comparison" : `Type to ${D[who].name} while you talk: a link, a picture…`) : `Message ${D[who].name}`
  }</div><div class="cb">${ic("clip", 18)}<span class="sp"></span>${call ? "" : ic("mic", 18)}<span class="send">${ic("up", 17)}</span></div></div>`

const before = [
  `<div class="me">Can you keep a board for the pricing relaunch and pin it, so I can keep an eye on it?</div>`,
  `<div class="ai">Done. The board is a page in the library, <code>boards/relaunch.html</code>. I bring the numbers up to date every morning and tick steps off as they land.</div>`,
  `<div class="me">The one-row layout shipped this morning, by the way.</div>`,
  `<div class="ai">Ticked it off, and the two-week test starts today.</div>`,
]

const workChip = (l) =>
  `<div class="cw${l.done ? "" : " run"}">${l.done ? ic("check", 13) : '<span class="spin"></span>'}<span>${l.work}${l.done ? "" : "…"}</span></div>`
const said = (lines, live) =>
  lines
    .map((l, i) =>
      l.work
        ? workChip(l)
        : `<div class="cl${l.who === "you" ? " you" : ""}${l.now ? " now" : ""}"><i>${l.who === "you" ? "You" : "Juniper"}</i><span${live ? ` data-line="${i}"` : ""}>${l.text}</span></div>`,
    )
    .join("")

// The call as the chat holds it while it lasts.
function callCard() {
  return `<div class="callc live"><div class="cch"><span class="cdot"></span><b>${ringing() ? "Calling Juniper…" : "On a call with Juniper"}</b>${ringing() ? "" : `<span class="ct" data-b="time">${fmt(K.sec)}</span>`}</div>${
    K.lines.length ? `<div class="ccl">${said(K.lines, true)}</div>` : ""
  }</div>`
}

// And once it is over: what came of it, with the words folded inside.
function receipt() {
  const has = (text) => R.lines.some((l) => (l.text ?? l.work ?? "").startsWith(text))
  const came = [
    has("Sign-ups are at") && "Sign-ups are at 3.9%, up from 3.4%. The one-row layout is ahead by about 11%.",
    has("Not yet") && "You decided to let the test run until Friday.",
    has("Put Friday") && "Juniper put Friday on the Launch board.",
  ].filter(Boolean)
  const done = R.lines.filter((l) => l.work && l.done).length
  return `<div class="callc"><div class="cch">${ic("phone", 15)}<b>Call with Juniper</b><span class="ct">${long(R.sec)} · 9:41</span></div>
    <ul class="ccs">${(came.length ? came : ["Nothing was decided on this call."]).map((t) => `<li>${t}</li>`).join("")}</ul>
    ${R.open ? `<div class="ccl">${said(R.lines, false)}</div>` : ""}
    <div class="ccf"><button class="btn" data-act="said">${R.open ? "Hide" : "Show"} what was said</button><span class="sp"></span><span>${
      done ? `${done} thing${done > 1 ? "s" : ""} done` : ""
    }</span><button class="btn" data-act="call">${ic("phone", 13)}Call again</button></div></div>`
}

function chat({ who = "juniper", msgs, call = false, over = "" }) {
  return `<div class="chat"><div class="msgs">${msgs.join("")}</div>${composer(who, { call })}${over}</div>`
}

const orbSlot = (key, who, size, { state = "", dark = false } = {}) =>
  `<span class="orb" data-orb="${key}" data-who="${who}" data-size="${size}"${state ? ` data-state="${state}"` : ""}${dark ? ' data-dark="1"' : ""} style="width:${size}px;height:${size}px"></span>`
const face = (key, who, size, opts) => `<div class="cface"><span class="glow"></span><span class="rings"><i></i><i></i><i></i></span>${orbSlot(key, who, size, opts)}</div>`

const controls = ({ speaker = false } = {}) =>
  `<div class="ctl">${
    speaker ? `<button class="cbt on"><span>${ic("volume", 22)}</span>Speaker</button>` : `<button class="cbt${K.muted ? " on" : ""}" data-act="mute"><span>${ic(K.muted ? "micoff" : "mic", 20)}</span>${K.muted ? "Unmute" : "Mute"}</button>`
  }<button class="cbt end" data-act="end"><span>${ic("hang", speaker ? 26 : 23)}</span>End</button>${
    speaker
      ? `<button class="cbt${K.muted ? " on" : ""}" data-act="mute"><span>${ic(K.muted ? "micoff" : "mic", 22)}</span>${K.muted ? "Unmute" : "Mute"}</button>`
      : `<button class="cbt" data-act="cc"><span>${ic("cc", 20)}</span>${K.cc ? "Hide words" : "Show words"}</button>`
  }</div>`

// The panel as it is when nobody is on a call, with the one new thing: a way to call.
function aside({ who = "juniper", hot = false, did, busy = false } = {}) {
  const list =
    did ??
    (who === "juniper"
      ? [["Made the launch board", "9:12"], ["Pinned it", "9:12"], ["Ticked off the one-row layout", "2 min ago"]]
      : null)
  return `<aside class="aside"><div class="face"><button class="ib">${ic("refresh", 15)}</button>${orbSlot(`${who}-face`, who, 172, busy ? {} : { state: "idle" })}
    <div class="an">${D[who].name}</div>${
      busy
        ? `<div class="as live"><span class="cdot"></span>On a call · <span data-b="time">${fmt(K.sec)}</span></div>`
        : `<div class="as">Ready</div><button class="callb${hot ? " hot" : ""}" data-act="${who === "juniper" ? "call" : ""}">${ic("phone", 16)}Call${hot ? '<span class="tip">Talk to Juniper out loud</span>' : ""}</button>`
    }</div>
    ${who === "juniper" ? `<div class="sec"><div class="lbl">Pinned</div><div class="prow">${ic("board", 15)}<span class="tt">Launch board</span><span class="tm">${did ? "now" : "2m"}</span>${ic("next", 14)}</div></div>` : ""}
    <div class="sec grow"><div class="lbl">What it did here</div>${
      list ? `<ul>${list.map(([t, when]) => `<li>${t}<time>${when}</time></li>`).join("")}</ul>` : `<p>Nothing yet. When ${D[who].name} gets something substantial done in this chat, it notes it here.</p>`
    }</div></aside>`
}

// A: the panel is the call.
function asideCall() {
  const works = K.lines.filter((l) => l.work)
  return `<aside class="aside oncall">
    <div class="cbar"><span class="cdot"></span><span>${ringing() ? "Calling" : "On a call"}</span>${ringing() ? "" : `<span class="ct" data-b="time">${fmt(K.sec)}</span>`}<span class="sp"></span>
      <button class="ib" data-go="b" title="Shrink to a card">${ic("min", 15)}</button><button class="ib" data-go="c" title="Fill the window">${ic("max", 15)}</button></div>
    ${face("juniper-call", "juniper", 190)}
    <div class="an">Juniper</div><div class="as" data-b="phase">${phaseText()}</div>
    ${K.cc ? `<div class="capt"><div class="cy"><i>You</i><span data-b="you">${lastYou()}</span></div><div class="cs" data-b="say">${lastSay()}</div></div>` : ""}
    ${controls()}
    <div class="sec grow"><div class="lbl">On this call</div>${
      works.length
        ? `<ul>${works.map((l) => `<li class="${l.done ? "" : "run"}">${l.work}${l.done ? "" : "…"}<time>${l.done ? "done" : "now"}</time></li>`).join("")}</ul>`
        : "<p>What Juniper does while you talk shows here and in the chat.</p>"
    }</div></aside>`
}

// B: a small card. Also what a call shrinks to when you go somewhere else.
function card(where = "") {
  // Only one of a Dood moves on a screen at a time. Beside its own panel the card has a still.
  const small = where ? orbSlot("juniper-card", "juniper", 52, { dark: true }) : `<img data-still src="${still("juniper", orbState()[0])}" alt="">`
  return `<div class="ccard ${where}" style="--agent-color:${D.juniper.color}"><div class="top"><span class="cf">${small}</span>
    <div class="cn"><b>Juniper</b><span><span data-b="time">${fmt(K.sec)}</span> · <span data-b="phase">${phaseText()}</span></span></div>
    <button class="ib" data-go="a" title="${where ? "Back to Juniper" : "Open in the panel"}">${ic("max", 15)}</button></div>
    ${K.cc ? `<div class="cc1" data-b="say">${lastSay()}</div>` : ""}
    <div class="cbs"><button class="${K.muted ? "on" : ""}" data-act="mute" title="Mute">${ic(K.muted ? "micoff" : "mic", 17)}</button><button class="end" data-act="end" title="End the call">${ic("hang", 20)}</button></div></div>`
}

// C: the call takes the sheet.
function stageCall() {
  const works = K.lines.filter((l) => l.work).slice(-2)
  return `<div class="cstage">
    <div class="cbar"><span class="cdot"></span><span>${ringing() ? "Calling" : "On a call"}</span>${ringing() ? "" : `<span data-b="time">${fmt(K.sec)}</span>`}<span class="sp"></span>
      <button class="pill" data-go="a">${ic("chats", 14)}Show the chat</button><button class="ib" data-go="b" title="Shrink to a card">${ic("min", 16)}</button></div>
    ${face("juniper-stage", "juniper", 280, { dark: true })}
    <div class="an">Juniper</div><div class="as" data-b="phase">${phaseText()}</div>
    ${K.cc ? `<div class="scap"><div class="cy"><i>You</i><span data-b="you">${lastYou()}</span></div><div class="cs" data-b="say">${lastSay()}</div></div>` : ""}
    <div class="work">${works.map(workChip).join("")}</div>
    ${controls()}</div>`
}

const perm = () =>
  K.phase === "asking"
    ? `<div class="perm"><b>do.computer wants to</b><div>${ic("mic", 17)}Use your microphone</div><p><button data-act="block">Block</button><button class="ok" data-act="allow">Allow</button></p></div>`
    : ""

const VOICES = [
  ["Quartz", "Clear and even"],
  ["Ripple", "Bright, quick"],
  ["Vesper", "Low and calm"],
  ["Willow", "Soft, unhurried"],
  ["Stone", "Deep, dry"],
  ["Gleam", "Light, playful"],
  ["Meridian", "Warm, steady"],
  ["Cinder", "Husky, wry"],
]
function voiceModal() {
  return `<div class="scrim"><div class="modal"><div class="mnav"><div class="back" data-go="start">${ic("back", 15)}Settings</div><div class="mw"><img src="${C.scout}" alt="">Juniper</div>
    <a>Name and look</a><a>Model</a><a class="on">Voice</a><a>Instructions</a><a>Computers</a><a>Connectors</a><a>Slack</a></div>
    <div class="mmain"><h2>Voice</h2><p>How Juniper sounds on a call. A Dood hatches with a voice of its own, so two of them never sound like the same person. Press one to hear it.</p>
    <div class="voices">${VOICES.map(
      ([name, what], i) =>
        `<button class="voice${i === voice ? " on" : ""}" data-voice="${i}"><span class="pl">${ic("play", 12)}</span><span><b>${name}</b><small>${what}${i === 6 ? " · its first voice" : ""}</small></span>${
          i === voice ? ic("check", 16, "ck") : ""
        }</button>`,
    ).join("")}</div>
    <div class="srow"><div>Show the words<small>What is said appears under Juniper as it is said</small></div><span class="tg on"></span></div>
    <div class="srow"><div>Keep what was said<small>After a call the chat keeps a short record, with the words folded inside</small></div><span class="tg on"></span></div>
    <div class="srow"><div>Calls this month<small>38 of 300 minutes, across all your Doods</small></div><span class="muted">$1.90</span></div></div></div></div>`
}

const app = (who, inside, sidebar, over = "") =>
  `<div class="app t" data-phase="${ph()}" style="--agent-color:${D[who].color}">${sidebar}<div class="sheet">${inside}</div>${over}</div>`

const scenes = {
  start: () => app("juniper", `${strip()}<div class="body">${chat({ msgs: before })}${aside({ hot: true })}</div>`, side()),
  a: () => app("juniper", `${strip()}<div class="body">${chat({ msgs: [...before.slice(-2), callCard()], call: true })}${asideCall()}</div>`, side(), perm()),
  b: () =>
    app(
      "juniper",
      `${strip()}<div class="body">${chat({ msgs: [...before.slice(-2), callCard()], call: true, over: card() })}${aside({
        busy: true,
        did: [["Made the launch board", "9:12"], ["Pinned it", "9:12"], ...K.lines.filter((l) => l.work && l.done).map((l) => [l.work, "on the call"])],
      })}</div>`,
      side(),
    ),
  c: () => app("juniper", `${strip()}${stageCall()}`, side()),
  away: () =>
    app(
      "otto",
      `${strip({ who: "otto" })}<div class="body">${chat({
        who: "otto",
        msgs: [
          `<div class="me">What needs me today?</div>`,
          `<div class="ai">Two things. Dana wants an answer on the Thursday offsite by noon, and the invoice from Northwind is due tomorrow. Everything else can wait until Monday.</div>`,
        ],
      })}${aside({ who: "otto" })}</div>`,
      side({ open: "otto" }),
      card("br"),
    ),
  after: () =>
    app(
      "juniper",
      `${strip()}<div class="body">${chat({ msgs: [...before.slice(-2), receipt()] })}${aside({
        did: [
          ["Ticked off the one-row layout", "9:39"],
          ...R.lines.filter((l) => l.work && l.done).map((l) => [l.work, "on a call"]),
        ],
      })}</div>`,
      side(),
    ),
  voice: () => app("juniper", `${strip()}<div class="body">${chat({ msgs: before })}${aside()}</div>`, side(), voiceModal()),
  phone: () => {
    const bar = (white) => `<div class="pst"${white ? ' style="color:#fff"' : ""}><span>9:41</span><span>5G ▮</span></div>`
    return `<div class="phones t" data-phase="${ph()}" style="--agent-color:${D.juniper.color}">
      <div><div class="phone">${bar(true)}<div class="pcall"><div class="ptop"><button class="ib" title="Back to the chat">${ic("down", 18)}</button><button class="ib" title="Type">${ic("chats", 16)}</button></div>
        ${face("juniper-p1", "juniper", 200, { dark: true })}<div class="an">Juniper</div><div class="as"><span data-b="time">${fmt(K.sec)}</span>&nbsp;·&nbsp;<span data-b="phase">${phaseText()}</span></div>
        <div class="scap"><div class="cy"><i>You</i><span data-b="you">${lastYou()}</span></div><div class="cs" data-b="say">${lastSay()}</div></div>
        ${controls({ speaker: true })}</div></div><div class="plabel"><b>The call fills the screen</b>its face, its words and three buttons</div></div>
      <div><div class="phone">${bar()}<span class="isl"><img src="${C.scout}" alt=""><span data-b="time">${fmt(K.sec)}</span></span>
        <div class="pnav">${ic("back", 22)}<img src="${C.scout}" alt="">Juniper<span class="sp"></span>${ic("more", 20, "muted")}</div>
        <div class="pbar"><span class="wave"><i></i><i></i><i></i><i></i></span><b>On a call</b><span data-b="time">${fmt(K.sec)}</span><span class="sp"></span><button data-act="mute">${ic(K.muted ? "micoff" : "mic", 16)}</button><button class="end" data-act="end">${ic("hang", 18)}</button></div>
        <div class="msgs">${callCard()}</div>${composer("juniper", { call: true, pic: true })}</div><div class="plabel"><b>Swipe it down to type</b>the call rides above the chat, and in the island outside the app</div></div>
      <div><div class="phone">${bar(true)}<div class="pcall"><span class="later">Later</span><div class="ptop"></div>
        ${face("juniper-p3", "juniper", 200, { dark: true, state: "waiting" })}<div class="an">Juniper</div><div class="as">is calling you</div>
        <div class="why">“The test flipped overnight. B is ahead now. Got a minute?”</div>
        <div class="ctl"><button class="cbt end"><span>${ic("hang", 26)}</span>Not now</button><button class="cbt ans"><span>${ic("phone", 24)}</span>Answer</button></div></div></div><div class="plabel"><b>Later: your Dood calls you</b>when something needs you. Dots cannot yet</div></div>
    </div>`
  },
}
const CALL = new Set(["a", "b", "c", "away", "phone"])

const caps = {
  start:
    "<b>Calling.</b> A Call button sits under the Dood's name in its panel, and a phone in the strip above the chat for when the panel is shut. Press Call. The first time, the browser asks for the microphone; after that it rings straight through.",
  a: "<b>A · In its panel.</b> The panel is already the Dood's face, so the call happens there: it looks at you, its mouth moves with its voice, and the rings show who is talking. The words sit under it. The chat stays yours to type and paste into, and holds the call as one live card: what was said, and what Juniper did while you talked. Press <b>▶ Play the call</b> to watch one from the start. There is no sound; this is a drawing.",
  b: "<b>B · A small card.</b> How Dots does it: the panel stays as it is, and the call is a card over the chat with a timer, mute and hang up. It takes less room, and the creature is a thumbnail.",
  c: "<b>C · The whole window.</b> The chat steps aside and the call takes the sheet, for when you only want to talk. What Juniper is doing shows in the corner. “Show the chat” goes back to A.",
  away: "<b>Somewhere else.</b> A call is not tied to the page it started on. Open another Dood, the library or the settings and it shrinks to a card in the corner, and Juniper's row says it is on a call. People asked OpenAI for exactly this in Dots' first week.",
  after:
    "<b>Afterwards.</b> Hanging up ends the talking, not the work. The chat keeps one record of the call: how long it was, what was decided and what got done, with the words folded inside. Juniper remembers it like anything else said in this chat.",
  phone:
    "<b>On a phone.</b> The call fills the screen, as a phone call does. Swiped down, it rides above the chat so a picture can be pasted while you talk. The third screen is for later: Juniper calling you when something needs a decision.",
  voice:
    "<b>Its voice.</b> Each Dood gets a voice of its own when it hatches, and it can be changed here. In OpenAI's forum the most-read request about calls is that a dot sounds the same as ChatGPT does. The names and the price are pretend.",
}

const nav = [
  ["", [["start", "Calling"]]],
  ["On a call", [["a", "A · In its panel"], ["b", "B · A small card"], ["c", "C · The whole window"]]],
  ["Also", [["away", "Somewhere else"], ["after", "Afterwards"], ["phone", "Phone"], ["voice", "Its voice"]]],
]

let cur = "start"
let real = false
const stage = document.getElementById("stage")
const fitBox = document.getElementById("fit")

// --- The creature, drawn live by the app's own code where the page can; a still where it cannot.
let core = null
try {
  if (window.THREE && window.AgentOrbCore && document.createElement("canvas").getContext("webgl")) core = window.AgentOrbCore(window.THREE)
} catch {
  core = null
}
const orbs = new Map()
function orbState() {
  if (!K.on) return ["idle"]
  if (K.phase === "speaking") return ["speaking"]
  if (K.phase === "working") return ["working", K.variant]
  if (K.phase === "hearing" && !K.muted) return ["listening"]
  if (K.phase === "connecting" || K.phase === "asking") return ["thinking"]
  return ["idle"]
}
const still = (who, state) => (who === "juniper" ? (ST[state] ?? ST.idle) : C[D[who].still])
function mountOrbs() {
  const seen = new Set()
  for (const slot of stage.querySelectorAll("[data-orb]")) {
    const key = slot.dataset.orb
    const who = slot.dataset.who
    const size = +slot.dataset.size
    const fixed = slot.dataset.state || null
    const dark = !!slot.dataset.dark || stage.classList.contains("dk")
    seen.add(key)
    if (!core) {
      slot.innerHTML = `<img class="under" src="${still(who, fixed ?? orbState()[0])}" alt="">`
      continue
    }
    // A still stands in the slot until the live one has a picture, so it is never empty.
    slot.innerHTML = `<img class="under" src="${still(who, fixed ?? orbState()[0])}" alt="">`
    let o = orbs.get(key)
    if (!o) {
      const canvas = document.createElement("canvas")
      canvas.style.cssText = `width:${size}px;height:${size}px`
      slot.appendChild(canvas)
      o = { canvas, size, who, ready: false, orb: core.createOrb(canvas, { seed: D[who].seed, color: D[who].color, size, dark }) }
      orbs.set(key, o)
    } else slot.appendChild(o.canvas)
    slot.classList.toggle("live", o.ready)
    o.fixed = fixed
    o.orb.setTheme(dark)
    o.orb.paused = false
  }
  for (const [key, o] of orbs) if (!seen.has(key)) o.orb.paused = true
  syncOrbs()
}
function syncOrbs() {
  const [state, variant] = orbState()
  for (const slot of stage.querySelectorAll("[data-orb]:not(.live)")) {
    const img = slot.firstElementChild
    const src = still(slot.dataset.who, slot.dataset.state || state)
    if (img && img.getAttribute("src") !== src) img.setAttribute("src", src)
  }
  if (!core) return
  for (const o of orbs.values()) {
    if (o.orb.paused) continue
    if (o.fixed) o.orb.setState(o.fixed)
    else if (o.who !== "juniper") o.orb.setState("idle")
    else o.orb.setState(state, variant)
  }
}
const feed = (kind) => {
  if (core) for (const o of orbs.values()) if (!o.orb.paused && !o.fixed && o.who === "juniper") kind === "you" ? o.orb.feed("key") : o.orb.feed("token", 0.55 + Math.random() * 0.45)
}
// A live one takes over from its still once the middle of its picture has something in it.
setInterval(() => {
  for (const o of orbs.values()) {
    if (o.ready || o.orb.paused) continue
    try {
      const c = o.canvas
      if (c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] > 0) {
        o.ready = true
        c.parentElement?.classList.add("live")
      }
    } catch {
      // No picture to read: the still stays.
    }
  }
}, 150)

function fit() {
  const room = document.getElementById("wrap").clientWidth
  const k = real ? 1 : Math.min(1, room / W)
  stage.style.transform = `scale(${k})`
  fitBox.style.height = `${H * k}px`
  fitBox.style.width = `${W * k}px`
}

// What changes many times a second (the clock, a word arriving) is written into the page as it
// stands; only a new line or a new scene draws it again.
function paint() {
  const root = stage.firstElementChild
  if (root) root.dataset.phase = ph()
  for (const el of stage.querySelectorAll("[data-b]")) {
    const b = el.dataset.b
    const text = b === "time" ? fmt(K.sec) : b === "phase" ? phaseText() : b === "you" ? lastYou() : lastSay()
    if (el.textContent !== text) el.textContent = text
  }
  for (const el of stage.querySelectorAll("[data-line]")) {
    const line = K.lines[+el.dataset.line]
    if (line && el.textContent !== line.text) el.textContent = line.text
  }
  for (const img of stage.querySelectorAll("[data-still]")) {
    const src = still("juniper", orbState()[0])
    if (img.getAttribute("src") !== src) img.setAttribute("src", src)
  }
  syncOrbs()
}

function render() {
  stage.innerHTML = scenes[cur]()
  document.getElementById("groups").innerHTML =
    nav
      .map(
        ([label, items]) =>
          `<div class="ng">${label ? `<span>${label}</span>` : ""}${items.map(([key, text]) => `<button class="nb${cur === key ? " on" : ""}" data-go="${key}">${text}</button>`).join("")}</div>`,
      )
      .join("") +
    `<div class="ng"><button class="nb act go" data-act="play">▶ Play the call</button><button class="nb act" data-act="dark">${stage.classList.contains("dk") ? "Light" : "Dark"}</button><button class="nb act" data-act="real">${
      real ? "Fit to width" : "Full size"
    }</button></div>`
  document.getElementById("cap").innerHTML = caps[cur]
  document.getElementById("wrap").classList.toggle("real", real)
  mountOrbs()
  fit()
}

// --- Playing the call.
let run = 0
const wait = (ms) => new Promise((done) => setTimeout(done, ms))
async function speak(who, text, alive) {
  const line = { who, text: "", now: true }
  K.lines.push(line)
  K.phase = who === "you" ? "hearing" : "speaking"
  render()
  const words = text.split(" ")
  for (let i = 0; i < words.length; i++) {
    if (!alive()) return
    line.text = words.slice(0, i + 1).join(" ")
    feed(who)
    paint()
    await wait((who === "you" ? 200 : 235) + (/[,.?!]$/.test(words[i]) ? 200 : 0))
  }
  if (!alive()) return
  line.now = false
  K.phase = "listening"
  render()
}
async function play() {
  const mine = ++run
  const alive = () => mine === run
  K = { ...fresh(), on: true, phase: "connecting", muted: false }
  if (!CALL.has(cur)) cur = "a"
  render()
  await wait(1700)
  if (!alive()) return
  K.phase = "listening"
  render()
  await wait(900)
  for (const step of SCRIPT) {
    if (!alive()) return
    if (step.work) {
      const line = { work: step.work, kind: step.kind, done: false }
      K.lines.push(line)
      K.phase = "working"
      K.variant = step.kind
      render()
      await wait(step.take)
      if (!alive()) return
      line.work = step.done
      line.done = true
      K.phase = "listening"
      render()
    } else await speak(step.you ? "you" : "dood", step.you ?? step.say, alive)
    await wait(step.gap ?? 550)
  }
}
setInterval(() => {
  if (K.on && K.phase !== "asking" && K.phase !== "connecting") {
    K.sec += 1
    paint()
  }
}, 1000)

function hangUp() {
  run += 1
  if (K.on) R = { sec: Math.max(K.sec, 1), lines: K.lines.filter((l) => !l.work || l.done).map((l) => ({ ...l, now: false })), open: false }
  K = fresh()
  cur = "after"
  render()
}

function go(name) {
  if (!scenes[name]) return
  if (name === "after" && K.on) return hangUp()
  if (CALL.has(name)) {
    if (!K.on) K = snapshot()
  } else {
    run += 1
    K = fresh()
  }
  cur = name
  history.replaceState(null, "", `#${name}`)
  render()
}

document.addEventListener("click", (event) => {
  const v = event.target.closest("[data-voice]")
  if (v) {
    voice = +v.dataset.voice
    render()
    return
  }
  const act = event.target.closest("[data-act]")
  if (act && act.dataset.act) {
    const what = act.dataset.act
    if (what === "play") play()
    else if (what === "call") {
      if (asked) play()
      else {
        run += 1
        K = { ...fresh(), on: true, phase: "asking" }
        cur = "a"
        render()
      }
    } else if (what === "allow") {
      asked = true
      play()
    } else if (what === "block") go("start")
    else if (what === "end") hangUp()
    else {
      if (what === "mute") K.muted = !K.muted
      if (what === "cc") K.cc = !K.cc
      if (what === "said") R.open = !R.open
      if (what === "dark") stage.classList.toggle("dk")
      if (what === "real") real = !real
      render()
    }
    return
  }
  const to = event.target.closest("[data-go]")
  if (to && to.dataset.go) go(to.dataset.go)
})
window.addEventListener("resize", fit)
if (scenes[window.START]) cur = window.START
if (scenes[location.hash.slice(1)]) cur = location.hash.slice(1)
if (CALL.has(cur)) K = snapshot()
render()
