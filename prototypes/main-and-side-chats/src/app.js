/* Main and side chats mock-up. ../agent-pages/src/head.js (icons, pretend people and agents, the
   creature) opens the function this file closes. */

P.down = '<path d="m6 9 6 6 6-6"/>';
P.sideL = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/>';
P.side = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M15 4.5v15"/>';
P.aside = '<path d="M3.5 5h11.5v8.5H8.5l-3 2.5v-2.5h-2z"/><path d="M18 9h2.5v8.5H19V20l-3-2.5h-4.5v-1"/>';
P.grow = '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>';
P.left = '<path d="m15 6-6 6 6 6"/>';

var app = document.getElementById("app"), strip = document.getElementById("strip");
var SCENES = [
  ["today", "Today"], null,
  ["a", "A · Agents only", true], ["a-menu", "A · menu"], ["a-side", "A · beside"], ["a-full", "A · full"], null,
  ["b", "B · Under the open agent"], ["b-side", "B · side chat"], null,
  ["c", "C · In the agent's panel"], ["c-side", "C · side chat"], null,
  ["mobile", "A on a phone"]
];
var NOTES = {
  today: ["Today.", "Choosing an agent only unfolds it. Then you choose a chat, and none of them is simply the agent. Two levels, and two “new” buttons at the top."],
  a: ["A, recommended.", "The sidebar is agents and nothing else. Choosing one is talking to it: it opens the agent's main chat, one conversation that carries on. Side chats are behind one button on the agent's strip."],
  "a-menu": ["A.", "The agent's side chats, from its strip. They are the agent's business, so they are listed where the agent's other things are, not in the workspace's sidebar."],
  "a-side": ["A.", "A side chat opens at the side, where the agent's panel was. The main chat stays where it is, so it is plain which one is which. Its edge drags, as a document's does."],
  "a-full": ["A.", "A side chat can have the whole middle when it needs the room. A line under the strip says it is a side chat and leads back to the main one."],
  b: ["B, the smallest change.", "Still the sidebar, but only the open agent shows its side chats, with no arrows to fold. The agent's own row is its main chat."],
  "b-side": ["B.", "A side chat takes the middle. The sidebar says where you are; the line under the strip leads back."],
  c: ["C.", "The sidebar is agents only, as in A. Side chats are listed under the creature in the agent's panel. They are out of reach while the panel is hidden."],
  "c-side": ["C.", "Choosing one from the panel puts it in the middle; the panel keeps the list."],
  mobile: ["A on a phone.", "The drawer is the list of agents. Side chats come up as a sheet from the agent's strip, and one pushes in over the main chat with an arrow back."]
};

/* What is on screen: which direction (v), which agent, and which of its side chats, if any. With
   no side chat chosen it is the agent's main chat. */
var view = { v: "a", agent: "pip", side: null, mode: "beside", menu: false, list: true, panel: true, open: { pip: true } };

var SC = {
  pip: [
    { id: "pricing", title: "Pricing page copy", by: "jon", at: "4m", busy: true, here: ["jon"] },
    { id: "invest", title: "Numbers for the investor update", by: "me", at: "1h" },
    { id: "notes", title: "My review notes", by: "me", at: "3h", priv: true },
    { id: "vendor", title: "Vendor contract questions", by: "priya", at: "Tue" },
    { id: "onboard", title: "Onboarding email drafts", by: "maya", at: "Mon" }
  ],
  ledger: [{ id: "inv", title: "October invoices", by: "priya", at: "52m" }, { id: "tax", title: "Sales tax by state", by: "maya", at: "Sep 28" }],
  scout: []
};
var OLDER = { pip: 9, ledger: 4, scout: 0 };
/* What an agent's row says under its name: who is with it, and the latest from it, wherever that was. */
var LINE = {
  pip: { faces: ["maya", "jon"], words: "Working on Pricing page copy", at: "now", busy: true },
  ledger: { faces: [], words: "Priya: can you total October?", at: "52m", unread: true },
  scout: { faces: [], words: "Three launches worth a look this week", at: "Tue" }
};
var MAIN = {
  ledger: [{ day: "Today" }, { by: "priya", at: "1:14 PM", text: "Can you total October?" }, { agent: true, html: "<p>October comes to <b>$48,210</b> across 37 invoices. Two are still unpaid, both from Halvorsen.</p>" }],
  scout: [{ day: "Tuesday" }, { by: "me", at: "4:02 PM", text: "What launched this week?" }, { agent: true, html: "<p>Three launches worth a look this week: a pricing change at Northwind, a new free tier at Corvid, and Halden's public beta.</p>" }]
};
var KEYS = ["pip", "ledger", "scout"];

