/* Agent pages mock-up. src/head.js (icons, pretend people and agents, the creature) comes from the
   teams mock-up and opens the function this file closes. */

P.home = '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>';
P.book = '<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>';
P.chart = '<path d="M4 20h16M7 20v-6M12 20V6M17 20v-9"/>';
P.trash = '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>';
P.cpu = '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>';
P.file = '<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/>';
P.out = '<path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9"/>';
P.down = '<path d="m6 9 6 6 6-6"/>';
P.cog = '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>';
P.sideL = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/>';
P.side = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M15 4.500v15"/>';

var app = document.getElementById("app"), strip = document.getElementById("strip");
var SCENES = [["chat", "Chat"], ["collapsed", "Sidebar hidden"], ["switcher", "Agent switcher"], ["library", "Library tab"], ["automations", "Automations tab"], ["settings", "Agent settings"], ["rowmenu", "Agent menu"], ["account", "Your menu"], ["wsettings", "Workspace settings"], ["members", "Members"], ["wcomputers", "Computers"], ["mobile", "Mobile"], ["before", "Before"]];
/* What is on screen is a base (a tab of the agent, or a page of the workspace) and, at times,
   something open over it (a menu or a settings window). */
var AGENT = { chat: 1, library: 1, automations: 1 }, OVER = { settings: 1, wsettings: 1, rowmenu: 1, switcher: 1, account: 1 };
var view = { scene: "chat", base: "chat", over: null, tab: "chat", list: true, panel: true, rowmenu: null, agent: "pip", chat: "launch", open: { pip: true }, sec: "identity", wsec: "general" };

var SIDE = {
  pip: { sub: "2 here", chats: CHATS, older: 14 },
  ledger: { sub: "Quiet · Priya, 52m ago", older: 6, chats: [{ id: "inv", title: "October invoices", by: "priya", at: "52m" }, { id: "close", title: "Closing the third quarter", by: "me", at: "Mon" }, { id: "tax", title: "Sales tax by state", by: "maya", at: "Sep 28" }] },
  scout: { sub: "Quiet · Jon, Tuesday", chats: [{ id: "who", title: "Who else launched this week", by: "jon", at: "Tue" }, { id: "comp", title: "What competitors charge", by: "maya", at: "Sep 30" }] }
};
var LIB = {
  pip: [["launch", ["launch-checklist.md", "launch-email.md", "pricing-page.md"]], ["notes", ["standup-notes.md", "who-owns-what.md"]]],
  ledger: [["invoices", ["october.csv", "september.csv"]], ["reports", ["weekly-numbers.md", "q3-close.md"]]],
  scout: [["reading", ["launches-this-week.md", "competitor-prices.md"]]]
};
var AUTO = {
  pip: [["Morning launch summary", "Every weekday at 9:00 AM", "Tomorrow, 9:00 AM", true], ["Chase open checklist items", "Every Wednesday at 2:00 PM", "Wed, 2:00 PM", true], ["Archive finished chats", "First of the month", "Nov 1", false]],
  ledger: [["Weekly numbers", "Every Monday at 8:00 AM", "Mon, 8:00 AM", true], ["Invoice reminders", "Every day at 10:00 AM", "Tomorrow, 10:00 AM", true]],
  scout: [["What launched this week", "Every Friday at 4:00 PM", "Fri, 4:00 PM", true]]
};
var SECTIONS = [["identity", "Identity", "user"], ["memory", "Memory", "book"], ["model", "Model and computer", "cpu"], ["skills", "Skills", "bolt"], ["connectors", "Connectors", "plug"], ["permissions", "Permissions", "shield"], ["usage", "Usage", "chart"]];

function tab() { return view.tab; }
/* Whether the sidebar is showing. It is the same on every tab: the frame does not change when
   the tab does, only what is in the middle and in the column on the right. */
function listOpen() { return view.list; }
function tg(on) { return `<button class="tg${on ? " on" : ""}" data-do="tg" aria-label="On or off"></button>`; }
function pick(options, cur) { return `<select class="pick">${options.map((o) => `<option${o === cur ? " selected" : ""}>${o}</option>`).join("")}</select>`; }
function li(icon, name, desc, end) { return `<div class="li">${icon}<div class="grow"><div class="n">${name}</div><div class="d">${desc}</div></div>${end || ""}</div>`; }

/* The rail as it is today, for the "Before" scene. The design itself no longer has one. */
function oldRail() {
  var nav = [["chat", "Agents and chats"], ["folder", "Library"], ["clock", "Automations"], ["bolt", "Skills"], ["plug", "Connectors"], ["desktop", "Computers"], ["shield", "Permissions"], ["user", "Identity and memory"]];
  return `<aside class="rail"><button class="wsb">${tile("T", TEAM.c, 36)}<span class="ch">${ic("sort", 10)}</span></button><hr>` +
    `<div class="mine">${nav.map((n, i) => `<button class="rb${i === 0 ? " on" : ""}" title="${n[1]}">${ic(n[0], 20)}</button>`).join("")}</div>` +
    `<span class="sp"></span><button class="rb" title="People">${ic("users", 20)}<span class="n">2</span></button><button class="rb" title="Settings">${ic("gear", 20)}</button><button class="rb">${ic("sun", 20)}</button><button class="rb">${face("me", 28, "on")}</button></aside>`;
}

