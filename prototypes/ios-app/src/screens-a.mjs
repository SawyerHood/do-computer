// The list of agents and the chat. Everything said here is pretend.
import { back, composer, cre, face, gb, ic, keyboard, menu, nav, phone, who } from "./kit.mjs"

/* ---------- the list of agents ---------- */
function ag(o) {
  const mark = o.mark === "spin" ? `<span class="mk2"><span class="spin"></span></span>` : o.mark === "q" ? `<span class="mk2 q">?</span>` : ""
  const lead = o.clock ? ic("clock", 16, 2) : ""
  return (
    `<div class="ag">${o.unread ? '<span class="ud"></span>' : ""}<div class="av">${cre(o.key, 52)}${mark}</div><div class="t">` +
    `<div class="l1"><b>${o.name}</b>${o.here ? `<span class="stack">${o.here.map((p) => who(p, 18)).join("")}</span>` : ""}<time>${o.time}</time>` +
    `<span style="color:var(--ink3);margin-left:-4px">${ic("chevR", 14, 2.600)}</span></div>` +
    `<div class="l2" style="${o.unread ? "color:var(--ink)" : ""}">${lead}<span>${o.line}</span></div></div></div>`
  )
}
const ROWS = {
  juniper: { key: "juniper", name: "Juniper", time: "2m", unread: true, line: "The Team card lost half its clicks. I would put the three plans back in one row. Shall I draft the copy?" },
  moss: { key: "mossWork", name: "Moss", time: "now", mark: "spin", line: "Waiting on <span class='mono' style='font-size:13px'>pnpm test --filter web</span>" },
  otto: { key: "otto", name: "Otto", time: "14m", mark: "q", unread: true, line: "Wants to send an email to Dana about Thursday" },
  pip: { key: "pip", name: "Pip", time: "1h", here: ["maya", "jon"], line: "Maya: what is still open on the launch checklist? We ship Thursday." },
  ledger: { key: "ledger", name: "Ledger", time: "Tue", clock: true, line: "Weekly numbers: revenue is up 4%, and two invoices are late." },
  scout: { key: "scoutSleep", name: "Scout", time: "Sep 28", line: "Reads the internet so you do not have to" },
}
const wsh = (letter, color, name, extra = "") =>
  `<div class="wsh">${ic("chevD", 16, 2.600)}<span class="tile" style="background:${color}">${letter}</span>${name}<span class="sp"></span>${extra}<span class="more">${ic("dots", 22)}${ic("plus", 22, 2)}</span></div>`
const agents = () =>
  wsh("P", "#127a78", "Personal") +
  ag(ROWS.juniper) + ag(ROWS.moss) + ag(ROWS.otto) +
  wsh("T", "#c0607a", "Tidewater", `<span class="stack" style="margin-right:6px">${who("maya", 22)}${who("jon", 22)}</span>`) +
  ag(ROWS.pip) + ag(ROWS.ledger) + ag(ROWS.scout)
const me = () => `<span class="gb g" style="padding:0">${face("SH", "#127a78", 36)}</span>`
const search = (hint = "Search") => `<div class="srch g">${ic("search", 20, 2)}<span style="flex:1">${hint}</span>${ic("mic", 20)}</div>`
const listScreen = (extra = "", bar = `<div class="bar">${search()}</div>`) =>
  `<div class="body lg">${nav(me(), "", gb(ic("compose", 22)))}<h1 class="lt">Agents</h1>${agents()}</div>` +
  `<div class="fade-bot"></div>${bar}${extra}`

const A1 = phone(listScreen(), { page: true })
const A2 = phone(
  listScreen(
    `<div class="blur"></div>` +
      `<div class="card" style="position:absolute;left:14px;right:14px;top:150px;z-index:90;border-radius:24px;background:var(--card);box-shadow:0 18px 40px rgba(0,0,0,.2)">${ag(ROWS.juniper)}</div>` +
      menu([["Open the library", "folder"], ["Automations", "clock"], ["Side chats", "chats"], ["Wardrobe", "hanger"], "-", ["Mark as unread", "mail"], ["Settings", "gear"]], "left:14px;top:238px"),
  ),
  { page: true },
)
const A3 = phone(
  listScreen(
    `<div class="scrim" style="background:transparent"></div>` +
      menu(["New agent in", ["Personal", "person"], ["Tidewater", "people"], "-", ["New team", "plus"], ["Connect a computer", "qr"], ["Join with an invitation", "mail"]], "right:16px;top:106px;width:262px"),
  ),
  { page: true },
)
const tabs = (on) =>
  `<div class="tabbar g">${[["chats", "Agents"], ["folder", "Library"], ["clock", "Automations"], ["person", "You"]]
    .map(([i, t], k) => `<div${k === on ? ' class="on"' : ""}>${ic(i, 24)}${t}</div>`)
    .join("")}</div><span class="gb g" style="height:62px;min-width:62px;border-radius:31px">${ic("search", 24, 2)}</span>`