function mode() { return view.v === "a" ? view.mode : "full"; }
function sideChat() { return view.side ? SC[view.agent].filter((c) => c.id === view.side)[0] : null; }
function spinner(size) { return `<span class="spin mut" title="Working">${ic("ring", size || 13)}</span>`; }

/* ---------- the sidebar ---------- */
function wsHead() {
  return `<div class="ws-h"><button class="wsw" data-do="toast:The workspace menu is as it is today" title="Switch workspace">${tile("T", TEAM.c, 26)}<b class="trunc">Tidewater</b><span class="mut">${ic("sort", 13)}</span></button><button class="ib faces" title="2 online: Maya and Jon">${stack(["maya", "jon"], 18)}</button><button class="ib" data-do="list" title="Hide the sidebar">${ic("sideL", 17)}</button></div>`;
}
function meFoot() {
  return `<div class="side-f me"><button class="prow" data-do="toast:Your menu is as it is today">${face("me", 26, "on")}<span class="grow trunc">Sawyer Hood</span><span class="mut">${ic("sort", 13)}</span></button></div>`;
}
/* One side chat on one line: in the sidebar (B), and in the agent's panel (C). */
function sideRow(key, c) {
  var sel = view.agent === key && view.side === c.id;
  return `<button class="crow one${sel ? " sel" : ""}" data-do="side:${key}:${c.id}"><span class="grow trunc">${esc(c.title)}</span>${c.priv ? ic("lock", 13) : ""}${c.here ? stack(c.here, 18) : ""}<span class="at">${c.busy ? spinner(12) : c.at}</span></button>`;
}
/* An agent, flat: the creature, its name, and one line about it. Choosing it opens its main chat. */
function agentRow(key) {
  var a = AGENTS[key], l = LINE[key], cur = view.agent === key;
  // In B the row is the main chat itself, so it is only lit while the main chat is on screen.
  var sel = cur && (view.v !== "b" || !view.side);
  return `<div class="arow${sel ? " sel" : ""}${cur ? " cur" : ""}" data-do="agent:${key}">${orb(key, 40)}` +
    `<span class="grow"><div class="t"><span class="grow trunc">${a.name}</span><span class="end">${l.busy ? spinner(13) : l.unread ? `${l.at}<span class="new" title="New since you were last here"></span>` : l.at}</span></div>` +
    `<div class="s">${l.faces.length ? stack(l.faces, 16) : ""}<span class="trunc">${esc(l.words)}</span></div></span></div>` +
    (view.v === "b" && cur ? `<nav class="under">${SC[key].length ? `<div class="lb">Side chats</div>` : ""}${SC[key].slice(0, 5).map((c) => sideRow(key, c)).join("")}` +
      `<button class="addrow" data-do="newside">${ic("plus", 14)}<span class="grow">New side chat</span>${OLDER[key] ? `<span data-do="toast:The rest of ${a.name}'s side chats">${OLDER[key]} older</span>` : ""}</button></nav>` : "");
}
function side() {
  return `<aside class="side">${wsHead()}<div class="side-h" style="padding-top:8px"><h2 class="lbl">Agents</h2><button class="ib" data-do="toast:New agent" title="New agent">${ic("plus", 17)}</button></div>` +
    `<div class="chats flat">${KEYS.map(agentRow).join("")}</div>${meFoot()}</aside>`;
}
/* The sidebar as it is today: every agent folds, and its chats are all of a kind. */
function sideToday() {
  var chats = { pip: [{ id: "launch", title: "Launch checklist", at: "now", here: ["maya"] }].concat(SC.pip), ledger: SC.ledger, scout: [{ id: "who", title: "Who else launched this week", at: "Tue" }] };
  var row = (key) => {
    var a = AGENTS[key], open = !!view.open[key];
    return `<div class="brow${open ? " open" : ""}" data-do="fold:${key}"><span class="chev">${ic("right", 13)}</span>${orb(key, 34)}<span class="grow"><div class="t">${a.name}</div><div class="s">${key === "pip" ? stack(["maya", "jon"], 16) + "2 here" : "Quiet"}</div></span></div>` +
      (open ? `<nav class="nest"><div>${chats[key].map((c) => `<button class="crow one${c.id === "launch" ? " sel" : ""}" data-do="toast:Today every chat is one of a list"><span class="grow trunc">${esc(c.title)}</span>${c.priv ? ic("lock", 13) : ""}${c.here ? stack(c.here, 18) : ""}<span class="at">${c.busy ? spinner(12) : c.at}</span></button>`).join("")}</div>${OLDER[key] ? `<button class="more">${OLDER[key]} older chats</button>` : ""}</nav>` : "");
  };
  return `<aside class="side">${wsHead()}<div class="side-h" style="padding-top:8px"><h2 class="lbl">Agents</h2><button class="ib" title="New chat">${ic("note", 17)}</button><button class="ib" title="New agent">${ic("plus", 17)}</button></div>` +
    `<div class="chats">${KEYS.map(row).join("")}</div>${meFoot()}</aside>`;
}