/* ---------- the one sidebar: the workspace at the top, then its agents with their chats ---------- */
function chatRow(key, c) {
  var sel = AGENT[view.base] && tab() === "chat" && view.agent === key && view.chat === c.id || view.base === "before" && c.id === "launch";
  var here = key === "pip" ? inChat(c.id).filter((id) => id !== "me") : [];
  return `<button class="crow one${sel ? " sel" : ""}" data-do="chat:${key}:${c.id}"><span class="grow trunc">${esc(c.title)}</span>${c.priv ? ic("lock", 13) : ""}${here.length ? stack(here, 18) : ""}<span class="at">${c.at}</span></button>`;
}
function side(old) {
  var row = (key) => {
    var a = AGENTS[key], s = SIDE[key], open = !!view.open[key];
    return `<div class="brow${open ? " open" : ""}${view.over === "rowmenu" && view.rowmenu === key ? " hot" : ""}" data-do="fold:${key}"><span class="chev">${ic("right", 13)}</span>${orb(key, 34, { still: true })}` +
      `<span class="grow"><div class="t">${a.name}</div><div class="s">${key === "pip" ? stack(["maya", "jon"], 16) : ""}${s.sub}</div></span>` +
      `<span class="ib" data-do="rowmenu:${key}" title="${a.name}'s pages">${ic("dots", 16)}</span><span class="ib" data-do="toast:New chat with ${a.name}" title="New chat with ${a.name}">${ic("note", 16)}</span></div>` +
      (open ? `<nav class="nest"><div>${s.chats.map((c) => chatRow(key, c)).join("")}</div>${s.older ? `<button class="more">${s.older} older chats</button>` : ""}</nav>` : "");
  };
  var agents = `<input class="search" placeholder="Search agents and chats"><div class="chats">${row("pip")}${row("ledger")}${row("scout")}</div>`;
  if (old) return `<aside class="side"><div class="side-h"><h2>Agents</h2><button class="ib" title="New agent">${ic("plus", 17)}</button></div>${agents}</aside>`;
  // On the Library tab the list is that agent's files. The rest of the sidebar, its width and
  // everything to the right of it stay as they were.
  var cur = AGENTS[view.agent], groups = LIB[view.agent];
  var mid = AGENT[view.base] && view.tab === "library"
    ? `<div class="side-h lib-h"><button class="ib" data-do="go:chat" title="Back to agents and chats" style="transform:rotate(180deg)">${ic("right", 15)}</button>${orb(view.agent, 22, { still: true })}<h2>${cur.name}'s library</h2><button class="ib" title="New file">${ic("plus", 17)}</button></div>` +
      `<input class="search" placeholder="Search ${cur.name}'s files"><div class="chats">${groups.map((g) => `<div class="h2" style="margin:12px 8px 4px">${ic("folder", 14)}${g[0]}</div>` + g[1].map((f) => `<button class="sn${f === groups[0][1][0] ? " on" : ""}">${ic("file", 15)}<span class="mono trunc">${f}</span></button>`).join("")).join("")}</div>`
    : `<div class="side-h" style="padding-top:8px"><h2 class="lbl">Agents</h2><button class="ib" title="New agent">${ic("plus", 17)}</button></div>${agents}`;
  return `<aside class="side"><div class="ws-h"><button class="wsw" data-do="toast:The workspace menu is as in the teams mock-up" title="Switch workspace">${tile("T", TEAM.c, 26)}<b class="trunc">Tidewater</b><span class="mut">${ic("sort", 13)}</span></button><button class="ib faces" data-do="ws:members" title="2 online: Maya and Jon">${stack(["maya", "jon"], 18)}</button><button class="ib" data-do="list" title="Hide the sidebar">${ic("sideL", 17)}</button></div>` +
    mid +
    `<div class="side-f me"><button class="prow${view.over === "account" ? " open" : ""}" data-do="account" title="You, and this workspace's settings">${face("me", 26, "on")}<span class="grow trunc">Sawyer Hood</span><span class="mut">${ic("sort", 13)}</span></button></div></aside>`;
}
function rowMenu() {
  var key = view.rowmenu, a = AGENTS[key];
  var mi = (icon, label, scene) => `<button class="mi" data-do="agent:${key}:${scene}">${ic(icon, 17)}<span>${label}</span></button>`;
  return `<div class="veil" data-do="close"></div><div class="menu" id="rowmenu" style="width:220px"><div class="lb">${a.name}</div>` +
    `<button class="mi" data-do="toast:New chat with ${a.name}">${ic("note", 17)}<span>New chat</span></button><hr>` +
    mi("folder", "Library", "library") + mi("clock", "Automations", "automations") + mi("gear", "Settings", "settings") + "</div>";
}
/* Your name at the foot of the sidebar: the way into the workspace's settings, and out. */
function accountMenu() {
  var dark = document.documentElement.classList.contains("dark");
  return `<div class="veil" data-do="close"></div><div class="menu" id="accountmenu" style="width:272px"><div class="mi" style="pointer-events:none">${face("me", 32)}<span class="grow"><div>Sawyer Hood</div><div class="d">sawyer@tidewater.studio</div></span></div><hr>` +
    `<button class="mi" data-do="ws:general">${ic("cog", 17)}<span class="grow">Workspace settings</span><span class="d">Tidewater</span></button>` +
    `<button class="mi" data-do="ws:members">${ic("users", 17)}<span>Invite people</span></button>` +
    `<button class="mi" data-do="theme">${ic(dark ? "sun" : "moon", 17)}<span>${dark ? "Light" : "Dark"} theme</span></button><hr>` +
    `<button class="mi" data-do="toast:Only the navigation works in this mock-up">${ic("out", 17)}<span>Log out</span></button></div>`;
}
/* The agent's name in its strip: another agent, or another chat, without opening the sidebar. */
function switchMenu() {
  var a = AGENTS[view.agent];
  return `<div class="veil" data-do="close"></div><div class="menu" id="switchmenu" style="width:300px"><div class="lb">Agents in Tidewater</div>` +
    ["pip", "ledger", "scout"].map((k) => `<button class="mi${k === view.agent ? " cur" : ""}" data-do="agent:${k}:chat">${orb(k, 28, { still: true })}<span class="grow"><div>${AGENTS[k].name}</div><div class="d"><span class="trunc">${AGENTS[k].tag}</span></div></span>${k === view.agent ? ic("check", 16) : ""}</button>`).join("") +
    `<hr><div class="lb">Recent chats with ${a.name}</div>` +
    SIDE[view.agent].chats.slice(0, 4).map((c) => `<button class="mi${c.id === view.chat ? " cur" : ""}" data-do="chat:${view.agent}:${c.id}"><span class="grow trunc">${esc(c.title)}</span><span class="d">${c.at}</span></button>`).join("") +
    `<hr><button class="mi" data-do="toast:New chat with ${a.name}">${ic("note", 17)}<span>New chat</span></button></div>`;
}

