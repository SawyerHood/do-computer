// The panel sections mock-up: the Dood's panel with a lot in it, as it is today and three ways it
// could make room. Every scene is drawn from the little state below.
const C = window.CREATURES

const I = {
  next: '<path d="m9 18 6-6-6-6"/>',
  ok: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  term: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
}
const ic = (name, size = 16, cls = "") =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`

// `window.START` lets a page that wraps this one open it on a scene, in a state.
const S = {
  // A: which sections are folded. Messages that have all been answered start folded.
  fold: { pinned: false, running: false, doods: true, slack: true, shared: true, did: false },
  tuck: true,
  // B: the tab that is open.
  tab: "pinned",
  // C: which lists have been opened to their whole length.
  more: {},
  tall: false,
  ping: false,
  ...(window.START ?? {}),
}

const mark = (wait) => (wait ? '<span class="dot pulse"></span>' : ic("ok", 16))
const thread = (lead, title, under, wait) =>
  `<a class="r">${lead}<span class="rt"><span class="t1">${title}</span><span class="t2${wait ? " hot" : ""}">${under}</span></span>${mark(wait)}</a>`
const slackLead = `<span class="sq">${ic("hash", 15)}</span>`
const fileRow = (name, size) => `<a class="r one">${ic("file", 16)}<span class="t1">${name}</span><small>${size}</small></a>`
const work = (title) => `<a class="r one">${ic("ok", 16)}<span class="t1">${title}</span></a>`

// The pinned page, drawn small. `height` is how much of it shows.
const tile = (height) =>
  `<a class="tile"><div class="pv" style="height:${height}px"><div class="pvt">your t3 attention queue</div><div class="pvs">bboss keeps the inbox tidy</div><div class="pvn"><b>1</b>waiting for you</div>
    <div class="pvc"><small>durable-computer · ready for review</small><u>Bundle Server With Desktop App</u>PR #130 is open and CI is running; rebased on latest main, desktop and web tests pass locally. agent will merge when checks pass.</div>
    <div class="pvc"><small>do-code · working</small><u>Closed sign-ups page</u>Drafting the copy for the waiting list; nothing needed from you yet.</div>
    <div class="pvc"><small>durable-computer · done today</small><u>Phone plays a film where it is</u>Merged as #128.</div></div>
    <div class="tf">${ic("globe", 17)}<b>t3 attention queue</b><time>3:29 PM</time></div></a>`

// Everything the panel has to show, top to bottom, in the order the app has it.
function sections() {
  const slack = [
    ...(S.ping ? [["the deploy went red after #129, can you look?", "waiting for an answer", true]] : []),
    ["can you use bb-150k to start a thread on the export bug", "answered"],
    ["how do i ssh into `brsbl-gmktec` from the office", "answered"],
    ["can you make some mocks of what the queue could look like", "answered"],
    ["can you generate another sign in link for staging", "answered"],
  ]
  return [
    {
      key: "pinned",
      title: "Pinned",
      lead: tile(148),
      rows: [`<a class="r one">${ic("file", 16)}<span class="t1">release checklist.md</span><small>Yesterday</small></a>`],
      cap: 9,
    },
    {
      key: "running",
      title: "Running in the background",
      live: "1 running",
      rows: [
        `<a class="r">${`<span class="sq">${ic("term", 15)}</span>`}<span class="rt"><span class="t1 mono">pnpm dev --filter web</span><span class="t2">Started 12 minutes ago</span></span><span class="dot pulse"></span></a>`,
      ],
    },
    {
      key: "doods",
      title: "From other Doods",
      quiet: "answered",
      rows: [thread(`<img src="${C.penjamin}" alt="">`, "Hi BBoss, this is Penjamin, Sawyer asked me to check the queue", "Penjamin · answered")],
    },
    {
      key: "slack",
      title: "From Slack",
      wait: S.ping ? 1 : 0,
      quiet: "all answered",
      rows: slack.map(([title, state, wait]) => thread(slackLead, title, `#all-terragon-labs · ${state}`, wait)),
    },
    {
      key: "shared",
      title: "Shared here",
      rows: [fileRow("attention-queue.html", "14 KB"), fileRow("watcher-notes.md", "3 KB")],
    },
    {
      key: "did",
      title: "What it did here",
      cap: 4,
      rows: [
        "Build t3 attention watcher dashboard",
        "Start a thread for the export bug",
        "Write up how to reach brsbl-gmktec",
        "Mock up three layouts for the queue",
        "Make a sign-in link for staging",
        "Answer Penjamin about the queue",
      ].map(work),
    },
  ]
}