/* ---------- the agent's strip ---------- */
function ahead() {
  var a = AGENTS[view.agent], n = SC[view.agent].length + OLDER[view.agent], today = view.v === "today";
  var busy = SC[view.agent].some((c) => c.busy);
  var t = (label, on) => `<button class="tab${on ? " on" : ""}" data-do="${on ? "main" : "toast:" + label + " is as it is today"}">${label}</button>`;
  return '<header class="ahead">' + (view.list ? "" : `<button class="ib" data-do="list" title="Show the sidebar" style="margin-left:-6px">${ic("sideL", 17)}</button>`) +
    `<button class="who" data-do="toast:Another agent, as today" title="Another agent">${orb(view.agent, 26, { still: true })}<b>${a.name}</b><span class="mut">${ic("down", 13)}</span></button>` +
    (today ? `<button class="ib" title="New chat" style="margin-right:4px">${ic("note", 17)}</button>` : "") +
    `<nav class="tabs">${t("Chat", true)}${t("Library")}${t("Automations")}</nav><span class="grow"></span>` +
    stack(view.agent === "pip" ? ["me", "maya"] : ["me"], 26) +
    (view.v === "a" ? `<button class="scb${view.menu || view.side ? " on" : ""}" data-do="menu" title="${a.name}'s side chats">${busy ? spinner(15) : ic("aside", 17)}Side chats${n ? `<span class="n">${n}</span>` : ""}</button>` : "") +
    `<span class="acts"><button class="ib" data-do="toast:${a.name}'s settings, as today" title="${a.name}'s settings">${ic("gear", 17)}</button>` +
    `<button class="ib${view.panel && !(view.side && mode() === "beside") ? " on" : ""}" data-do="panel" title="${a.name}'s panel">${ic("side", 17)}</button></span></header>`;
}
/* The agent's side chats, from the button on its strip. */
function sideMenu() {
  var a = AGENTS[view.agent], list = SC[view.agent];
  return `<div class="veil" data-do="menu"></div><div class="menu" id="scmenu" style="width:324px"><div class="lb">Side chats with ${a.name}</div>` +
    `<button class="mi new" data-do="newside">${ic("plus", 16)}<span>New side chat</span></button>` + (list.length ? "<hr>" : "") +
    list.map((c) => `<button class="mi${c.id === view.side ? " cur" : ""}" data-do="side:${view.agent}:${c.id}"><span class="grow trunc">${esc(c.title)}</span>${c.priv ? `<span class="mut">${ic("lock", 13)}</span>` : ""}${c.here ? stack(c.here, 18) : ""}<span class="end">${c.busy ? spinner(12) : c.at}</span></button>`).join("") +
    (OLDER[view.agent] ? `<button class="mi" data-do="toast:The rest of ${a.name}'s side chats"><span class="d">${OLDER[view.agent]} older</span></button>` : "") +
    (list.length ? "" : `<p class="hint" style="padding:2px 10px 8px;margin:0">None yet. Start one to keep something out of the main chat, or to ask for something while ${a.name} is busy.</p>`) + "</div>";
}