/* ---------- the agent's own strip: the pages that belong to the selected agent ---------- */
function ahead() {
  var a = AGENTS[view.agent], cur = tab(), open = listOpen();
  var t = (id, label) => `<button class="tab${cur === id ? " on" : ""}" data-do="go:${id}">${label}</button>`;
  var here = view.agent === "pip" ? inChat(view.chat) : ["me"];
  var c = SIDE[view.agent].chats.filter((x) => x.id === view.chat)[0];
  return '<header class="ahead">' + (open ? "" : `<button class="ib" data-do="list" title="Show the sidebar" style="margin-left:-6px">${ic("sideL", 17)}</button>`) +
    `<button class="who${view.over === "switcher" ? " open" : ""}" data-do="switcher" title="Another agent or chat">${orb(view.agent, 26, { still: true })}<b>${a.name}</b><span class="mut">${ic("down", 13)}</span></button>` +
    // With the sidebar hidden nothing else says which chat this is.
    (!open && cur === "chat" && c ? `<span class="mut">/</span><span class="crumb trunc">${esc(c.title)}</span>` : "") +
    `<nav class="tabs">${t("chat", "Chat")}${t("library", "Library")}${t("automations", "Automations")}</nav><span class="grow"></span>` +
    // The end of the strip is the same three things on every tab. Being shared is the rule in a
    // team, so only the exception is said: a chat that is yours alone.
    (cur === "chat" ? (c && c.priv ? `<span class="pill ghost">${ic("lock", 14)}Only you</span>` : stack(here, 26)) : "") +
    `<span class="acts"><button class="ib" data-do="go:settings" title="${a.name}'s settings">${ic("gear", 17)}</button>` +
    `<button class="ib${view.panel ? " on" : ""}" data-do="panel" title="${view.panel ? "Hide" : "Show"} ${a.name}">${ic("side", 17)}</button></span></header>`;
}
function message(m) {
  if (m.agent) return `<div class="m"><div class="prose">${m.html}</div></div>`;
  var mine = m.by === "me";
  return `<div class="m h${mine ? " me" : ""}">${mine ? "" : `<div class="who"><b>${PEOPLE[m.by].full}</b>${m.at}</div>`}<div class="line"><div class="bub">${esc(m.text)}</div>${mine ? "" : face(m.by, 30)}</div></div>`;
}
function transcript() {
  if (view.agent === "pip" && view.chat === "launch") return msgs.map(message).join("");
  var c = SIDE[view.agent].chats.filter((x) => x.id === view.chat)[0] || SIDE[view.agent].chats[0];
  return [{ by: c.by, at: c.at, text: "Where did we leave “" + c.title + "”?" }, { agent: true, html: "<p>Here is where “" + esc(c.title) + "” stands. This chat is only a stand-in: the point of this mock-up is the strip above, which follows whichever agent the chat belongs to.</p>" }].map(message).join("");
}
function chatBody() {
  var a = AGENTS[view.agent];
  return `<div class="chat"><div class="scroll"><div class="msgs">${transcript()}</div></div><div class="foot"><div class="typing"></div>` +
    `<div class="comp"><textarea id="box" placeholder="Message ${a.name}"></textarea><div class="r"><button class="ib" title="Attach">${ic("clip", 17)}</button><span class="grow"></span><button class="send" data-do="toast:Only the navigation works in this mock-up" title="Send">${ic("up", 17)}</button></div></div></div></div>`;
}
function panel(old, auto) {
  var a = AGENTS[view.agent], here = view.agent === "pip" ? inChat(view.chat) : ["me"];
  var run = (r) => `<div class="run"><span class="mut">${ic("okc", 16)}</span><div class="grow"><div class="t">${esc(r.title)}</div><div class="s">${face(r.by, 15)}for ${r.by === "me" ? "you" : PEOPLE[r.by].name} · ${r.at} · ${r.steps} steps</div></div></div>`;
  var rows = auto === "library" ? LIB[view.agent][0][1].map((f, i) => [f, ["Changed by " + a.name + " · 2:05 PM", "Changed by Jon · 1h ago", "Changed by Maya · Monday"][i] || "Changed last week", "file"]) : AUTO[view.agent].filter((x) => x[3]).map((x) => [x[0], x[2], "clock"]);
  return `<aside class="panel">${old ? `<button class="ib x" title="Hide">${ic("x", 15)}</button>` : ""}<div class="top">${orb(view.agent, 208, { id: "main" })}` +
    (old ? `<h2>${a.name}</h2>` : `<button class="pname" data-do="go:settings" title="${a.name}'s settings">${a.name}<span class="mut">${ic("gear", 14)}</span></button>`) +
    `<p>Ready</p><p class="tag">${a.tag}</p></div>` +
    (auto ? `<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>${auto === "library" ? "Lately in the library" : "Next up"}</h3>${rows.map((x) => `<div class="run"><span class="mut">${ic(x[2], 16)}</span><div class="grow"><div class="t${auto === "library" ? " mono" : ""}">${x[0]}</div><div class="s">${x[1]}</div></div></div>`).join("")}</div></aside>` :
    `<div class="sec"><h3><span>Here now</span><button>Invite</button></h3><div class="hererow">${here.map((id) => face(id, 28, "on")).join("")}<span class="grow w">${names(here)}</span></div></div>` +
    `<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>What it did here</h3>${view.agent === "pip" ? runs.map(run).join("") : run({ title: "Picked the chat back up", by: "me", at: "now", steps: 1 })}</div></aside>`);
}