const face = (cls = "") =>
  `<div class="face ${cls}"><button class="ib fresh" title="Start fresh">${ic("refresh", 16)}</button><img class="big" src="${C.bboss}" alt=""><div class="an">BBoss${ic("shirt", 16, "muted")}</div><div class="as">Ready</div></div>`
const bar = `<div class="bar"><img src="${C.bboss}" alt=""><b>BBoss</b><span>Ready</span><button class="ib" title="Start fresh">${ic("refresh", 16)}</button></div>`
const body = (s, rows = s.rows) => `${s.lead ?? ""}${rows.join("")}`
const count = (s) => s.rows.length + (s.lead ? 1 : 0)

const scenes = {
  // As the app is: a share of the height each, a scroll area each, and the last has what is left.
  today() {
    const all = sections()
    return `<div class="aside">${face()}${all
      .map((s, i) => {
        const share = i === all.length - 1 ? "rest" : s.key === "pinned" ? "" : s.key === "running" ? "cap40" : "cap30"
        return `<div class="sec old ${share}"><div class="sh">${s.title}</div><div class="rows">${body(s)}</div></div>`
      })
      .join("")}</div>`
  },

  // A: a heading folds its section. Folded, it still says how many and whether one is waiting.
  a() {
    const secs = sections()
      .map((s) => {
        const folded = S.fold[s.key]
        const said = s.wait
          ? `<span class="hot">${s.wait} waiting</span><span class="dot"></span>`
          : s.live
            ? `<span>${s.live}</span><span class="dot pulse"></span>`
            : folded && s.quiet
              ? `<span>${s.quiet}</span>`
              : ""
        return `<div class="sec${folded ? " folded" : ""}"><button class="sh f" data-fold="${s.key}" aria-expanded="${!folded}">${ic("next", 14, "car")}<span>${s.title}</span><span class="sum">${
          folded ? said : ""
        }<span class="n">${count(s)}</span></span></button>${folded ? "" : `<div class="rows">${body(s)}</div>`}</div>`
      })
      .join("")
    return S.tuck
      ? `<div class="aside">${bar}<div class="scroller">${face()}${secs}</div></div>`
      : `<div class="aside">${face()}<div class="scroller">${secs}</div></div>`
  },

  // B: one group at a time, with all the room under the face.
  b() {
    const by = Object.fromEntries(sections().map((s) => [s.key, s]))
    const tabs = [
      ["pinned", "Pinned", ""],
      ["work", "Work", '<span class="dot pulse"></span>'],
      ["msgs", "Messages", S.ping ? '<span class="dot"></span>' : ""],
      ["files", "Files", ""],
    ]
    const group = (...keys) => keys.map((k) => `<div class="sub">${by[k].title}</div><div class="rows">${body(by[k])}</div>`).join("")
    const inside = {
      pinned: `${tile(S.tall ? 520 : 262)}<div class="rows">${by.pinned.rows.join("")}</div>`,
      work: group("running", "did"),
      msgs: group("doods", "slack"),
      files: group("shared"),
    }[S.tab]
    return `<div class="aside">${face("short")}<div class="tabsb">${tabs
      .map(([key, label, dot]) => `<button class="tb${S.tab === key ? " on" : ""}" data-tab="${key}">${label}${dot}</button>`)
      .join("")}</div><div class="scroller tabbody">${inside}</div></div>`
  },

  // C: nothing folds. A list shows its newest few and says how many more there are.
  c() {
    const secs = sections()
      .map((s) => {
        const cap = s.cap ?? 2
        const open = S.more[s.key]
        const more =
          s.rows.length > cap
            ? `<button class="more" data-more="${s.key}">${open ? "Show fewer" : `Show ${s.rows.length - cap} more`}</button>`
            : ""
        return `<div class="sec"><div class="sh">${s.title}</div><div class="rows">${body(s, open ? s.rows : s.rows.slice(0, cap))}${more}</div></div>`
      })
      .join("")
    return `<div class="aside">${bar}<div class="scroller">${face()}${secs}</div></div>`
  },
}