/* ---------- what is said ---------- */
function message(m) {
  if (m.day) return `<div class="dayd">${m.day}</div>`;
  if (m.ref) return `<button class="aside-ref" data-do="side:pip:${m.ref}">${ic("aside", 16)}<span>${m.words} <b>${esc(SC.pip.filter((c) => c.id === m.ref)[0].title)}</b></span>${spinner(12)}</button>`;
  if (m.tool) return `<div class="m"><div class="tool"><span class="shine">${m.tool}</span></div></div>`;
  if (m.agent) return `<div class="m"><div class="prose">${m.html}</div></div>`;
  var mine = m.by === "me";
  return `<div class="m h${mine ? " me" : ""}">${mine ? "" : `<div class="who"><b>${PEOPLE[m.by].full}</b>${m.at}</div>`}<div class="line"><div class="bub">${esc(m.text)}</div>${mine ? "" : face(m.by, 30)}</div></div>`;
}
/* The main chat does not start over: yesterday is above today. */
function mainTalk() {
  if (view.agent !== "pip") return MAIN[view.agent];
  if (view.v === "today") return msgs;
  return [{ day: "Yesterday" }, { by: "maya", at: "5:40 PM", text: "Remind everyone on Thursday morning that we ship at noon." }, { agent: true, html: "<p>I will, at 9:00 on Thursday, here in this chat.</p>" },
    { day: "Today" }, { ref: "pricing", words: "Jon took this to a side chat:" }].concat(msgs);
}
function sideTalk(c) {
  var a = AGENTS[view.agent];
  if (c.fresh) return null;
  if (c.id === "pricing") return [
    { by: "jon", at: "1:48 PM", text: "Draft the Team plan section for the pricing page. $24 a seat, billed yearly." },
    { agent: true, html: "<p>A first pass:</p><p><b>Team · $24 a seat</b><br>Everything in Solo, and agents your whole team shares: one memory, one library, everyone's chats.</p>" },
    { by: "jon", at: "2:01 PM", text: "Shorter. And say what happens past ten seats." },
    { tool: "Rewriting pricing-page.md" }
  ];
  return [{ by: c.by, at: c.at, text: "Where did we leave “" + c.title + "”?" }, { agent: true, html: "<p>Here is where “" + esc(c.title) + "” stands. This side chat is a stand-in: it has its own conversation, and what " + a.name + " remembers is the same here as in the main chat.</p>" }];
}
function talk(list, a) {
  if (!list) return `<div class="center mut" style="padding:40px 28px">${ic("aside", 26)}<p style="max-width:300px;margin-top:8px">A side chat keeps its own conversation. ${a.name} brings what it remembers, and the main chat stays as it was.</p></div>`;
  return `<div class="msgs">${list.map(message).join("")}</div>`;
}
function composer(words) {
  return `<div class="foot"><div class="comp"><textarea placeholder="${words}"></textarea><div class="r"><button class="ib" title="Attach">${ic("clip", 17)}</button><span class="grow"></span><button class="send" data-do="toast:Only the navigation works in this mock-up" title="Send">${ic("up", 17)}</button></div></div></div>`;
}
/* The line under the strip while a side chat has the middle. */
function subbar(c, phone) {
  return `<div class="subbar"><button class="back" data-do="main">${ic("left", 15)}Main chat</button>${phone ? "" : '<span class="k">Side chat</span>'}<b class="trunc">${esc(c.title)}</b>${c.priv ? `<span class="mut">${ic("lock", 13)}</span>` : ""}<span class="grow"></span>${c.here ? stack(c.here, 22) : ""}` +
    (view.v === "a" && !phone ? `<button class="ib" data-do="mode:beside" title="Put it beside the main chat">${ic("side", 16)}</button>` : "") + (phone ? "" : `<button class="ib" data-do="toast:Rename, make private, archive" title="More">${ic("dots", 16)}</button>`) + "</div>";
}
function middle() {
  var a = AGENTS[view.agent], c = sideChat(), full = c && mode() === "full";
  return `<div class="acol">${ahead()}${full ? subbar(c) : ""}<div class="chat"><div class="scroll">${talk(full ? sideTalk(c) : mainTalk(), a)}</div>` +
    composer(full ? `Message ${a.name} in this side chat` : `Message ${a.name}`) + "</div></div>";
}
/* A side chat at the side (A): the main chat is still there, to its left. */
function sideColumn(c) {
  var a = AGENTS[view.agent];
  return `<aside class="sidechat"><header class="sc-h">${orb(view.agent, 28, { still: true })}<div class="grow"><div class="k">Side chat with ${a.name}</div><div class="n trunc">${esc(c.title)}</div></div>${c.priv ? `<span class="mut">${ic("lock", 14)}</span>` : ""}${c.here ? stack(c.here, 22) : ""}` +
    `<button class="ib" data-do="mode:full" title="Give it the whole chat">${ic("grow", 16)}</button><button class="ib" data-do="main" title="Close the side chat">${ic("x", 16)}</button></header>` +
    `<div class="scroll">${talk(sideTalk(c), a)}</div>${composer("Message " + a.name + " in this side chat")}</aside>`;
}
function panel() {
  var a = AGENTS[view.agent], here = view.agent === "pip" ? ["me", "maya"] : ["me"], list = SC[view.agent];
  var run = (r) => `<div class="run"><span class="mut">${ic("okc", 16)}</span><div class="grow"><div class="t">${esc(r.title)}</div><div class="s">${face(r.by, 15)}for ${r.by === "me" ? "you" : PEOPLE[r.by].name} · ${r.at} · ${r.steps} steps</div></div></div>`;
  return `<aside class="panel"><div class="top">${orb(view.agent, view.v === "c" ? 168 : 208, { id: "main" })}<button class="pname" data-do="toast:${a.name}'s settings, as today">${a.name}<span class="mut">${ic("gear", 14)}</span></button><p>${view.v !== "today" && SC[view.agent].some((c) => c.busy) ? "Working in a side chat" : "Ready"}</p><p class="tag">${a.tag}</p></div>` +
    (view.v === "c" ? `<div class="sec"><h3><span>Side chats</span><span class="ib" data-do="newside" title="New side chat">${ic("plus", 15)}</span></h3>${list.slice(0, 5).map((c) => sideRow(view.agent, c)).join("")}` +
      (list.length ? "" : `<p class="mut" style="font-size:13px;padding:0 8px 4px">None yet.</p>`) + (OLDER[view.agent] ? `<button class="more" data-do="toast:The rest of ${a.name}'s side chats">${OLDER[view.agent]} older</button>` : "") + "</div>" :
      `<div class="sec"><h3><span>Here now</span><button>Invite</button></h3><div class="hererow">${here.map((id) => face(id, 28, "on")).join("")}<span class="grow w">${names(here)}</span></div></div>`) +
    `<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>What it did here</h3>${view.agent === "pip" ? runs.map(run).join("") : run({ title: "Answered in the main chat", by: "me", at: LINE[view.agent].at, steps: 1 })}</div></aside>`;
}