/* ---------- Library and Automations: the agent's other two tabs ---------- */
/* The library's files are listed in the sidebar (see side); this is the file that is open. */
function libraryBody() {
  var a = AGENTS[view.agent], groups = LIB[view.agent], first = groups[0][1][0];
  var doc = view.agent === "pip"
    ? "<p>What has to be true before Thursday.</p><ul><li>☑ Changelog written</li><li>☑ Billing switched to the new plans</li><li>☐ <b>Pricing page copy</b>: Jon, draft not yet approved</li><li>☐ <b>Status page</b>: Sawyer, due Wednesday</li><li>☐ <b>Launch email</b>: waiting on the final price</li></ul>"
    : "<p>" + a.name + " keeps this file up to date as it works. Anyone in Tidewater can read it or change it.</p>";
  return `<div class="page"><div class="col" style="padding-top:36px"><div class="mono mut" style="margin-bottom:14px">${groups[0][0]}/${first}</div><div class="prose"><h1 style="font-size:24px;font-weight:600;letter-spacing:-.01em">${view.agent === "pip" ? "Launch checklist" : first}</h1>${doc}</div></div></div>`;
}
function automationsBody() {
  var a = AGENTS[view.agent];
  return `<div class="page"><div class="col" style="padding-top:32px"><div class="sh" style="display:flex;align-items:center;gap:16px"><div class="grow"><h1>${a.name}'s automations</h1><p>Things ${a.name} does on a schedule, without being asked.</p></div><button class="btn pri">${ic("plus", 16)}New automation</button></div>` +
    `<div class="box">${AUTO[view.agent].map((x) => li(`<span class="mut">${ic("clock", 18)}</span>`, x[0], `${x[1]} · next: ${x[3] ? x[2] : "paused"}`, tg(x[3]))).join("")}</div></div></div>`;
}