const caps = {
  today: `<h2>Today</h2>
    <p>Every section is given a share of the panel's height and scrolls by itself, and the last one has whatever is left.</p>
    <ul><li>In a laptop window the face and what is pinned take most of it. <b>From Slack</b>, <b>Shared here</b> and <b>What it did here</b> are pushed off the bottom, and nothing scrolls to them.</li>
    <li>In a <b>tall window</b> (above) it only runs out a little further down: Shared here is cut and What it did here still does not show. A list longer than its share gets a scroll bar of its own.</li></ul>`,
  a: `<h2>A · Folding sections<span class="pick">my pick</span></h2>
    <ul><li><b>Press a heading</b> to fold or open it. What you fold stays folded, for every Dood.</li>
    <li>A folded heading still says <b>how many</b>, and whether something is running or <b>waiting for an answer</b>. Try “A Slack message comes in”.</li>
    <li>Messages that have all been answered <b>start folded</b>; so does Shared here.</li>
    <li>The panel <b>scrolls as one</b>. No more small scroll areas.</li>
    <li>Scroll down and the <b>face tucks into a bar</b>, so the lists get the whole height. Scroll back up and it is big again.</li></ul>
    <p class="cost">Costs: one more press to reach a folded list, and a section with something new does not open by itself, it only shows the dot.</p>`,
  b: `<h2>B · Tabs</h2>
    <ul><li>Four tabs under the face: <b>Pinned</b>, <b>Work</b> (what is running and what it did), <b>Messages</b> (other Doods and Slack), <b>Files</b>.</li>
    <li>One group at a time with <b>all the room</b>, so the pinned page is drawn much larger.</li>
    <li>A dot on a tab says something is running or waiting.</li>
    <li>The face is a little smaller to pay for the row of tabs.</li></ul>
    <p class="cost">Costs: the pinned page and what the Dood is doing can no longer be seen together, and a new message is only a dot until its tab is opened.</p>`,
  c: `<h2>C · Short lists</h2>
    <ul><li>Nothing folds. Each list shows its <b>newest two</b> (four for What it did here) and a “Show 3 more”.</li>
    <li>The panel scrolls as one and the face tucks into a bar, as in A.</li>
    <li>The smallest change: nothing to remember, nothing hidden behind a press.</li></ul>
    <p class="cost">Costs: with everything present it is still a long scroll, and there is no way to put away a section you never look at.</p>`,
}

const nav = [
  ["Now", [["today", "Today"]]],
  ["Ways to make room", [["a", "A · Folding sections"], ["b", "B · Tabs"], ["c", "C · Short lists"]]],
]

let cur = scenes[window.START?.scene] ? window.START.scene : "a"
const stage = document.getElementById("stage")

function render(keep = true) {
  const before = stage.querySelector(".scroller")
  const top = keep && before ? before.scrollTop : (window.START?.scroll ?? 0)
  stage.innerHTML = `${scenes[cur]()}<div class="notes">${caps[cur]}</div>`
  stage.classList.toggle("tallw", S.tall)
  const scroller = stage.querySelector(".scroller")
  const tucked = stage.querySelector(".bar")
  if (scroller) {
    scroller.scrollTop = top
    if (tucked) {
      // The bar comes in once the Dood's name has gone under the top edge.
      const follow = () => tucked.classList.toggle("on", scroller.scrollTop > 236)
      scroller.addEventListener("scroll", follow)
      follow()
    }
  }
  const dark = document.getElementById("wrap").classList.contains("dk")
  document.getElementById("groups").innerHTML =
    nav
      .map(
        ([label, items]) =>
          `<div class="ng"><span>${label}</span>${items.map(([key, text]) => `<button class="nb${cur === key ? " on" : ""}" data-go="${key}">${text}</button>`).join("")}</div>`,
      )
      .join("") +
    `<div class="ng"><button class="nb act" data-act="ping">${S.ping ? "Take the Slack message away" : "▶ A Slack message comes in"}</button>${
      cur === "a" ? `<button class="nb act" data-act="tuck">Face tucks away: ${S.tuck ? "on" : "off"}</button>` : ""
    }<button class="nb act" data-act="tall">${S.tall ? "Laptop window" : "Tall window"}</button><button class="nb act" data-act="dark">${dark ? "Light" : "Dark"}</button></div>`
}

document.addEventListener("click", (event) => {
  const at = (name) => event.target.closest(`[data-${name}]`)?.dataset[name]
  const go = at("go")
  if (go) {
    cur = go
    history.replaceState(null, "", `#${go}`)
    window.START = undefined
    return render(false)
  }
  const fold = at("fold")
  if (fold) S.fold[fold] = !S.fold[fold]
  const more = at("more")
  if (more) S.more[more] = !S.more[more]
  const tab = at("tab")
  if (tab) S.tab = tab
  const act = at("act")
  if (act === "dark") document.getElementById("wrap").classList.toggle("dk")
  else if (act) S[act] = !S[act]
  if (fold || more || tab || act) render(act !== "tuck" && !tab)
})
if (scenes[location.hash.slice(1)]) cur = location.hash.slice(1)
if (window.START?.light) document.getElementById("wrap").classList.remove("dk")
render(false)
