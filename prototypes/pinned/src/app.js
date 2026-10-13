// The pinned things mock-up: every scene is drawn from the little state below, so a change made
// in one (an update by the Dood, a step ticked, a pin taken off) shows in the others.
const C = window.CREATURES
const W = 1200
const H = 770

const I = {
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  left: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  right: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
  out: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  updown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  board: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  pip: '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  chats: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
}
const ic = (name, size = 16, cls = "") =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`

const D = {
  juniper: { name: "Juniper", color: "#2f8f8a", line: "Ticked it off, and the test starts today.", time: "2m" },
  moss: { name: "Moss", color: "#5f8a4e", line: "Deploy 412 is green.", time: "14m" },
  pixel: { name: "Pixel", color: "#d9962b", line: "Left three notes on the checkout page.", time: "1h" },
  otto: { name: "Otto", color: "#3f8fc9", line: "Two things need an answer today.", time: "3h" },
}

const S = {
  visits: 18240,
  rate: 3.4,
  clicks: 9,
  signups: [18, 22, 19, 24, 21, 20, 23, 19, 22, 25, 21, 24, 26, 23],
  steps: [
    { t: "Pull thirty days of analytics", who: "Juniper", done: true },
    { t: "Draft the new Team copy", who: "Juniper", done: true },
    { t: "Build the one-row layout", who: "You", done: true },
    { t: "Start the two-week test", who: "Juniper", done: false },
    { t: "Decide on the Team price", who: "You", done: false },
  ],
  updated: "2 min ago",
  short: "2m",
  working: false,
  flash: false,
  unseen: false,
  pinned: true,
  planPinned: false,
  runs: 0,
}

// The board Juniper keeps. One function draws it wherever it is shown, so the small one under
// the face is the real page, made smaller.
function board(narrow) {
  const f = S.flash ? " flash" : ""
  const max = Math.max(...S.signups)
  const min = Math.min(...S.signups) - 4
  const pts = S.signups.map((v, i) => [(i * 240) / (S.signups.length - 1), 78 - ((v - min) / (max - min)) * 70])
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")
  const last = pts[pts.length - 1]
  const kpi = (label, value, under, part, up) =>
    `<div class="kpi${f}"><div class="kl">${label}</div><div class="kv">${value}</div>${
      part == null ? `<div class="kd${up ? " up" : ""}">${under}</div>` : `<div class="kd">${under}</div><div class="kbar"><i style="width:${Math.min(100, part * 100)}%"></i></div>`
    }</div>`
  return `<div class="board${narrow ? " n" : ""}">
    <div class="bhead"><div><div class="bt">Pricing relaunch</div><div class="bs">Kept by Juniper · ${
      S.working ? '<span class="upd">updating now</span>' : `updated ${S.updated}`
    }</div></div><div class="bday">Day 12 of 30</div></div>
    <div class="kpis">
      ${kpi("Visits this month", S.visits.toLocaleString("en-US"), narrow ? "+22%" : "+22% since the redesign", null, true)}
      ${kpi("Sign-up rate", S.rate.toFixed(1) + "%", "Goal 4.5%", S.rate / 4.5)}
      ${kpi("Team plan clicks", S.clicks + "%", "Goal 18%", S.clicks / 18)}
    </div>
    <div class="brow">
      <div class="bcard${f}"><div class="bl"><span>Sign-ups a day</span><b>${S.signups[S.signups.length - 1]}</b></div>
        <svg viewBox="0 0 240 84"><path d="${line} L240 84 L0 84 Z" fill="var(--primary)" opacity="0.12"/><path d="${line}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="var(--primary)" stroke="var(--background)" stroke-width="2"/></svg>
      </div>
      <div class="bcard"><div class="bl"><span>Steps</span><span>${S.steps.filter((s) => s.done).length} of ${S.steps.length}</span></div>
        ${S.steps
          .map(
            (s, i) =>
              `<div class="step${s.done ? " done" : ""}${S.flash && i === 3 ? " flash" : ""}" data-step="${i}"><span class="cbx">${ic("check", 11)}</span><span class="st">${s.t}</span><span class="whoc${s.who === "You" ? " you" : ""}">${s.who}</span></div>`,
          )
          .join("")}
      </div>
    </div>
  </div>`
}

const pinsOf = (key) =>
  key === "juniper"
    ? [
        ...(S.pinned ? [{ icon: "board", title: "Launch board", time: S.short, live: S.working, unseen: S.unseen, go: "open" }] : []),
        { icon: "file", title: "plan.md", time: "1d", go: "pin" },
      ]
    : key === "moss"
      ? [{ icon: "board", title: "Deploys", time: "14m", go: "open" }]
      : []

function side({ open = "juniper", pins = false } = {}) {
  const rows = Object.entries(D)
    .map(([key, d]) => {
      const busy = key === "juniper" && S.working
      const under = pins && pinsOf(key).length
        ? `<div class="rowpins">${pinsOf(key)
            .map(
              (p) =>
                `<a class="rp" data-go="${p.go}" title="Open beside the chat">${ic(p.icon, 14)}<span class="tt">${p.title}</span>${
                  p.live ? '<span class="dot pulse"></span>' : p.unseen ? '<span class="dot"></span>' : ""
                }<time>${p.live ? "now" : p.time}</time>${ic("pip", 14, "pop")}</a>`,
            )
            .join("")}</div>`
        : ""
      return `<a class="row${key === open ? " sel" : ""}" data-go="${key === "otto" ? "b" : "a"}"><img class="cr" src="${C[key]}" alt=""><div class="rt"><div class="nm"><span>${d.name}</span><time>${busy ? "now" : d.time}</time></div><div class="ln${busy ? " work" : ""}">${
        busy ? "Updating Launch board…" : d.line
      }</div></div></a>${under}`
    })
    .join("")
  return `<div class="side"><div class="shead"><span class="av">SA</span><b>Personal</b>${ic("updown", 14, "muted")}<button class="ib">${ic("left", 17)}</button></div>
    <div class="slbl"><span>Doods</span>${ic("plus", 17)}</div>${rows}
    <div class="sfoot"><span class="av">SA</span>Sawyer${ic("updown", 14)}</div></div>`
}

function strip({ who = "juniper", tab = "chat", pinTabs = false } = {}) {
  const t = (key, label) => `<a class="tab${tab === key ? " on" : ""}" data-go="${key === "chat" ? (pinTabs ? "c-chat" : "") : ""}">${label}</a>`
  return `<div class="strip"><div class="who"><img src="${C[who]}" alt="">${D[who].name}${ic("down", 15)}</div>
    <div class="tabs">${t("chat", "Chat")}${t("library", "Library")}${t("auto", "Automations")}${
      pinTabs
        ? `<span class="tsep"></span><a class="tab${tab === "board" ? " on" : ""}" data-go="c">${ic("pin", 13)}Launch board${
            S.unseen && tab !== "board" ? '<span class="dot"></span>' : S.working ? '<span class="dot pulse"></span>' : ""
          }</a><a class="tab" data-go="pin">${ic("pin", 13)}plan.md</a>`
        : ""
    }</div>
    <div class="sr"><span class="sc">${ic("chats", 16)}Side chats<span class="n">1</span></span><button class="ib">${ic("sliders", 16)}</button><button class="ib">${ic("right", 17)}</button></div></div>`
}

const composer = (who, extra = "") =>
  `<div class="comp"><div class="ph">Message ${D[who].name}${extra}</div><div class="cb">${ic("clip", 18)}<span class="sp"></span>${ic("mic", 18)}<span class="send">${ic("up", 17)}</span></div></div>`

const pinCard = () =>
  S.pinned
    ? `<div class="pcard"><span class="pi">${ic("pin", 17)}</span><div><b>Juniper pinned Launch board</b><small>boards/relaunch.html</small></div><div class="bs"><button class="btn" data-go="open">Open</button><button class="btn" data-act="unpin">Unpin</button></div></div>`
    : `<div class="pcard"><span class="muted">${ic("pin", 17)}</span><div><b class="muted">Launch board is no longer pinned</b><small>boards/relaunch.html</small></div><div class="bs"><button class="btn" data-act="unpin">Pin it again</button></div></div>`

const juniperTalk = (short) => [
  ...(short
    ? []
    : [`<div class="me">Can you keep a board for the pricing relaunch (the numbers, the steps, what's waiting on me) and pin it so I can keep an eye on it?</div>`]),
  `<div class="ai">Done. The board is a page in the library, <code>boards/relaunch.html</code>. I bring the numbers up to date every morning and tick steps off as they land. You can tick yours on it too.</div>`,
  pinCard(),
  `<div class="me">The one-row layout shipped this morning, by the way.</div>`,
  `<div class="ai">Ticked it off, and the two-week test starts today.</div>`,
]