const A4 = phone(
  `<div class="body lg">${nav("", "", gb(ic("compose", 22)))}<h1 class="lt">Agents</h1>${agents()}</div><div class="fade-bot"></div><div class="bar" style="bottom:22px">${tabs(0)}</div>`,
  { page: true },
)

/* ---------- a chat ---------- */
const title = (key, name, sub) =>
  `<span class="gb g" style="gap:8px;padding:0 12px 0 6px">${cre(key, 34)}<span style="line-height:1.1"><b style="font-weight:600;display:block">${name}</b>${sub ? `<small style="font-size:12px;color:var(--ink2);display:block">${sub}</small>` : ""}</span><span style="color:var(--ink3)">${ic("chevR", 13, 2.800)}</span></span>`
export const chatNav = (o = {}) =>
  nav(
    o.back ?? gb(ic("chevL", 22, 2.200) + (o.unread ? `<span style="margin:0 4px 0 -10px;font-size:15px;font-weight:600">${o.unread}</span>` : "")),
    title(o.key ?? "juniper", o.name ?? "Juniper", o.sub),
    o.right ?? gb(ic("chats", 23) + (o.n ? `<span class="n">${o.n}</span>` : "")),
  )
const asked = `<div class="me">Can you look at how the pricing page is doing since the redesign and tell me what to change?</div>`
const answer =
  `<div class="an"><p>I went through the last 30 days. The redesign helped the top of the page and hurt the middle of it.</p>` +
  `<ul><li><b>Visits are up 22%</b>, mostly from the comparison links.</li><li><b>Sign-ups are flat</b> at 612, so the rate fell to 3.4%.</li><li><b>The Team plan lost half its clicks.</b></li></ul>` +
  `<p>My notes are in <code>pricing-notes.md</code>.</p></div>`
const fileCard = (name, size) =>
  `<div class="card fc">${ic("doc", 24, 1.600)}<span>${name}<small>${size}</small></span><span class="x">${ic("share", 20)}</span></div>`
const status = (words) => `<div class="st"><span class="spin"></span><em>${words}</em></div>`
const transcript = (parts, bottom = 104) => `<div class="tr" style="bottom:${bottom}px">${parts.join("")}</div>`
const chat = (parts, o = {}) =>
  `<div class="body">${transcript(parts, o.bottom)}</div><div class="fade-top"></div>${chatNav(o.nav)}<div class="fade-bot" style="height:${o.fade ?? 96}px"></div>${o.comp ?? composer()}${o.extra ?? ""}`

const C1 = phone(
  chat(
    [
      asked,
      answer,
      fileCard("pricing-notes.md", "Markdown · 2 KB"),
      `<div class="me">Yes, and check what the Team button said before</div>`,
      `<span class="chip">${cre("scout", 22)}Old page check <span>· sub-agent at work</span></span>`,
      status("Reading analytics-export.csv"),
    ],
    { nav: { sub: "Working", n: 2, unread: 2 }, comp: composer({ busy: true }) },
  ),
  { page: true, agent: "juniper" },
)
const hello =
  `<div class="body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:150px">${cre("juniperHero", 214)}` +
  `<h2 style="font-size:26px;font-weight:700;letter-spacing:-.02em;margin-top:8px">Hi Sawyer, I'm Juniper.</h2><p style="color:var(--ink2);margin-top:4px;font-size:16px">What would you like to do?</p>` +
  `<div style="display:flex;flex-direction:column;gap:8px;margin-top:22px;align-items:center">${["Draw something on my screen", "Chart what is filling my disk", "Check in with me each morning"]
    .map((s) => `<span class="btn s line" style="height:40px;border-radius:20px;font-weight:500">${s}</span>`)
    .join("")}</div></div>`