/* ---------- A on a phone ---------- */
function mobileScene() {
  var c = SC.pip[0], keep = view.agent;
  view.agent = "pip";
  var top = `<div class="m-top"><button class="ib">${ic("list", 18)}</button><span class="who">${orb("pip", 24, { still: true })}<b>Pip</b><span class="mut">${ic("down", 12)}</span></span><span class="grow"></span><span class="scb" style="margin:0;padding:0 7px">${spinner(15)}<span class="n">14</span></span><button class="ib">${ic("gear", 17)}</button></div>`;
  var tabs = `<nav class="tabs m-tabs">${["Chat", "Library", "Automations"].map((t) => `<span class="tab${t === "Chat" ? " on" : ""}">${t}</span>`).join("")}</nav>`;
  var comp = (w) => `<div class="foot"><div class="comp"><textarea placeholder="${w}"></textarea><div class="r"><span class="mut">${ic("clip", 16)}</span><span class="grow"></span><span class="send">${ic("up", 16)}</span></div></div></div>`;
  var chat = `<div class="scroll"><div class="msgs">${[{ day: "Today" }].concat(msgs.slice(0, 3)).map(message).join("")}</div></div>` + comp("Message Pip");
  var arow = (key) => { var l = LINE[key]; return `<div class="arow${key === "pip" ? " sel" : ""}">${orb(key, 36)}<span class="grow"><div class="t"><span class="grow trunc">${AGENTS[key].name}</span><span class="end">${l.busy ? spinner(13) : l.at}</span></div><div class="s">${l.faces.length ? stack(l.faces, 15) : ""}<span class="trunc">${esc(l.words)}</span></div></span></div>`; };
  var drawer = `<div class="m-dim"></div><div class="m-drawer"><div class="m-top">${tile("T", TEAM.c, 28)}<b>Tidewater</b>${ic("sort", 13)}<span class="grow"></span>${stack(["maya", "jon"], 18)}</div>` +
    `<div class="side-h" style="padding:8px 12px 4px 16px"><h2 class="lbl">Agents</h2><span class="ib">${ic("plus", 17)}</span></div><div class="chats flat">${KEYS.map(arow).join("")}</div>` +
    `<div class="side-f me"><span class="prow">${face("me", 26, "on")}<span class="grow trunc">Sawyer Hood</span><span class="mut">${ic("sort", 13)}</span></span></div></div>`;
  var sheet = `<div class="m-dim"></div><div class="m-sheet"><div class="lb">Side chats with Pip</div><span class="mi new" style="color:var(--teal-text)">${ic("plus", 16)}New side chat</span>` +
    SC.pip.map((x) => `<span class="mi"><span class="grow trunc">${esc(x.title)}</span>${x.priv ? `<span class="mut">${ic("lock", 13)}</span>` : ""}${x.here ? stack(x.here, 18) : ""}<span class="d">${x.busy ? spinner(12) : x.at}</span></span>`).join("") + `<span class="mi"><span class="d">9 older</span></span></div>`;
  var one = top + tabs + subbar(c, true) + `<div class="scroll"><div class="msgs">${sideTalk(c).map(message).join("")}</div></div>` + comp("Message Pip in this side chat");
  var phone = (inner, title, words) => `<figure class="phone-w"><div class="phone">${inner}</div><figcaption><b>${title}</b>${words}</figcaption></figure>`;
  view.agent = keep;
  return `<div class="phones">` +
    phone(top + tabs + chat, "The agent", "Opening the app is opening the agent you were last with, in its main chat. The spinner and count at the top are its side chats.") +
    phone(top + tabs + chat + drawer, "The agents", "The drawer is a list of agents, as a messaging app lists people. No chats in it.") +
    phone(top + tabs + chat + sheet, "Its side chats", "From the count on the strip, as a sheet.") +
    phone(one, "A side chat", "Pushed in over the main chat. The line under the tabs leads back.") + "</div>";
}