/* ---------- the agent's settings: what used to be four pages on the rail ---------- */
function section(s) {
  var a = AGENTS[view.agent];
  var head = (title, words) => `<div class="sh"><h1>${title}</h1><p>${words}</p></div>`;
  if (s === "identity") return head("Identity", `Who ${a.name} is: how it looks and how it talks.`) +
    `<div style="display:flex;gap:20px;align-items:center">${orb(view.agent, 96)}<div class="grow"><label class="lab" style="margin-top:0">Name</label><input class="field" value="${a.name}"></div></div>` +
    `<label class="lab">Look</label><div class="sw" style="--popover:var(--background)">${["#5f8a4e", "#c9952c", "#3f7f9c", "#c0607a", "#7d5a9a", "#b8674a", "#2f3a52"].map((c) => `<button class="${c === a.color ? "on" : ""}" style="--c:${c}"></button>`).join("")}</div>` +
    `<label class="lab">What it is for</label><input class="field" value="${a.tag}">` +
    `<label class="lab">Personality</label><textarea class="area">Brisk and plain-spoken. Says what is still open before what is done. Never pads an answer.</textarea>` +
    `<label class="lab">About the team <span class="badge">was “About you”</span></label><textarea class="area">Tidewater is four people shipping a pricing change on Thursday. Maya runs the launch, Jon writes the copy, Priya keeps the books.</textarea>`;
  if (s === "memory") return head("Memory", `What ${a.name} has learned and keeps between chats. It is shared: what it learns from one of you, it knows with all of you.`) +
    `<div class="box">${[["The Team plan is $24 a seat", "From Jon · today"], ["Launch day is Thursday; nothing ships on Fridays", "From Maya · Monday"], ["Sawyer owns the status page", "From you · today"], ["Priya prefers numbers as a table, not prose", "From Priya · Sep 30"]].map((m) => li(`<span class="mut">${ic("book", 17)}</span>`, m[0], m[1], `<button class="btn sm quiet">Edit</button><button class="btn sm quiet bad">Forget</button>`)).join("")}</div>` +
    `<p class="hint">If people end up reading this often, it could be a tab beside Library instead.</p>`;
  if (s === "model") return head("Model and computer", `What ${a.name} thinks with, and where it keeps files and runs commands.`) +
    `<div class="box">${li("", "Model", "New agents start on the workspace's default.", pick(["Claude Opus 5.5", "Claude Sonnet 5.5", "Claude Haiku 4.5"], "Claude Sonnet 5.5"))}${li("", "Thinking", "How long it may think before answering.", pick(["Off", "Low", "Medium", "High"], "Medium"))}${li("", "Computer", "Its own machine, for files and commands.", pick(["Cloud sandbox", "Sawyer's MacBook"], "Cloud sandbox"))}</div>`;
  if (s === "skills") return head("Skills", `Instructions ${a.name} can pick up when a task calls for them.`) +
    `<div class="box">${[["launch-checklist", "Keeps the checklist file in order and chases owners"], ["release-notes", "Writes release notes from merged work"], ["weekly-summary", "Sums up the week's chats for the team"]].map((k) => li(`<span class="mut">${ic("bolt", 17)}</span>`, `<span class="mono">${k[0]}</span>`, k[1], tg(true))).join("")}</div>` +
    `<button class="btn" style="margin-top:14px">${ic("plus", 16)}Add a skill</button>`;
  if (s === "connectors") return head("Connectors", `Other services ${a.name} can reach. A teammate who uses one acts through whoever connected it.`) +
    `<div class="box">${li(`<span class="mut">${ic("plug", 17)}</span>`, "GitHub", "Connected by Maya · 2 repositories", `<button class="btn sm quiet bad">Disconnect</button>`)}${li(`<span class="mut">${ic("plug", 17)}</span>`, "Linear", "Connected by you", `<button class="btn sm quiet bad">Disconnect</button>`)}${li(`<span class="mut">${ic("plug", 17)}</span>`, "Google Drive", "Not connected", `<button class="btn sm">Connect</button>`)}</div>` +
    `<button class="btn" style="margin-top:14px">${ic("plus", 16)}Add a connector</button>`;
  if (s === "permissions") {
    var p = (n, cur) => li("", n, "", pick(["Always ask", "Allow", "Never"], cur));
    return head("Permissions", `What ${a.name} may do without asking first.`) +
      `<div class="h2" style="margin-top:0">What it can do</div><div class="box">${p("Write and change files", "Allow")}${p("Run commands", "Always ask")}${p("Browse the web", "Allow")}</div>` +
      `<div class="h2">Connectors</div><div class="box">${p("GitHub", "Always ask")}${p("Linear", "Allow")}</div>` +
      `<div class="h2">Computers</div><div class="box">${p("Sawyer's MacBook", "Always ask")}${p("build-box", "Never")}</div>`;
  }
  if (s === "usage") return head("Usage", `What ${a.name} has cost this month.`) +
    `<div class="box">${li("", "October so far", "1,284 messages across 31 chats", "<b>$41.20</b>")}${[["maya", "$18.60"], ["me", "$11.90"], ["jon", "$7.40"], ["priya", "$3.30"]].map((u) => li(face(u[0], 28), PEOPLE[u[0]].full, "", u[1])).join("")}</div>`;
  return head("Delete " + a.name, "Its chats, library and memory go with it. This cannot be undone.") + `<button class="btn bad">${ic("trash", 16)}Delete ${a.name}…</button>`;
}
/* Settings open over whatever tab the agent is on, and close back to it. */
function settingsModal() {
  var a = AGENTS[view.agent];
  return `<div class="veil dim" data-do="close"><div class="dlg setm" data-stop><nav class="snav"><div class="sm-h">${orb(view.agent, 30, { still: true })}<span><b>${a.name}</b><span class="mut">Agent settings</span></span></div>` +
    SECTIONS.map((x) => `<button class="sn${view.sec === x[0] ? " on" : ""}" data-do="sec:${x[0]}">${ic(x[2], 16)}${x[1]}</button>`).join("") +
    `<button class="sn bad${view.sec === "delete" ? " on" : ""}" data-do="sec:delete">${ic("trash", 16)}Delete agent</button></nav>` +
    `<div class="col">${section(view.sec)}</div><button class="ib x" data-do="close" title="Close">${ic("x", 16)}</button></div></div>`;
}
function agentMain() {
  var cur = tab();
  var body = cur === "library" ? libraryBody() : cur === "automations" ? automationsBody() : chatBody();
  return `<div class="main"><div class="acol">${ahead()}${body}</div>${view.panel ? panel(false, cur === "chat" ? null : cur) : ""}</div>`;
}