const C2 = phone(hello + chatNav({ sub: "" }) + composer({ hint: "Say hello" }), { page: true, agent: "juniper" })
const thumbs =
  `<div style="display:flex;gap:8px;padding:10px 0 2px">` +
  `<span style="width:64px;height:64px;border-radius:14px;background:linear-gradient(135deg,#f6d9a5,#e59d5c 60%,#b9624a);position:relative;display:block"><i style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:10px;background:var(--ink2);color:var(--page);display:grid;place-items:center">${ic("x", 12, 3)}</i></span>` +
  `<span class="card" style="height:64px;padding:0 12px;display:flex;align-items:center;gap:8px;font-size:14px;border-radius:14px">${ic("doc", 22, 1.600)}<span>q3-plans.pdf<small style="display:block;color:var(--ink2);font-size:12px">PDF · 1.2 MB</small></span></span></div>`
const C3 = phone(
  `<div class="body">${transcript([answer, status("Reading analytics-export.csv")], 492)}</div><div class="fade-top"></div>${chatNav({ sub: "Working", n: 2 })}` +
    `<div style="position:absolute;left:16px;right:16px;bottom:458px;z-index:44;font-size:13px;color:var(--ink2);display:flex;gap:6px;align-items:center">${ic("clock", 15, 2)}Juniper reads this after the step it is on</div>` +
    `<div class="comp" style="bottom:303px"><span class="plus g">${ic("plus", 22, 2)}</span><div class="box g" style="flex-direction:column;align-items:stretch;padding:0 6px 0 14px">${thumbs}<div style="display:flex;align-items:flex-end;gap:8px"><div class="ph-t has">Here is the old page and the plans we sent. Compare the two</div><span class="b send">${ic("up", 19, 2.400)}</span></div></div></div>` +
    keyboard(),
  { page: true, agent: "juniper" },
)
const C4 = phone(
  chat([asked, answer, fileCard("pricing-notes.md", "Markdown · 2 KB")], {
    nav: { n: 2 },
    extra:
      `<div class="scrim" style="background:transparent"></div>` +
      menu([["Photo Library", "photo"], ["Take Photo", "camera"], ["Choose Files", "folder"], ["From the library", "doc"], "-", ["Dictate", "wave"]], "left:12px;bottom:84px"),
  }),
  { page: true, agent: "juniper" },
)

/* ---------- what turns up in a chat ---------- */
const screenUse =
  `<div class="card" style="padding:8px;border-radius:22px;align-self:stretch">` +
  `<div style="height:150px;border-radius:15px;background:linear-gradient(160deg,#e8eef3,#cfd9e2);position:relative;overflow:hidden">` +
  `<div style="position:absolute;left:18px;top:16px;right:60px;bottom:26px;border-radius:8px;background:#fff;box-shadow:0 4px 14px rgba(0,0,0,.14)"><div style="height:16px;border-bottom:1px solid #e3e7ea;display:flex;gap:4px;align-items:center;padding-left:7px"><i style="width:6px;height:6px;border-radius:3px;background:#ee6a5f;display:block"></i><i style="width:6px;height:6px;border-radius:3px;background:#f5bd4f;display:block"></i><i style="width:6px;height:6px;border-radius:3px;background:#61c454;display:block"></i></div><div style="padding:9px 10px;display:grid;gap:6px"><i style="height:7px;width:60%;border-radius:3px;background:#dfe5e9;display:block"></i><i style="height:7px;width:84%;border-radius:3px;background:#edf0f2;display:block"></i><i style="height:7px;width:72%;border-radius:3px;background:#edf0f2;display:block"></i><i style="height:22px;width:38%;border-radius:6px;background:var(--a);opacity:.85;display:block;margin-top:4px"></i></div></div>` +
  `<span style="position:absolute;left:112px;top:104px;color:var(--a);filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">${ic("pointer", 26)}</span></div>` +
  `<div style="display:flex;align-items:center;gap:10px;padding:9px 6px 3px;font-size:15px"><span style="flex:1"><b style="font-weight:600">MacBook Air</b><small style="display:block;color:var(--ink2);font-size:13px">In the browser · 0:42</small></span><span class="btn s q">${ic("pause", 16)}Pause</span><span class="btn s q" style="color:var(--red)">Stop</span></div></div>`
const approval = (bottom) =>
  `<div class="ask g" style="bottom:${bottom}px"><h6>${ic("shield", 15, 2)}Juniper asks first · from this chat</h6><b>Send an email</b>` +
  `<pre>To: dana@tidewater.studio\nSubject: Pricing page: three changes</pre>` +
  `<div class="bs"><span class="btn q">Don’t allow</span><span class="btn q">Always</span><span class="btn a">Allow once</span></div></div>`