/* ---------- drawing and what the buttons do ---------- */
function sceneOf() {
  if (view.v === "today" || view.v === "mobile") return view.v;
  if (view.v === "a") return view.menu ? "a-menu" : view.side ? (view.mode === "beside" ? "a-side" : "a-full") : "a";
  return view.side ? view.v + "-side" : view.v;
}
function render() {
  var s = sceneOf(), c = sideChat(), beside = c && mode() === "beside";
  var base = view.v === "mobile" ? mobileScene()
    : view.v === "today" ? (view.list ? sideToday() : "") + `<div class="main">${middle()}${view.panel ? panel() : ""}</div><div class="note-card"><b>Today.</b> An agent's row only folds and unfolds. Which chat is “the” agent?</div>`
    : (view.list ? side() : "") + `<div class="main">${middle()}${beside ? sideColumn(c) : view.panel ? panel() : ""}</div>`;
  app.innerHTML = base + (view.menu ? sideMenu() : "");
  var menu = document.getElementById("scmenu"), at = document.querySelector('.scb[data-do="menu"]');
  if (menu && at) { var r = at.getBoundingClientRect(); menu.style.left = Math.max(8, r.right - menu.offsetWidth) + "px"; menu.style.top = r.bottom + 6 + "px"; }
  strip.innerHTML = "<b>Mock-up</b>" + SCENES.map((x) => x ? `<button class="${x[0] === s ? "on" : ""}" data-do="scene:${x[0]}">${x[1]}${x[2] ? '<span class="rec">pick</span>' : ""}</button>` : "<i></i>").join("") +
    '<span class="sp"></span><button data-do="theme">Light / dark</button>' + `<div class="note"><b>${NOTES[s][0]}</b>${NOTES[s][1]}</div>`;
  if (location.hash !== "#" + s) history.replaceState(null, "", "#" + s);
  mountOrbs();
}
/* A scene from the strip, or from the address: set up so that it shows what it is named for. */
function show(scene) {
  var p = scene.split("-");
  view.v = p[0]; view.agent = "pip"; view.list = view.panel = true;
  view.menu = scene === "a-menu";
  view.side = p[1] === "side" || p[1] === "full" ? "pricing" : null;
  if (view.v === "a") view.mode = p[1] === "full" ? "full" : "beside";
  render();
}
function toast(words) {
  var t = document.createElement("div"); t.className = "toast"; t.textContent = words; app.appendChild(t);
  setTimeout(function () { t.remove(); }, 2000);
}
var made = 0;
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-do]");
  if (!el) return;
  var d = el.dataset.do.split(":"), a = d[0], v = d.slice(1).join(":");
  e.stopPropagation();
  if (a === "toast") return toast(v);
  if (a === "scene") return show(v);
  if (a === "agent") { view.agent = v; view.side = null; view.menu = false; }
  else if (a === "side") { view.agent = d[1]; view.side = d[2]; view.menu = false; }
  else if (a === "main") { view.side = null; view.menu = false; }
  else if (a === "mode") view.mode = v;
  else if (a === "menu") view.menu = !view.menu;
  else if (a === "newside") { made += 1; SC[view.agent].unshift({ id: "new" + made, title: "New side chat", by: "me", at: "now", fresh: true }); view.side = "new" + made; view.menu = false; }
  else if (a === "fold") view.open[v] = !view.open[v];
  else if (a === "list") view.list = !view.list;
  else if (a === "panel") { if (view.side && mode() === "beside") { view.side = null; view.panel = true; } else view.panel = !view.panel; }
  else if (a === "theme") document.documentElement.classList.toggle("dark");
  render();
});
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && view.menu) { view.menu = false; render(); } });
window.addEventListener("hashchange", function () { var s = location.hash.slice(1); if (NOTES[s] && s !== sceneOf()) show(s); });

resetChat();
var first = location.hash.slice(1);
show(NOTES[first] ? first : "a");
})();