function chat({ who = "juniper", msgs, narrow = false, chip = false }) {
  return `<div class="chat${narrow ? " narrow" : ""}">${
    chip ? `<div class="chip"><img src="${C[who]}" alt="">${D[who].name}${ic("refresh", 15)}</div>` : ""
  }<div class="msgs">${msgs.join("")}</div>${composer(who)}</div>`
}

function aside({ who = "juniper", pins = false } = {}) {
  const busy = who === "juniper" && S.working
  const list = pinsOf("juniper")
  const first = list[0]
  const tile =
    first && first.icon === "board"
      ? `<div class="tile${busy ? " busy" : ""}" data-go="open" title="Open beside the chat"><div class="thumb"><div class="thumb-in">${board()}</div></div>
        <div class="tf">${ic("board", 15)}<span class="tt">Launch board</span><span class="tm">${
          busy ? '<span class="dot pulse"></span>Updating' : S.unseen ? `<span class="dot"></span>${S.updated}` : S.updated
        }</span><span class="ta"><button data-go="open" title="Open beside the chat">${ic("right", 15)}</button><button data-go="window" title="Pop out to a window of its own">${ic("pip", 15)}</button></span></div></div>`
      : ""
  const rest = list
    .filter((p) => p !== first || !tile)
    .map((p) => `<div class="prow" data-go="${p.go}">${ic(p.icon, 15)}<span class="tt">${p.title}</span><span class="tm">Yesterday</span>${ic("next", 14)}</div>`)
    .join("")
  const did =
    who === "juniper"
      ? `<ul><li>Made the launch board<time>9:12</time></li><li>Pinned it<time>9:12</time></li><li>Ticked off the one-row layout<time>${S.runs ? "9:41" : "2 min ago"}</time></li>${
          S.runs ? `<li>Brought the numbers up to date<time>just now</time></li>` : ""
        }</ul>`
      : `<p>Nothing yet. When ${D[who].name} gets something substantial done in this chat, it notes it here, with its steps inside.</p>`
  return `<aside class="aside"><div class="face${pins ? "" : " tall"}"><button class="ib">${ic("refresh", 15)}</button><img class="big" src="${C[who]}" alt=""><div class="an">${D[who].name}</div>
    <div class="as${busy ? " work" : ""}">${busy ? '<span class="dot pulse"></span>Updating Launch board' : "Ready"}</div></div>
    ${pins ? `<div class="pins"><div class="lbl"><span>Pinned</span><button class="ib" title="Pin something from the library">${ic("plus", 15)}</button></div>${tile}${rest}</div>` : ""}
    <div class="did"><div class="lbl">What it did here</div>${did}</div></aside>`
}