const I1 = phone(
  chat([`<div class="me">Open the old pricing page on my laptop and try the Team button</div>`, `<div class="an"><p>On it. I am using the browser on your MacBook Air.</p></div>`, screenUse], {
    bottom: 296,
    nav: { sub: "Waiting for you", n: 2 },
    comp: composer({ busy: true }),
    extra: approval(86),
    fade: 80,
  }),
  { page: true, agent: "juniper" },
)
const tail =
  `<div class="card" style="align-self:stretch;border-radius:20px;overflow:hidden"><div style="display:flex;align-items:center;gap:10px;padding:11px 14px;font-size:15px">${ic("term", 21)}<span style="flex:1" class="mono">pnpm test --filter web</span><span style="color:var(--ink2);font-size:13px">4m 12s</span></div>` +
  `<pre class="mono" style="margin:0;padding:10px 14px;background:var(--fill);font-size:12px;line-height:1.5;white-space:pre-wrap"> ✓ e2e/chat.spec.ts (14)\n ✓ e2e/library.spec.ts (9)\n ◌ e2e/mobile.spec.ts 3/11</pre>` +
  `<div style="display:flex;justify-content:flex-end;padding:8px 10px"><span class="btn s q" style="color:var(--red)">Stop</span></div></div>`
const report =
  `<div class="card" style="align-self:stretch;border-radius:20px;padding:12px 14px;font-size:15px"><div style="display:flex;gap:10px;align-items:center">${cre("scout", 30)}<span style="flex:1"><b style="font-weight:600">Old page check reported back</b><small style="display:block;color:var(--ink2);font-size:13px">Took 4 min · 12 steps</small></span><span style="color:var(--ink3)">${ic("chevR", 16, 2.400)}</span></div></div>`