/* The workspace's settings: the same kind of window as an agent's, with the team's tile on it. */
var WSEC = [["general", "General", "cog"], ["members", "Members", "users"], ["computers", "Computers", "desktop"], ["agents", "New agents", "plus"], ["busy", "Busy agents", "clock"]];
function wsModal() {
  var s = view.wsec;
  var head = (title, words) => `<div class="sh"><h1>${title}</h1><p>${words}</p></div>`;
  var opt = (on, title, words) => `<button class="opt${on ? " on" : ""}" data-do="opt"><span class="grow"><div class="n" style="font-weight:500">${title}</div><div class="d mut" style="font-size:12.500px;margin-top:2px">${words}</div></span></button>`;
  var body = s === "general" ? head("General", "For all of Tidewater. Each agent has settings of its own, from the Settings button on its strip.") +
      `<div style="display:flex;gap:14px;align-items:center">${tile("T", TEAM.c, 52)}<div class="grow"><input class="field" value="Tidewater"></div></div>` +
      `<label class="lab">Color</label><div class="sw">${["oklch(0.5 0.08 195)", "#b8674a", "#5f8a4e", "#7d5a9a", "#c9952c", "#c0607a", "#2f3a52"].map((c, i) => `<button class="${i ? "" : "on"}" style="--c:${c}"></button>`).join("")}</div>`
    : s === "members" ? `<div class="sh" style="display:flex;align-items:center;gap:16px;margin-right:30px"><div class="grow"><h1>Members</h1><p>Everyone here can use every agent in Tidewater and read its chats.</p></div><button class="btn pri">${ic("plus", 16)}Invite people</button></div>` +
      `<div class="box">${["me", "maya", "jon", "priya"].map((id) => li(face(id, 32, where[id] ? "on" : "away"), PEOPLE[id].full + (id === "me" ? ' <span class="badge">You</span>' : ""), where[id] ? "In " + whereWords[where[id]] : "Last here 40m ago", id === "me" ? '<span class="badge">Owner</span>' : pick(["Admin", "Member"], PEOPLE[id].role))).join("")}</div>` +
      `<div class="h2">Invited · 2</div><div class="box">${li(`<span class="mut">${ic("mail", 18)}</span>`, "lee@tidewater.studio", "Invited by you 2 days ago · expires in 5 days", '<button class="btn sm quiet">Send again</button><button class="btn sm quiet bad">Withdraw</button>')}${li(`<span class="mut">${GH}</span>`, '<span class="mono">danvega</span>', "Invited by Maya yesterday · joins when they sign in with GitHub", '<button class="btn sm quiet">Copy link</button><button class="btn sm quiet bad">Withdraw</button>')}</div>`
    : s === "computers" ? `<div class="sh" style="display:flex;align-items:center;gap:16px;margin-right:30px"><div class="grow"><h1>Computers</h1><p>Machines paired with Tidewater. Each agent's Permissions say whether it may use one.</p></div><button class="btn pri">${ic("plus", 16)}Connect</button></div>` +
      `<div class="box">${[["Sawyer's MacBook", "Paired by you · online", ["pip", "scout"]], ["build-box", "Paired by Maya · online", ["ledger"]], ["priya-thinkpad", "Paired by Priya · last seen yesterday", []]].map((c) => li(`<span class="mut">${ic("desktop", 20)}</span>`, `<span class="mono">${c[0]}</span>`, c[1], `<span class="d" style="display:flex;align-items:center;gap:6px">${c[2].length ? "Used by " + c[2].map((k) => orb(k, 22, { still: true })).join("") : "Not used"}</span><button class="ib">${ic("dots", 17)}</button>`)).join("")}</div>`
    : s === "agents" ? head("New agents", "What an agent starts with when someone makes one. Agents you already have keep theirs.") +
      `<div class="box">${li("", "Default model", "Change one agent's in its own settings.", pick(["Claude Opus 5.5", "Claude Sonnet 5.5", "Claude Haiku 4.5"], "Claude Sonnet 5.5"))}${li("", "Default computer", "The kind of computer a new agent gets.", pick(["Cloud sandbox", "None"], "Cloud sandbox"))}</div>`
    : s === "busy" ? head("Busy agents", "What happens to a message someone sends while an agent is still answering somebody else.") +
      `<div style="display:flex;gap:12px">${opt(true, "Queue", "The message waits until the agent has finished answering.")}${opt(false, "Steer", "The message reaches the agent at once and can change what it is doing.")}</div>`
    : head("Leave Tidewater", "You lose its agents and chats. Someone there can invite you back.") + `<button class="btn bad">Leave Tidewater</button>`;
  return `<div class="veil dim" data-do="close"><div class="dlg setm" data-stop><nav class="snav"><div class="sm-h">${tile("T", TEAM.c, 30)}<span><b>Tidewater</b><span class="mut">Workspace settings</span></span></div>` +
    WSEC.map((x) => `<button class="sn${s === x[0] ? " on" : ""}" data-do="wsec:${x[0]}">${ic(x[2], 16)}${x[1]}</button>`).join("") +
    `<button class="sn bad${s === "leave" ? " on" : ""}" data-do="wsec:leave">${ic("x", 16)}Leave team</button></nav>` +
    `<div class="col">${body}</div><button class="ib x" data-do="close" title="Close">${ic("x", 16)}</button></div></div>`;
}