function doc({ title, path, modes, body, pinned, hot, act, foot }) {
  return `<div class="doc"><div class="dbar"><span class="dn">${title}</span><span class="dp">${path}</span>
    <div class="seg">${modes.map((m, i) => `<span class="${i ? "" : "on"}">${ic(m[0], 14)}${m[1]}</span>`).join("")}</div>
    <button class="ib${pinned ? " pressed" : ""}${hot ? " hot" : ""}" data-act="${act}">${ic("pin", 16)}${hot ? `<span class="tip r">${pinned ? "Pinned to Juniper. Press to unpin" : "Pin to Juniper"}</span>` : ""}</button>
    <button class="ib">${ic("share", 16)}</button>
    <button class="ib" data-go="window" title="Pop out to a window of its own">${ic("pip", 16)}</button><button class="ib" data-go="a" title="Close">${ic("x", 17)}</button></div>
    <div class="dbody">${body}</div>${foot ?? ""}</div>`
}

const app = (who, inside, sidebar) => `<div class="app t" style="--agent-color:${D[who].color}">${sidebar}<div class="sheet">${inside}</div></div>`

const scenes = {
  a: () =>
    app(
      "juniper",
      `${strip()}<div class="body">${chat({ msgs: juniperTalk() })}${aside({ pins: true })}</div>`,
      side(),
    ),
  b: () =>
    app(
      "otto",
      `${strip({ who: "otto" })}<div class="body">${chat({
        who: "otto",
        msgs: [
          `<div class="me">What needs me today?</div>`,
          `<div class="ai">Two things. Dana wants an answer on the Thursday offsite by noon, and the invoice from Northwind is due tomorrow. Everything else can wait until Monday.</div>`,
        ],
      })}${aside({ who: "otto" })}</div>`,
      side({ open: "otto", pins: true }),
    ),
  c: () =>
    app(
      "juniper",
      `${strip({ tab: "board", pinTabs: true })}<div class="page"><div class="pbar"><span>boards/relaunch.html</span><span class="sp"></span><button class="btn" data-go="open">${ic("chats", 14)}Chat beside it</button><button class="ib">${ic("share", 16)}</button><button class="ib" data-go="window">${ic("pip", 16)}</button><button class="ib">${ic("more", 16)}</button></div><div class="pwrap"><div>${board()}</div></div></div>`,
      side(),
    ),
  "c-chat": () =>
    app("juniper", `${strip({ pinTabs: true })}<div class="body">${chat({ msgs: juniperTalk() })}${aside()}</div>`, side()),
  open: () =>
    app(
      "juniper",
      `${strip()}<div class="body">${chat({ msgs: juniperTalk(true), narrow: true, chip: true })}${doc({
        title: "Launch board",
        path: "boards/relaunch.html",
        modes: [
          ["eye", "Page"],
          ["code", "Source"],
        ],
        pinned: S.pinned,
        act: "unpin",
        body: `<div class="bw">${board()}</div>`,
        foot: S.working
          ? `<div class="dfoot work"><span class="dot pulse"></span><span>Juniper is updating this page</span><span></span></div>`
          : `<div class="dfoot">${ic("pin", 13)}<span>${S.pinned ? "Juniper pinned this" : "Not pinned"}</span><span>Follows the file as it changes</span></div>`,
      })}</div>`,
      side(),
    ),
  pin: () =>
    app(
      "juniper",
      `${strip()}<div class="body">${chat({
        narrow: true,
        chip: true,
        msgs: [
          `<div class="me">Plan the pricing page relaunch</div>`,
          `<div class="ai">I wrote the plan down. It has what changes, the numbers to watch and the steps.</div>`,
          `<div class="fcard"><div>${ic("file", 20, "muted")}<span><b>plan.md</b><small>780 B</small></span></div><button>${ic("download", 16)}</button><button>${ic("share", 16)}</button><button class="${
            S.planPinned ? "pressed" : "hot"
          }" data-act="plan">${ic("pin", 16)}</button></div>`,
        ],
      })}${doc({
        title: "plan.md",
        path: "pricing/plan.md",
        modes: [
          ["eye", "Read"],
          ["pencil", "Edit"],
        ],
        pinned: S.planPinned,
        hot: true,
        act: "plan",
        body: `<div class="md"><h1>Pricing page relaunch</h1><p>The redesign lifted visits and hurt sign-ups. This is the plan to get both.</p><h2>What changes</h2><ul class="b"><li>The three plans go back in one row on a laptop.</li><li>The Team card gets its old button, <code>Start free</code>.</li><li>The comparison table moves under the plans.</li></ul><h2>Steps</h2>${[
          ["Pull thirty days of analytics", 1],
          ["Draft the new Team copy", 1],
          ["Build the one-row layout", 1],
          ["Run it against the old page for two weeks", 0],
        ]
          .map(([t, d]) => `<div class="step${d ? " done" : ""}"><span class="cbx">${ic("check", 11)}</span><span class="st">${t}</span></div>`)
          .join("")}</div>`,
      })}</div>`,
      side(),
    ),
  window: () => {
    const cells = [
      [0, 0, "Channel", 600], [1, 0, "Spend", 600], [2, 0, "Visits", 600], [3, 0, "Sign-ups", 600], [4, 0, "Cost each", 600],
      [0, 1, "Search"], [1, 1, "$4,200"], [2, 1, "7,410"], [3, 1, "251"], [4, 1, "$16.73"],
      [0, 2, "Newsletter"], [1, 2, "$900"], [2, 2, "3,022"], [3, 2, "148"], [4, 2, "$6.08"],
      [0, 3, "Comparison links"], [1, 3, "$0"], [2, 3, "4,960"], [3, 3, "139"], [4, 3, "$0.00"],
      [0, 4, "Social"], [1, 4, "$1,750"], [2, 4, "2,848"], [3, 4, "74"], [4, 4, "$23.65"],
      [0, 6, "Total", 600], [1, 6, "$6,850", 600], [2, 6, "18,240", 600], [3, 6, "612", 600],
    ]
    return `<div class="desk t" style="--agent-color:${D.juniper.color}"><div class="mbar"><b>Numbers</b><span>File</span><span>Edit</span><span>Insert</span><span>Table</span><span>View</span><span>Tue 9:41</span></div>
      <div class="win other"><div class="wbar"><span class="lights"><i></i><i></i><i></i></span>Q4 channels.numbers</div><div class="tb"><span>Sheet 1</span><span>Sheet 2</span><span>+</span></div>
        <div class="grid">${cells.map(([x, y, text, weight]) => `<span style="left:${x * 120}px;top:${y * 28}px;font-weight:${weight ?? 400}">${text}</span>`).join("")}</div></div>
      <div class="note">Your own work is in front. Juniper's board stays over it, and changes as Juniper changes the file.</div>
      <div class="win float"><img class="perch" src="${C.juniper}" alt=""><div class="wbar"><div>Launch board<small>${
        S.working ? "Juniper is updating it" : `Juniper · updated ${S.updated}`
      }</small></div><button class="ib pressed" title="Stays over other windows">${ic("pin", 15)}</button><button class="ib" data-go="open" title="Back to the app">${ic("out", 15)}</button><button class="ib" data-go="a" title="Close">${ic("x", 16)}</button></div>
        <div class="fb"><div>${board()}</div></div></div></div>`
  },
  phone: () => {
    const chips = `<div class="pchips"><a class="pchip">${ic("board", 14)}Launch board<time>${S.short}</time></a><a class="pchip">${ic("file", 14)}plan.md</a></div>`
    const nav = `<div class="pst"><span>9:41</span><span>5G ▮</span></div><div class="pnav">${ic("back", 22)}<img src="${C.juniper}" alt="">Juniper<span class="sp"></span>${ic("more", 20, "muted")}</div>`
    return `<div class="phones t" style="--agent-color:${D.juniper.color}">
      <div><div class="phone">${nav}${chips}<div class="msgs">${juniperTalk(true).slice(0, 2).join("")}<div class="me">The one-row layout shipped this morning.</div><div class="ai">Ticked it off, and the two-week test starts today.</div></div>${composer("juniper")}</div><div class="plabel">Pinned things ride under Juniper's name</div></div>
      <div><div class="phone">${nav}${chips}<div class="dim"></div><div class="sheetp"><div class="grab"></div><div class="sh"><div>Launch board<small>${
        S.working ? "Juniper is updating it" : `Updated ${S.updated}`
      }</small></div><a>Done</a></div>${board(true)}</div></div><div class="plabel">A tap opens one over the chat</div></div>
    </div>`
  },
}

const caps = {
  a: "<b>A · Under his face.</b> Juniper's panel gets a Pinned shelf between the face and “What it did here”. The first pin is the page itself, drawn small and kept current; others are rows. Press the tile to open it beside the chat, or its second button to pop it out to a window. The chat shows the moment Juniper pinned it, with Unpin.",
  b: "<b>B · Under his row.</b> Pins hang under each Dood's row in the left sidebar, so they are in reach whichever Dood you are talking to (here, Otto). A dot marks one that changed since you looked; it pulses while the Dood is changing it. Press one to open it.",
  c: "<b>C · A tab of his own.</b> A pinned thing becomes a page of the Dood's, next to Chat, Library and Automations, and gets the whole sheet. “Chat beside it” puts the chat back next to it.",
  "c-chat": "<b>C · A tab of his own.</b> Back on the chat, the pins wait in the strip; a dot on a tab says it changed.",
  open: "<b>Popped out beside the chat.</b> The app's document panel, as today, plus a pin button (pressed here) and a button to pop it out to a window. It follows the file: press “Juniper updates the board” above and watch it change. Steps can be ticked right on it.",
  window: "<b>Popped out to a window of its own.</b> In the desktop app it stays over your other windows, with Juniper perched on it, the way the desktop companion does. In a browser it would be a small window of its own.",
  pin: "<b>Pinning it yourself.</b> One press on the pin, on a file's card in the chat or on the bar of an open document (the library's own list would have it in each row's menu). It pins to the Dood you are with. A Dood pins with a tool of its own and does not have to ask.",
  phone: "<b>On a phone,</b> where the panel does not exist, pins are chips under the Dood's name, and one opens as a sheet over the chat.",
}

const nav = [
  ["Where pins sit", [["a", "A · Under his face"], ["b", "B · Under his row"], ["c", "C · A tab of his own"]]],
  ["Popped out", [["open", "Beside the chat"], ["window", "Its own window"]]],
  ["Also", [["pin", "Pinning it yourself"], ["phone", "Phone"]]],
]

let cur = "a"
let real = false
const stage = document.getElementById("stage")
const fitBox = document.getElementById("fit")

function fit() {
  const room = document.getElementById("wrap").clientWidth
  const k = real ? 1 : Math.min(1, room / W)
  stage.style.transform = `scale(${k})`
  fitBox.style.height = `${H * k}px`
  fitBox.style.width = `${W * k}px`
}

function render() {
  stage.innerHTML = scenes[cur]()
  document.getElementById("groups").innerHTML =
    nav
      .map(
        ([label, items]) =>
          `<div class="ng"><span>${label}</span>${items.map(([key, text]) => `<button class="nb${cur === key || (key === "c" && cur === "c-chat") ? " on" : ""}" data-go="${key}">${text}</button>`).join("")}</div>`,
      )
      .join("") +
    `<div class="ng"><button class="nb act" data-act="update">▶ Juniper updates the board</button><button class="nb act" data-act="dark">${stage.classList.contains("dk") ? "Light" : "Dark"}</button><button class="nb act" data-act="real">${real ? "Fit to width" : "Full size"}</button></div>`
  document.getElementById("cap").innerHTML = caps[cur]
  document.getElementById("wrap").classList.toggle("real", real)
  fit()
}

function go(name) {
  if (!scenes[name]) return
  cur = name
  if (name === "open" || name === "window" || name === "c" || name === "a") S.unseen = false
  S.flash = false
  history.replaceState(null, "", `#${name}`)
  render()
}