const subPop =
  `<div class="g" style="position:absolute;left:50%;transform:translateX(-50%);top:108px;z-index:41;border-radius:24px;width:300px;padding:6px 0;font-size:15px">` +
  `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;font-weight:600"><span class="spin"></span>2 sub-agents at work<span style="flex:1"></span><span style="color:var(--ink3)">${ic("chevD", 16, 2.400)}</span></div>` +
  [["scout", "Status page", "Reading status.tidewater.studio"], ["pip", "Email list", "Waiting for an OK"]]
    .map(([k, n, l]) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid var(--sep)">${cre(k, 30)}<span style="flex:1">${n}<small style="display:block;color:var(--ink2);font-size:13px">${l}</small></span><span style="color:var(--red);font-weight:500">Stop</span></div>`)
    .join("") +
  `</div>`
const I2 = phone(
  chat([`<div class="me">Run the web tests while you look into the two launch items</div>`, tail, report, `<div class="an"><p>The old button said <code>Start free</code>. The tests are still going.</p></div>`], {
    nav: { sub: "Working", n: 2 },
    comp: composer({ busy: true }),
    extra: subPop,
  }),
  { page: true, agent: "juniper" },
)
const bars = [38, 44, 41, 52, 34, 30, 31, 36]
const visual =
  `<div class="card" style="align-self:stretch;border-radius:22px;padding:14px 14px 10px"><div style="display:flex;align-items:center;font-size:15px;font-weight:600">Sign-up rate by week<span style="flex:1"></span><span style="color:var(--ink2);display:flex;gap:14px">${ic("arrowUR", 20)}${ic("share", 20)}</span></div>` +
  `<div style="display:flex;align-items:flex-end;gap:9px;height:104px;padding-top:12px">${bars.map((b, i) => `<i style="flex:1;height:${b * 1.9}px;border-radius:6px 6px 2px 2px;background:var(--a);opacity:${i < 4 ? 0.35 : 1};display:block"></i>`).join("")}</div>` +
  `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink2);padding-top:6px"><span>Before the redesign</span><span>After</span></div></div>`
const site =
  `<div class="card" style="align-self:stretch;border-radius:20px;padding:12px 14px;display:flex;gap:12px;align-items:center;font-size:15px"><span class="sq" style="background:var(--tint)">${ic("globe", 19)}</span><span style="flex:1;min-width:0"><b style="font-weight:600;display:block">Pricing relaunch plan</b><small style="display:block;color:var(--ink2);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">do.computer/s/k3v9p · anyone with the link</small></span>${ic("copy", 20)}</div>`
const I3 = phone(
  chat([`<div class="marker">Continues from the main chat</div>`, `<div class="me">Chart the sign-up rate and share the plan with Dana</div>`, `<div class="an"><p>Here is the rate, week by week.</p></div>`, visual, `<div class="an"><p>The plan is shared. Anyone with the link can open it.</p></div>`, site], {
    nav: { name: "Pricing relaunch", sub: "Side chat with Juniper", right: gb(ic("dots", 22)) },
    comp: composer({ hint: "Message Juniper in this chat" }),
  }),
  { page: true, agent: "juniper" },
)
const sideRow = (t, s, tail) =>
  `<div class="row"><div class="t"><b>${t}</b><span>${s}</span></div>${tail}<span class="ch">${ic("chevR", 16, 2.400)}</span></div>`
const I4 = phone(
  chat([asked, answer], { nav: { n: 3 } }) +
    `<div class="scrim"></div><div class="sheet" style="height:452px"><div class="grab"></div><div class="sh"><b>Side chats</b><span></span>${gb(ic("x", 20, 2.200))}</div>` +
    `<div class="sect"><div class="grp"><div class="row tint">${ic("plus", 22, 2)}<div class="t"><b style="font-weight:500">New side chat</b></div></div></div><small>Its own conversation with Juniper and the same memory, kept out of the main chat.</small></div>` +
    `<div class="sect"><div class="grp">${sideRow("Pricing relaunch", "Shared the plan with a link", `<span class="v">1m</span>`)}${sideRow("Investor update numbers", "2 sub-agents at work", `<span class="spin"></span>`)}${sideRow("Vendor contract questions", "Maya and you", `<span class="v">Tue</span>`)}</div></div></div>`,
  { page: true, agent: "juniper" },
)

export const sectionsA = [
  {
    id: "agents",
    name: "Agents",
    note: "The app opens on what the web keeps in its sidebar: <b>agents under their workspace</b>, each with its latest line, pushed and not polled. Picking one is talking to it. Everything else hangs off an agent or off your own face, top left.",
    cells: [
      [A1, "The list", "Large title, folding workspace sections with who is there, a live creature on every row, unread dot, a spinner while it works and a “?” when it waits on you. Search is new: the web has none."],
      [A2, "Press and hold a row", "The web hides this menu on touch screens. Here it is the system’s context menu, and a swipe gives Mark as read."],
      [A3, "The new button", "New agent in a workspace, New team, and pairing a computer. A waiting invitation also shows at the foot of the list, as on the web."],
      [A4, "The other way: a tab bar", "What the app has today, restyled. I would not do this: the library and automations belong to one agent, so the tabs need a “which agent” switch the web got rid of."],
    ],
  },
  {
    id: "chat",
    name: "Chat",
    note: "One <b>main chat</b> per agent. Answers are plain text on the page, yours are a tint of the agent’s color, and the bars are glass buttons floating over it, as in iOS 26. The agent’s name opens its page.",
    cells: [
      [C1, "The main chat", "The creature in the title acts out what it is doing. One shimmering line says the step, a sub-agent is a chip, and the send button turns into Stop while it works."],
      [C2, "A new agent’s hello", "The egg hatches here once. The starter pills from the web sit under its hello, and the screen is asked for at the tap."],
      [C3, "Writing while it works", "Photos and files attach as thumbnails in the box. What you send mid-answer steers or waits, by the agent’s setting, and the line above says which."],
      [C4, "The + button", "The system’s photo picker, camera and Files, plus a file already in the library. Dictation is the mic in the box, as today."],
    ],
  },
  {
    id: "inchat",
    name: "In a chat",
    note: "Everything the web draws in a conversation and the app today leaves out: <b>asks, screens, commands, sub-agents, visuals and shared pages</b>.",
    cells: [
      [I1, "It asks first", "An approval is a glass card over the box with the three answers. Computer requests, sign-ins and secrets use the same card. A screen in use shows live with Pause and Stop."],
      [I2, "Work in the background", "A command left running unfolds to what it prints, with Stop. Sub-agents at work sit in a pill under the title, and each report opens its own chat."],
      [I3, "Visuals and shared pages", "A visual is drawn in the chat in the app’s colors. A shared page says who can open it and copies its link. This one is a side chat: back goes to the main chat."],
      [I4, "Side chats", "A sheet from the button top right, with its count. A side chat pushes in over the main one, and Archive is in its menu."],
    ],
  },
]