/* ---------- on a phone: the drawer is the workspace, the top of the screen is the agent ---------- */
function mobileScene() {
  view.agent = "pip"; view.chat = "launch";
  var top = `<div class="m-top"><button class="ib">${ic("list", 18)}</button><span class="who">${orb("pip", 24, { still: true })}<b>Pip</b><span class="mut">${ic("down", 12)}</span></span><span class="grow"></span>${stack(["me", "maya"], 20)}<button class="ib">${ic("gear", 17)}</button></div>`;
  var tabs = (cur) => `<nav class="tabs m-tabs">${["Chat", "Library", "Automations"].map((t) => `<span class="tab${t === cur ? " on" : ""}">${t}</span>`).join("")}</nav>`;
  var chat = `<div class="scroll"><div class="msgs">${msgs.slice(0, 3).map(message).join("")}</div></div><div class="foot"><div class="comp"><textarea placeholder="Message Pip"></textarea><div class="r"><span class="mut">${ic("clip", 16)}</span><span class="grow"></span><span class="send">${ic("up", 16)}</span></div></div></div>`;
  var arow = (key, open) => `<div class="brow${open ? " open" : ""}"><span class="chev">${ic("right", 13)}</span>${orb(key, 30, { still: true })}<span class="grow"><div class="t">${AGENTS[key].name}</div><div class="s">${SIDE[key].sub}</div></span></div>` +
    (open ? `<nav class="nest">${SIDE[key].chats.slice(0, 4).map((c) => `<span class="crow one${c.id === "launch" ? " sel" : ""}"><span class="grow trunc">${esc(c.title)}</span><span class="at">${c.at}</span></span>`).join("")}</nav>` : "");
  var drawer = `<div class="m-dim"></div><div class="m-drawer"><div class="m-top">${tile("T", TEAM.c, 28)}<b>Tidewater</b>${ic("sort", 13)}<span class="grow"></span>${stack(["maya", "jon"], 18)}</div>` +
    `<input class="search" placeholder="Search agents and chats"><div class="chats">${arow("pip", true)}${arow("ledger")}${arow("scout")}</div>` +
    `<div class="side-f me"><span class="prow">${face("me", 26, "on")}<span class="grow trunc">Sawyer Hood</span><span class="mut">${ic("sort", 13)}</span></span></div></div>`;
  var list = `<div class="m-top"><button class="ib">${ic("x", 17)}</button><span class="grow"></span></div><div class="m-pad" style="text-align:center">${orb("pip", 84)}<h2 style="font-size:18px;font-weight:600;margin-top:8px">Pip</h2><p class="mut">Settings</p></div>` +
    `<div class="m-pad"><div class="box">${SECTIONS.map((x) => `<div class="li"><span class="mut">${ic(x[2], 17)}</span><span class="grow n" style="font-weight:400">${x[1]}</span><span class="mut">${ic("right", 14)}</span></div>`).join("")}</div>` +
    `<div class="box" style="margin-top:12px"><div class="li" style="color:var(--destructive)">${ic("trash", 17)}<span class="grow">Delete agent</span></div></div></div>`;
  var sec = `<div class="m-top"><button class="ib" style="transform:rotate(180deg)">${ic("right", 17)}</button><span class="mut">Pip's settings</span><span class="grow"></span></div><div class="m-pad m-sec">${section("permissions")}</div>`;
  var phone = (inner, title, words) => `<figure class="phone-w"><div class="phone">${inner}</div><figcaption><b>${title}</b>${words}</figcaption></figure>`;
  return `<div class="phones">` +
    phone(top + tabs("Chat") + chat, "The agent", "The top of the screen is the agent's strip: its name, which is also the switcher, the same three tabs, and its settings.") +
    phone(top + tabs("Chat") + chat + drawer, "The workspace", "The drawer is the sidebar of a wide screen: the workspace, its agents and their chats, and your name, whose menu has the workspace's settings.") +
    phone(list, "Settings", "The same sections as the window on a wide screen, as a full-screen sheet with a list first.") +
    phone(sec, "A section", "Choosing one pushes it in; the arrow goes back to the list.") + "</div>";
}
function beforeScene() {
  view.agent = "pip"; view.chat = "launch";
  return oldRail() + side(true) + `<div class="main"><div class="chat"><div class="tr">${stack(inChat("launch"), 28)}<span class="pill ghost">${ic("users", 15)}Shared with Tidewater</span></div>` +
    `<div class="banner"><b>Today.</b> The outlined icons open pages of the selected agent, yet they sit outside the list where the agent is chosen.</div>` +
    `<div class="scroll"><div class="msgs" style="padding-top:96px">${msgs.map(message).join("")}</div></div><div class="foot"><div class="typing"></div><div class="comp"><textarea placeholder="Message Pip"></textarea><div class="r"><span class="grow"></span><button class="send">${ic("up", 17)}</button></div></div></div></div>${panel(true)}</div>`;
}