function update() {
  if (S.working) return
  S.working = true
  S.flash = false
  render()
  setTimeout(() => {
    S.working = false
    S.flash = true
    S.visits += 172 + S.runs * 9
    S.rate = Math.min(4.5, +(S.rate + 0.2).toFixed(1))
    S.clicks = Math.min(18, S.clicks + 2)
    S.signups = S.signups.slice(1).concat(27 + S.runs * 2)
    S.steps[3].done = true
    S.updated = "just now"
    S.short = "now"
    S.unseen = cur === "b" || cur === "c-chat"
    S.runs += 1
    render()
  }, 1700)
}

document.addEventListener("click", (event) => {
  const step = event.target.closest("[data-step]")
  if (step) {
    const s = S.steps[+step.dataset.step]
    s.done = !s.done
    S.flash = false
    render()
    return
  }
  const act = event.target.closest("[data-act]")
  if (act) {
    const what = act.dataset.act
    if (what === "update") update()
    else {
      if (what === "unpin") S.pinned = !S.pinned
      if (what === "plan") S.planPinned = !S.planPinned
      if (what === "dark") stage.classList.toggle("dk")
      if (what === "real") real = !real
      S.flash = false
      render()
    }
    return
  }
  const to = event.target.closest("[data-go]")
  if (to && to.dataset.go) go(to.dataset.go)
})
window.addEventListener("resize", fit)
if (scenes[location.hash.slice(1)]) cur = location.hash.slice(1)
render()