/* ---------- drawing and what the buttons do ---------- */
function place(id, anchor) {
  var menu = document.getElementById(id), at = document.querySelector(anchor);
  if (menu && at) { var r = at.getBoundingClientRect(); menu.style.left = r.left + "px"; menu.style.top = r.bottom + 4 + "px"; }
}
function render() {
  var b = view.base, open = listOpen(), o = view.over, s = view.scene;
  var base = b === "mobile" ? mobileScene() : b === "before" ? beforeScene() : (open ? side() : "") + agentMain();
  app.innerHTML = base + (o === "rowmenu" ? rowMenu() : o === "switcher" ? switchMenu() : o === "settings" ? settingsModal() : o === "wsettings" ? wsModal() : o === "account" ? accountMenu() : "");
  place("rowmenu", '[data-do="rowmenu:' + view.rowmenu + '"]'); place("switchmenu", '[data-do="switcher"]');
  var am = document.getElementById("accountmenu"), me = document.querySelector('[data-do="account"]');
  if (am && me) { var r = me.getBoundingClientRect(); am.style.left = r.left + "px"; am.style.bottom = app.getBoundingClientRect().bottom - r.top + 6 + "px"; }
  var ws = { wsettings: 1, members: 1, wcomputers: 1 }, shown = view.wsec === "members" ? "members" : view.wsec === "computers" ? "wcomputers" : "wsettings";
  var on = (x) => x === "collapsed" ? s === "chat" && !view.list : ws[x] ? s === "wsettings" && x === shown : x === s && (s !== "chat" || view.list);
  strip.innerHTML = "<b>Mock-up</b>" + SCENES.map((x) => `<button class="${on(x[0]) ? "on" : ""}" data-do="scene:${x[0]}">${x[1]}</button>`).join("") + '<span class="sp"></span><button data-do="theme">Light / dark</button>';
  mountOrbs();
}
function go(scene) {
  if (scene === "collapsed") { view.list = false; view.base = view.tab = "chat"; view.over = null; }
  else if (OVER[scene]) {
    if (view.base === "mobile" || view.base === "before" || scene !== "wsettings" && !AGENT[view.base]) view.base = view.tab;
    view.over = scene;
  } else { view.base = scene; view.over = null; if (AGENT[scene]) view.tab = scene; }
  view.scene = view.over || view.base;
  if (location.hash !== "#" + scene) history.replaceState(null, "", "#" + scene);
  render();
}
/* A scene from the strip, or from the address: set up so that it shows what it is named for. */
function show(scene) {
  if (scene === "wsettings" || scene === "members" || scene === "wcomputers") { view.wsec = scene === "members" ? "members" : scene === "wcomputers" ? "computers" : "general"; view.list = true; scene = "wsettings"; }
  if (scene === "chat" || scene === "account") view.list = true;
  if (scene === "library" || scene === "automations") view.list = view.panel = true;
  if (scene === "switcher") { view.base = view.tab = "chat"; view.list = false; }
  if (scene === "rowmenu") { view.base = view.tab = "chat"; view.list = true; view.agent = "pip"; view.chat = "launch"; view.rowmenu = "pip"; }
  go(scene);
}
function close() { go(view.base); }
function toast(words) {
  var t = document.createElement("div"); t.className = "toast"; t.textContent = words; app.appendChild(t);
  setTimeout(function () { t.remove(); }, 2000);
}
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-do]");
  if (!el) return;
  if (el.classList.contains("veil") && e.target.closest("[data-stop]")) return;
  var d = el.dataset.do.split(":"), a = d[0], v = d.slice(1).join(":");
  if (a === "go") go(v);
  else if (a === "scene") show(v);
  else if (a === "close") close();
  else if (a === "switcher" || a === "account") go(a);
  else if (a === "ws") { view.wsec = v; go("wsettings"); }
  else if (a === "agent") { view.agent = d[1]; view.chat = SIDE[d[1]].chats[0].id; view.open[d[1]] = true; go(d[2]); }
  else if (a === "chat") { view.agent = d[1]; view.chat = d[2]; go("chat"); }
  else if (a === "rowmenu") { view.rowmenu = v; go("rowmenu"); }
  else if (a === "sec") { view.sec = v; render(); }
  else if (a === "wsec") { view.wsec = v; render(); }
  else if (a === "fold") { view.open[v] = !view.open[v]; render(); }
  else if (a === "list") { view.list = !view.list; view.scene = view.over || view.base; render(); }
  else if (a === "panel") { view.panel = !view.panel; render(); }
  else if (a === "theme") { document.documentElement.classList.toggle("dark"); render(); }
  else if (a === "tg") el.classList.toggle("on");
  else if (a === "opt") { el.parentNode.querySelectorAll(".opt").forEach(function (o) { o.classList.toggle("on", o === el); }); }
  else if (a === "toast") toast(v);
  e.stopPropagation();
});
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && view.over) close(); });
window.addEventListener("hashchange", function () { var s = location.hash.slice(1); if (s && s !== view.scene) show(s); });

resetChat();
var first = location.hash.slice(1);
show(SCENES.some(function (x) { return x[0] === first; }) ? first : "chat");
})();
