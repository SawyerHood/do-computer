/* Teams mock-up. Everything here is pretend: the people, the agents and what they say. */
(function () {
"use strict";

/* ---------- icons ---------- */
var P = {
chat:'<path d="M21 12a8.500 8.500 0 0 1-12.300 7.600L4 21l1.400-4.700A8.500 8.500 0 1 1 21 12z"/>',
folder:'<path d="M3 7.500A1.500 1.500 0 0 1 4.500 6h4.600l2 2.200h8.400A1.500 1.500 0 0 1 21 9.700v7.800a1.500 1.500 0 0 1-1.500 1.500h-15A1.500 1.500 0 0 1 3 17.500z"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.200 2"/>',
bolt:'<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
plug:'<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
desktop:'<rect x="3" y="4.500" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.500V20"/>',
shield:'<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
user:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.500 18.200a6.500 6.500 0 0 1 11 0"/>',
users:'<circle cx="9" cy="9" r="3.500"/><path d="M2.500 19.500a6.500 6.500 0 0 1 13 0M16 5.700a3.500 3.500 0 0 1 0 6.600M18.500 15a6.500 6.500 0 0 1 3 4.500"/>',
gear:'<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.500v2M12 19.500v2M2.500 12h2M19.500 12h2M5.300 5.300l1.400 1.400M17.300 17.300l1.400 1.400M5.300 18.700l1.400-1.400M17.300 6.700l1.400-1.400"/>',
moon:'<path d="M20 14.500A8.500 8.500 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500z"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
right:'<path d="m9 6 6 6-6 6"/>',
x:'<path d="M6 6l12 12M18 6 6 18"/>',
note:'<path d="M12 4H5.500A1.500 1.500 0 0 0 4 5.500v13A1.500 1.500 0 0 0 5.500 20h13a1.500 1.500 0 0 0 1.500-1.500V12"/><path d="m10 14 .700-3L19 2.800l2.200 2.200L13 13.300z"/>',
lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
check:'<path d="m5 12.500 4.500 4.500L19 7.500"/>',
okc:'<circle cx="12" cy="12" r="9"/><path d="m8 12.500 2.700 2.700L16 9.500"/>',
ring:'<path d="M12 3a9 9 0 1 0 9 9"/>',
list:'<path d="M4 7h16M4 12h16M4 17h16"/>',
up:'<path d="M12 19V5M6 11l6-6 6 6"/>',
link:'<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>',
mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.500 7 8.500 6 8.500-6"/>',
dots:'<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="2.600"/>',
sort:'<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
clip:'<path d="m20 11-8.500 8.500a5 5 0 0 1-7-7L13 4a3.300 3.300 0 0 1 4.700 4.700l-8.500 8.500a1.700 1.700 0 0 1-2.400-2.400L14.500 7"/>'
};
function ic(n, s) { s = s || 18; return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + P[n] + "</svg>"; }
var GH = '<svg class="ic" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 .2a8 8 0 0 0-2.500 15.600c.400.100.500-.200.500-.400v-1.400c-2.200.500-2.700-1-2.700-1-.400-.900-.900-1.200-.900-1.200-.700-.500.100-.500.100-.500.800.100 1.200.800 1.200.800.700 1.200 1.900.900 2.300.700.100-.500.300-.900.500-1.100-1.800-.200-3.600-.900-3.600-4 0-.900.300-1.600.800-2.100-.100-.200-.400-1 .100-2.100 0 0 .700-.200 2.200.800a7.500 7.500 0 0 1 4 0c1.500-1 2.200-.800 2.200-.800.400 1.100.200 1.900.100 2.100.500.600.800 1.300.800 2.100 0 3.100-1.900 3.700-3.700 3.900.300.300.600.800.600 1.500v2.200c0 .200.100.500.600.400A8 8 0 0 0 8 .2z"/></svg>';

/* ---------- pretend data ---------- */
var PEOPLE = {
  me:    { name: "You",   full: "Sawyer Hood",  ini: "SH", c: "oklch(0.5 0.08 195)", mail: "sawyer@tidewater.studio", gh: "sawyerhood", role: "Owner" },
  maya:  { name: "Maya",  full: "Maya Okafor",  ini: "MO", c: "#c0607a", mail: "maya@tidewater.studio", gh: "mayaok", role: "Admin" },
  jon:   { name: "Jon",   full: "Jon Reyes",    ini: "JR", c: "#c9952c", mail: "jon@tidewater.studio", gh: "jreyes", role: "Member" },
  priya: { name: "Priya", full: "Priya Nair",   ini: "PN", c: "#7d5a9a", mail: "priya@tidewater.studio", gh: null, role: "Member" }
};
var AGENTS = {
  pip:    { name: "Pip",    seed: "Juniper", color: "#5f8a4e", tag: "Keeps the launch on track" },
  ledger: { name: "Ledger", seed: "Wren",    color: "#c9952c", tag: "Invoices, books and the weekly numbers" },
  scout:  { name: "Scout",  seed: "Tarn",    color: "#3f7f9c", tag: "Reads the internet so you do not have to" },
  mochi:  { name: "Mochi",  seed: "Pilar",   color: "#c0607a", tag: "Yours alone" }
};
/* Sub-agents: conversations Pip starts and keeps running while it stays free to talk. */
AGENTS.s_price = { name: "Pricing check", seed: "pip/sub/1", color: "#c9952c" };
AGENTS.s_status = { name: "Status page", seed: "pip/sub/2", color: "#c0607a" };
AGENTS.s_list = { name: "Email list", seed: "pip/sub/3", color: "#3f7f9c" };
var SUBS = [
  { key: "s_price", status: "done", words: "done", line: "Reported back · took 4 min", by: "maya" },
  { key: "s_status", status: "working", words: "working", line: "Reading status.tidewater.studio", by: "maya" },
  { key: "s_list", status: "waiting", words: "needs an OK", line: "Waiting for an OK", by: "me" }
];
function subMark(status) {
  return status === "done" ? '<span class="mut">' + ic("okc", 14) + "</span>" : status === "working" ? '<span class="spin mut">' + ic("ring", 13) + "</span>" : '<span class="amber"></span>';
}
var TEAM = { name: "Tidewater", c: "oklch(0.5 0.08 195)" };

/* Who is where. Changed by the scripted scene, and drawn from wherever it is shown. */
var where = { me: "launch", maya: "launch", jon: "pricing", priya: null };
var whereWords = { launch: "Pip · Launch checklist", pricing: "Pip · Pricing page copy", numbers: "Ledger · Weekly numbers" };
var CHATS = [
  { id: "launch",  title: "Launch checklist",                 by: "maya",  at: "now" },
  { id: "pricing", title: "Pricing page copy",                by: "jon",   at: "4m" },
  { id: "invest",  title: "Numbers for the investor update",  by: "me",    at: "1h" },
  { id: "notes",   title: "My review notes",                  by: "me",    at: "3h", priv: true },
  { id: "vendor",  title: "Vendor contract questions",        by: "priya", at: "Tue" },
  { id: "onboard", title: "Onboarding email drafts",          by: "maya",  at: "Mon" }
];
var msgs, runs, typing, busy, mood, queued;
function resetChat() {
  msgs = [
    { by: "maya", at: "2:02 PM", text: "Pip, what is still open on the launch checklist? We ship Thursday." },
    { agent: true, html: "<p>Three things are still open in <code>launch-checklist.md</code>:</p><ul><li><b>Pricing page copy</b>: Jon has a draft in another chat, not yet approved.</li><li><b>Status page</b>: nobody owns it.</li><li><b>Launch email</b>: written, waiting on the final price.</li></ul><p>Everything else is ticked.</p>" },
    { by: "me", at: "2:05 PM", text: "Put the status page under my name. I'll do it tonight." },
    { agent: true, html: "<p>Done. The status page is yours in the checklist, due Wednesday.</p>" }
  ];
  runs = [
    { title: "Gave the status page to Sawyer", by: "me", at: "2:05 PM", steps: 2 },
    { title: "Read the launch checklist", by: "maya", at: "2:02 PM", steps: 3 }
  ];
  typing = null; busy = null; queued = null; mood = "Ready";
  where = { me: "launch", maya: "launch", jon: "pricing", priya: null };
}

/* ---------- small pieces ---------- */
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function face(id, size, cls) {
  var p = PEOPLE[id];
  return '<span class="pf ' + (cls || "") + '" title="' + esc(p.full) + '" style="--c:' + p.c + ";--s:" + size + 'px">' + p.ini + "</span>";
}
function stack(ids, size, pop) {
  return '<span class="stack" style="--s:' + size + 'px">' + ids.map(function (id) { return face(id, size, id === pop ? "pop" : ""); }).join("") + "</span>";
}
function tile(letter, c, size) { return '<span class="tile" style="--c:' + c + ";--s:" + size + 'px">' + letter + "</span>"; }
function orb(key, size, opts) {
  var a = AGENTS[key]; opts = opts || {};
  return '<span class="orb" style="width:' + size + "px;height:" + size + 'px"><canvas data-agent="' + key + '" data-size="' + size + '"' + (opts.id ? ' data-id="' + opts.id + '"' : "") + (opts.still ? " data-still" : "") + "></canvas>" +
    '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="35" rx="23" ry="22" fill="' + a.color + '"/><ellipse cx="24" cy="33" rx="5" ry="6.500" fill="#fff"/><ellipse cx="40" cy="33" rx="5" ry="6.500" fill="#fff"/><circle cx="25" cy="34" r="2.600" fill="#16181d"/><circle cx="41" cy="34" r="2.600" fill="#16181d"/></svg></span>';
}
function names(ids) {
  var n = ids.map(function (id) { return PEOPLE[id].name; });
  return n.length < 2 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
}
function inChat(chat) { return Object.keys(where).filter(function (id) { return where[id] === chat; }); }

/* ---------- the creature ---------- */
var core = window.THREE && window.AgentOrbCore ? window.AgentOrbCore(window.THREE) : null;
if (core && !core.Stage.get("px")) core = null;
var orbs = [], named = {};
function mountOrbs() {
  orbs.forEach(function (o) { o.dispose(); }); orbs = []; named = {};
  if (!core) return;
  var dark = document.documentElement.classList.contains("dark");
  document.querySelectorAll(".orb canvas").forEach(function (cv) {
    var a = AGENTS[cv.dataset.agent], size = +cv.dataset.size, still = cv.hasAttribute("data-still");
    var o = core.createOrb(cv, { seed: a.seed, color: a.color, size: Math.round(size * 1.24), dark: dark, slow: still || size < 60, notice: !still });
    cv.nextElementSibling.style.display = "none";
    orbs.push(o);
    if (cv.dataset.id) named[cv.dataset.id] = o;
    if (still) setTimeout(function () { o.paused = true; }, 1500);
  });
}
if (core) {
  window.addEventListener("pointermove", function (e) { orbs.forEach(function (o) { if (o.notice) o.setPointer(e.clientX, e.clientY); }); }, { passive: true });
}
function act(state, variant) { if (named.main) named.main.setState(state, variant); }

/* ---------- shell ---------- */
var view = { scene: "chat", list: true, panel: true, menu: null, dialog: null, agent: "pip", open: { pip: true } };
function rail(personal) {
  var page = view.scene;
  var nav = [["chat", "Agents and chats"], ["folder", "Library"], ["clock", "Automations"], ["bolt", "Skills"], ["plug", "Connectors"], ["desktop", "Computers"], ["shield", "Permissions"], ["user", "Identity and memory"]];
  var online = Object.keys(where).filter(function (id) { return id !== "me" && where[id]; }).length;
  return '<aside class="rail">' +
    '<button class="wsb' + (view.menu === "ws" ? " open" : "") + '" data-do="menu:ws" title="Switch workspace">' +
      (personal ? face("me", 36) : tile("T", TEAM.c, 36)) + '<span class="ch">' + ic("sort", 10) + "</span></button>" +
    "<hr>" +
    nav.map(function (n, i) {
      var on = i === 0 && (page === "chat" || page === "switch" || page === "subs") && view.list;
      return '<button class="rb' + (on ? " on" : "") + '" title="' + n[1] + '"' + (i === 0 ? ' data-do="list"' : "") + ">" + ic(n[0], 20) + "</button>";
    }).join("") +
    '<span class="sp"></span>' +
    (personal ? "" : '<button class="rb' + (page === "members" || page === "invite" || page === "home" ? " on" : "") + '" data-do="go:home" title="Tidewater: ' + online + ' online">' + ic("users", 20) + (online ? '<span class="n">' + online + "</span>" : "") + "</button>") +
    '<button class="rb" title="Settings">' + ic("gear", 20) + "</button>" +
    '<button class="rb" data-do="theme" title="Switch theme">' + ic(document.documentElement.classList.contains("dark") ? "sun" : "moon", 20) + "</button>" +
    '<button class="rb" title="Your account">' + face("me", 28, "on") + "</button>" +
  "</aside>";
}

function pipHere() {
  var ids = inChat("launch").concat(inChat("pricing"), inChat("s_status")).filter(function (id) { return id !== "me"; });
  return (ids.length ? stack(ids, 16, view.popped) : "") + (busy ? '<span class="live"></span>working for ' + PEOPLE[runs[0].by].name : ids.length + " here");
}
/* The side column: the team's agents, each with its chats folded under it. */
var OTHER = {
  ledger: [{ id: "inv", title: "October invoices", by: "priya", at: "52m" }, { id: "close", title: "Closing the third quarter", by: "me", at: "Mon" }, { id: "tax", title: "Sales tax by state", by: "maya", at: "Sep 28" }],
  scout: [{ id: "who", title: "Who else launched this week", by: "jon", at: "Tue" }, { id: "comp", title: "What competitors charge", by: "maya", at: "Sep 30" }]
};
/* A chat on one line: its title, then who is in it right now, or else when it was last used. */
function lineRow(c) {
  var subs = view.scene === "subs";
  var here = inChat(c.id).concat(subs && c.id === "launch" ? inChat("s_status") : []).filter(function (id) { return id !== "me"; });
  // The end of the row is one slot: a spinner while there is work going on in the chat, with how
  // many sub-agents where it is theirs, and otherwise when the chat was last used. Never both.
  var count = subs ? (c.id === "launch" ? 2 : c.id === "pricing" ? 1 : 0) : 0;
  var working = count > 0 || (c.id === "launch" && busy);
  return '<button class="crow one' + (c.id === "launch" ? " sel" : "") + '" title="Started by ' + (c.by === "me" ? "you" : PEOPLE[c.by].name) + '">' +
    '<span class="grow trunc">' + esc(c.title) + "</span>" + (c.priv ? ic("lock", 13) : "") + (here.length ? stack(here, 18, view.popped) : "") +
    '<span class="at"' + (count ? ' title="' + count + (count === 1 ? " sub-agent" : " sub-agents") + ' at work"' : "") + ">" + (working ? '<span class="spin">' + ic("ring", 12) + "</span>" + (count || "") : c.at) + "</span></button>";
}
function botList() {
  var bot = function (key, sub, chats, older) {
    var open = !!view.open[key];
    return '<button class="brow' + (open ? " open" : "") + '" data-do="fold:' + key + '"><span class="chev">' + ic("right", 13) + "</span>" + orb(key, 34, { still: true }) +
      '<span class="grow"><div class="t">' + AGENTS[key].name + '</div><div class="s"' + (key === "pip" ? ' id="piphere"' : "") + ">" + sub + "</div></span>" +
      '<span class="ib" title="New chat with ' + AGENTS[key].name + '">' + ic("note", 16) + "</span></button>" +
      (open ? '<nav class="nest"><div' + (key === "pip" ? ' id="chats"' : "") + ">" + chats.map(lineRow).join("") + "</div>" + (older ? '<button class="more">' + older + " older chats</button>" : "") + "</nav>" : "");
  };
  return '<aside class="side"><div class="side-h"><h2>Agents</h2><button class="ib" title="New agent">' + ic("plus", 17) + "</button></div>" +
    '<input class="search" placeholder="Search agents and chats">' +
    '<div class="chats">' + bot("pip", pipHere(), CHATS, 14) + bot("ledger", "Quiet · Priya, 52m ago", OTHER.ledger, 6) + bot("scout", "Quiet · Jon, Tuesday", OTHER.scout) + "</div>" +
    '<div class="side-f" id="online">' + onlineList() + "</div></aside>";
}
function onlineList() {
  var ids = ["maya", "jon", "priya"];
  var on = ids.filter(function (id) { return where[id]; }).length;
  return "<h3><span>Tidewater</span><span>" + on + " online</span></h3>" + ids.map(function (id) {
    var w = where[id];
    return '<button class="prow">' + face(id, 24, w ? "on" : "away") + '<span class="grow"><div class="trunc">' + PEOPLE[id].full + '</div><div class="w trunc">' + (w ? whereWords[w] : "Last here 40m ago") + "</div></span></button>";
  }).join("");
}

function message(m) {
  if (m.raw) return '<div class="m">' + m.raw + "</div>";
  if (m.agent) return '<div class="m">' + (m.tool ? '<div class="tool">' + ic("okc", 15) + esc(m.tool) + "</div>" : "") + '<div class="prose">' + m.html + "</div></div>";
  var mine = m.by === "me";
  return '<div class="m h' + (mine ? " me" : "") + '">' + (mine ? "" : '<div class="who"><b>' + PEOPLE[m.by].full + "</b>" + m.at + "</div>") +
    '<div class="line"><div class="bub">' + esc(m.text) + "</div>" + (mine ? "" : face(m.by, 30)) + "</div></div>" +
    (m.queued ? '<div class="q">Queued until Pip finishes answering ' + PEOPLE[m.queued].name + "</div>" : "");
}
function transcript() {
  return msgs.map(message).join("") + (busy ? '<div class="shine" style="align-self:flex-start">' + esc(busy) + "…</div>" : "");
}
function typingLine() {
  return typing ? face(typing, 18) + "<span>" + PEOPLE[typing].name + ' is typing</span><span class="dots"><i></i><i></i><i></i></span>' : "";
}
function presence() {
  var ids = inChat("launch");
  return stack(ids, 28, view.popped) + '<span class="pill ghost">' + ic("users", 15) + "Shared with Tidewater</span>";
}
function runRow(r) {
  return '<div class="run">' + (r.going ? '<span class="spin mut">' + ic("ring", 16) + "</span>" : '<span class="mut">' + ic("okc", 16) + "</span>") +
    '<div class="grow"><div class="t">' + esc(r.title) + '</div><div class="s">' + face(r.by, 15) + "for " + (r.by === "me" ? "you" : PEOPLE[r.by].name) + " · " + r.at + (r.going ? "" : " · " + r.steps + (r.steps === 1 ? " step" : " steps")) + "</div></div></div>";
}
function hereRows() {
  var ids = inChat("launch");
  return '<div class="hererow">' + ids.map(function (id) { return face(id, 28, "on" + (id === view.popped ? " pop" : "")); }).join("") +
    '<span class="grow w">' + (typing ? PEOPLE[typing].name + " is typing" : names(ids)) + (view.scene === "subs" ? " · Jon is watching Status page" : "") + "</span></div>";
}
function subPanel() {
  return '<div class="sec"><h3>Sub-agents in this chat</h3>' + SUBS.map(function (x) {
    var watching = inChat(x.key);
    return '<div class="run" style="align-items:center">' + orb(x.key, 30, { still: x.status !== "working" }) + '<div class="grow"><div class="t">' + AGENTS[x.key].name + '</div><div class="s"><span class="trunc">' + x.line + "</span></div></div>" + (watching.length ? stack(watching, 18) : "") + subMark(x.status) + "</div>";
  }).join("") + "</div>";
}
function chatScene() {
  var a = AGENTS[view.agent], subs = view.scene === "subs";
  return rail() + (view.list ? botList() : "") + '<div class="main"><div class="chat">' +
    '<div class="fade"></div>' +
    (view.list ? "" : '<div class="tl"><button class="pill" data-do="list">' + ic("list", 15) + "Agents" + stack(["maya", "jon"], 18) + '</button><button class="pill ic-only" title="New chat">' + ic("note", 15) + "</button></div>") +
    '<div class="tr" id="presence">' + presence() + "</div>" +
    '<div class="scroll" id="scroll"><div class="msgs" id="msgs">' + transcript() + "</div></div>" +
    '<div class="foot"><div class="typing" id="typing">' + typingLine() + "</div>" +
    '<div class="comp"><textarea id="box" placeholder="Message ' + a.name + '"></textarea><div class="r"><button class="ib" title="Attach">' + ic("clip", 17) + '</button><span class="grow"></span><button class="send" data-do="send" title="Send">' + ic("up", 17) + "</button></div></div></div>" +
    "</div>" + (view.panel ? '<aside class="panel"><button class="ib x" data-do="panel" title="Hide">' + ic("x", 15) + "</button>" +
      '<div class="top">' + orb(view.agent, subs ? 168 : 208, { id: "main" }) + (subs ? '<div class="subs3">' + SUBS.map(function (x) { return orb(x.key, 34, { still: x.status !== "working" }); }).join("") + "</div>" : "") +
      "<h2>" + a.name + '</h2><p id="mood">' + mood + '</p><p class="tag">' + (subs ? "1 sub-agent working · 1 waiting for an OK" : a.tag) + "</p></div>" +
      (subs ? subPanel() : "") +
      '<div class="sec"><h3><span>Here now</span><button data-do="dialog:invite">Invite</button></h3><div id="here">' + hereRows() + "</div></div>" +
      '<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>What it did here</h3><div id="runs">' + runs.map(runRow).join("") + "</div></div></aside>" : "") +
    "</div>";
}

/* ---------- team home ---------- */
function homeScene() {
  var card = function (key, ids, words, working) {
    var a = AGENTS[key];
    return '<button class="card" data-do="go:chat">' + orb(key, 112) + "<h3>" + a.name + '</h3><p class="tag">' + a.tag + '</p><div class="now">' +
      (ids.length ? stack(ids, 22) : "") + '<span class="grow">' + (working ? '<span class="live" style="display:inline-block;margin-right:6px"></span>' : "") + words + "</span></div></button>";
  };
  var feed = [["pip", "Launch checklist", "maya", "now"], ["pip", "Pricing page copy", "jon", "4m"], ["ledger", "October invoices", "priya", "52m"], ["pip", "Numbers for the investor update", "me", "1h"], ["scout", "Who else launched this week", "jon", "Tue"]];
  return rail() + '<div class="page"><div class="col wide">' +
    '<div class="ph">' + tile("T", TEAM.c, 56) + '<div class="grow"><h1>Tidewater</h1><p>4 people · 3 agents, shared with everyone here</p></div>' +
    stack(["me", "maya", "jon", "priya"], 30) + '<button class="btn" data-do="go:members">' + ic("gear", 16) + 'Manage</button><button class="btn pri" data-do="dialog:invite">' + ic("plus", 16) + "Invite people</button></div>" +
    '<div class="h2">Agents</div><div class="cards">' +
      card("pip", ["maya", "me"], "Maya and you, in Launch checklist", true) +
      card("ledger", [], "Quiet since 52m ago") +
      card("scout", [], "Quiet since Tuesday") +
      '<button class="card add">' + ic("plus", 22) + "<span>New agent for the team</span></button></div>" +
    '<div class="two"><div><div class="h2">Who is here</div><div class="box">' +
      ["me", "maya", "jon", "priya"].map(function (id) {
        var w = where[id];
        return '<div class="li">' + face(id, 32, w ? "on" : "away") + '<div class="grow"><div class="n">' + PEOPLE[id].full + (id === "me" ? ' <span class="mut" style="font-weight:400">(you)</span>' : "") + '</div><div class="d trunc">' + (w ? whereWords[w] : "Last here 40m ago") + "</div></div>" + (w && id !== "me" ? '<button class="btn sm" data-do="go:chat">Join</button>' : "") + "</div>";
      }).join("") + "</div></div>" +
    '<div><div class="h2">Latest chats</div><div class="box">' + feed.map(function (f) {
        return '<button class="li" style="width:100%" data-do="go:chat">' + orb(f[0], 30, { still: true }) + '<div class="grow"><div class="n trunc">' + f[1] + '</div><div class="d">' + AGENTS[f[0]].name + " · started by " + (f[2] === "me" ? "you" : PEOPLE[f[2]].name) + '</div></div><span class="d">' + f[3] + "</span></button>";
      }).join("") + "</div></div></div></div></div>";
}

/* ---------- members ---------- */
function roleSel(role) { return '<select class="pick">' + ["Owner", "Admin", "Member"].map(function (r) { return "<option" + (r === role ? " selected" : "") + ">" + r + "</option>"; }).join("") + "</select>"; }
function membersScene() {
  return rail() + '<div class="page"><div class="col">' +
    '<div class="ph">' + tile("T", TEAM.c, 48) + '<div class="grow"><h1>Tidewater</h1><p>Everyone here can use every agent in this team and read its chats.</p></div><button class="btn pri" data-do="dialog:invite">' + ic("plus", 16) + "Invite people</button></div>" +
    '<div class="h2">Members · 4</div><div class="box">' + ["me", "maya", "jon", "priya"].map(function (id) {
      var p = PEOPLE[id], w = where[id];
      return '<div class="li">' + face(id, 32, w ? "on" : "away") + '<div class="grow"><div class="n">' + p.full + (id === "me" ? ' <span class="badge">You</span>' : "") + '</div><div class="d" style="display:flex;gap:10px;align-items:center"><span>' + p.mail + "</span>" + (p.gh ? '<span class="gh" style="display:inline-flex;gap:4px;align-items:center">' + GH + p.gh + "</span>" : "") + "</div></div>" +
        '<span class="d" style="width:150px" class="trunc">' + (w ? whereWords[w] : "40m ago") + "</span>" + (id === "me" ? '<span class="badge" style="width:92px;text-align:center">Owner</span>' : roleSel(p.role)) + '<button class="ib">' + ic("dots", 17) + "</button></div>";
    }).join("") + "</div>" +
    '<div class="h2">Invited · 2</div><div class="box">' +
      '<div class="li"><span class="pf" style="--c:var(--accent);--s:32px;color:var(--muted-foreground)">' + ic("mail", 16) + '</span><div class="grow"><div class="n">lee@tidewater.studio</div><div class="d">Invited by you 2 days ago · expires in 5 days</div></div><button class="btn sm quiet" data-do="toast:Sent again">Send again</button><button class="btn sm quiet bad" data-do="toast:Invitation withdrawn">Withdraw</button></div>' +
      '<div class="li"><span class="pf" style="--c:var(--accent);--s:32px;color:var(--muted-foreground)">' + GH + '</span><div class="grow"><div class="n gh" style="font-size:13.500px">danvega</div><div class="d">Invited by Maya yesterday · joins when they sign in with GitHub</div></div><button class="btn sm quiet" data-do="toast:Link copied">Copy link</button><button class="btn sm quiet bad" data-do="toast:Invitation withdrawn">Withdraw</button></div></div>' +
    '<div class="h2">Invite link</div><div class="box"><div class="li">' + ic("link", 18) + '<div class="grow"><div class="n">Anyone with the link can ask to join</div><div class="d">An owner or admin lets them in. Off until you turn it on.</div></div><button class="btn sm" data-do="toast:Link turned on and copied">Turn on</button></div></div>' +
    '<div class="h2">Roles</div><p class="mut" style="font-size:13px;line-height:1.6"><b style="color:var(--foreground);font-weight:500">Members</b> chat with every agent, start chats and see each other\'s. <b style="color:var(--foreground);font-weight:500">Admins</b> also invite and remove people, and create, change and delete agents. The <b style="color:var(--foreground);font-weight:500">owner</b> can also delete the team or hand it on.</p>' +
    '<div class="h2">Leave</div><button class="btn bad">Leave Tidewater</button></div></div>';
}

/* ---------- menus and dialogs ---------- */
function wsMenu() {
  return '<div class="veil" data-do="menu:"></div><div class="menu" style="left:70px;top:8px">' +
    '<div class="lb">Workspaces</div>' +
    '<button class="mi" data-do="go:new">' + face("me", 32) + '<span class="grow"><div>Personal</div><div class="d">1 agent · only you</div></span></button>' +
    '<button class="mi cur" data-do="go:home">' + tile("T", TEAM.c, 32) + '<span class="grow"><div>Tidewater</div><div class="d">3 agents · ' + stack(["maya", "jon"], 16) + " here now</div></span>" + ic("check", 16) + "</button>" +
    '<button class="mi">' + tile("H", "#7d5a9a", 32) + '<span class="grow"><div>Hood family</div><div class="d">1 agent · 3 people</div></span></button>' +
    '<hr><div class="lb">Invitations</div>' +
    '<div class="mi">' + tile("N", "#b8674a", 32) + '<span class="grow"><div>Northside Robotics</div><div class="d">from Dana Whitlock</div></span><button class="btn sm pri" data-do="go:join">View</button></div>' +
    '<hr><button class="mi" data-do="dialog:new">' + ic("plus", 18) + '<span>New team</span></button><button class="mi" data-do="go:members">' + ic("users", 18) + "<span>People in Tidewater</span></button></div>";
}
function inviteDialog() {
  return '<div class="veil dim" data-do="dialog:"><div class="dlg" data-stop><h2>Invite people to Tidewater</h2><p class="sub">They can use all 3 agents here and read every chat that is not marked “Only me”.</p>' +
    '<div class="tok"><span class="chip"><span class="pf" style="--c:var(--input);color:var(--foreground)">' + ic("mail", 11) + '</span>lee@tidewater.studio<button>' + ic("x", 13) + "</button></span>" +
    '<span class="chip"><span class="pf" style="--c:#2f3a52">DV</span><span class="gh">danvega</span><span class="mut">Dan Vega</span><button>' + ic("x", 13) + '</button></span><input placeholder="Email or @github-username" id="who"></div>' +
    '<p class="hint">Start a GitHub username with @. Separate people with a comma or Enter.</p>' +
    '<div style="display:flex;gap:12px;align-items:end"><div class="grow"><label>Add a note</label><input class="field" placeholder="Optional. Goes in the email."></div><div><label>Role</label><select class="pick" style="height:38px;border-radius:10px"><option>Member</option><option>Admin</option></select></div></div>' +
    '<div class="acts"><button class="btn quiet" data-do="toast:Link copied">' + ic("link", 16) + 'Copy invite link</button><span class="grow"></span><button class="btn" data-do="dialog:">Cancel</button><button class="btn pri" data-do="sent">Send 2 invitations</button></div></div></div>';
}
function newDialog() {
  return '<div class="veil dim" data-do="dialog:"><div class="dlg" data-stop><h2>New team</h2><p class="sub">A place for agents you share. Your personal agents stay yours unless you move them.</p>' +
    '<div style="display:flex;gap:14px;align-items:center">' + tile("T", TEAM.c, 52) + '<div class="grow"><input class="field" value="Tidewater"></div></div>' +
    '<label>Color</label><div class="sw">' + ["oklch(0.5 0.08 195)", "#b8674a", "#5f8a4e", "#7d5a9a", "#c9952c", "#c0607a", "#2f3a52"].map(function (c, i) { return '<button class="' + (i ? "" : "on") + '" style="--c:' + c + '"></button>'; }).join("") + "</div>" +
    '<label>Bring an agent along</label><label class="ck" style="margin:0;font-weight:400"><input type="checkbox">' + orb("mochi", 32, { still: true }) + '<span class="grow"><div style="font-weight:500">Mochi</div><div class="mut" style="font-size:12.500px">Moves with its chats, library and memory. The team will be able to read them.</div></span></label>' +
    '<label>Invite people</label><div class="tok"><input placeholder="Email or @github-username. You can also do this later."></div>' +
    '<div class="acts"><span class="grow"></span><button class="btn" data-do="dialog:">Cancel</button><button class="btn pri" data-do="go:home">Create team</button></div></div></div>';
}
function personalScene() {
  return rail(true) + '<div class="main"><div class="chat"><div class="tl"><button class="pill">' + ic("list", 15) + 'Agents</button></div><div class="center">' + orb("mochi", 260, { id: "main" }) +
    '<h1 style="font-size:24px;font-weight:600;margin-top:18px">Mochi</h1><p class="mut">Your personal workspace. Only you can see what is here.</p></div>' +
    '<div class="foot"><div class="comp"><textarea placeholder="Message Mochi"></textarea><div class="r"><span class="grow"></span><button class="send">' + ic("up", 17) + "</button></div></div></div></div></div>";
}
function joinScene() {
  return '<div class="center" style="background:var(--rail)"><div class="join">' + tile("N", "#b8674a", 56) +
    "<h1>Dana invited you to Northside Robotics</h1><p class=\"mut\">“Come meet the bots. Scout already knows the parts list.”</p>" +
    '<div class="trio"><div>' + orb("scout", 84) + "Scout</div><div>" + orb("pip", 84) + "Pip</div><div>" + orb("ledger", 84) + "Ledger</div></div>" +
    '<p class="mut" style="font-size:13px;margin-bottom:18px;display:flex;align-items:center;gap:8px">' + stack(["maya", "jon", "priya"], 22) + "Dana and 5 others share these agents and their chats</p>" +
    '<button class="btn pri" style="width:100%;height:42px" data-do="go:home">Join Northside Robotics</button><button class="btn quiet" style="width:100%">Not now</button>' +
    '<p class="hint" style="margin-top:12px">Signed in as sawyer@tidewater.studio. This invitation expires in 6 days.</p></div></div>';
}

/* ---------- drawing and the scripted scene ---------- */
var app = document.getElementById("app"), timers = [];
var SCENES = [["chat", "Shared chat"], ["subs", "With sub-agents"], ["switch", "Workspace menu"], ["home", "Team home"], ["members", "People"], ["invite", "Invite"], ["new", "New team"], ["join", "An invitation"]];
function render() {
  var s = view.scene, html;
  if (s === "home") html = homeScene();
  else if (s === "members" || s === "invite") html = membersScene();
  else if (s === "new") html = personalScene();
  else if (s === "join") html = joinScene();
  else html = chatScene();
  if (view.menu === "ws") html += wsMenu();
  if (view.dialog === "invite") html += inviteDialog();
  if (view.dialog === "new") html += newDialog();
  app.innerHTML = html;
  mountOrbs();
  var sc = document.getElementById("scroll"); if (sc) sc.scrollTop = sc.scrollHeight;
  document.getElementById("strip").innerHTML = "<b>Mock-up</b>" + SCENES.map(function (x) { return '<button class="' + (x[0] === s ? "on" : "") + '" data-do="go:' + x[0] + '">' + x[1] + "</button>"; }).join("") +
    '<span class="sp"></span>' + (s === "chat" ? '<button data-do="go:chat">Play again</button>' : "") + '<button data-do="theme">Light / dark</button>';
}
function part(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
function refresh() {
  part("msgs", transcript()); part("typing", typingLine()); part("presence", presence()); part("here", hereRows());
  part("runs", runs.map(runRow).join("")); part("mood", mood); part("online", onlineList()); part("piphere", pipHere());
  var list = document.getElementById("chats");
  if (list) list.innerHTML = CHATS.map(lineRow).join("");
  var sc = document.getElementById("scroll"); if (sc) sc.scrollTop = sc.scrollHeight;
  view.popped = null;
}
function later(ms, fn) { timers.push(setTimeout(function () { fn(); refresh(); }, ms)); }
function stream(m, words, done) {
  var i = 0;
  var t = setInterval(function () {
    i += 2; m.html = "<p>" + words.slice(0, i).join(" ") + "</p>";
    if (named.main) named.main.feed("token", 2);
    part("msgs", transcript());
    var sc = document.getElementById("scroll"); if (sc) sc.scrollTop = sc.scrollHeight;
    if (i >= words.length) { clearInterval(t); done(); refresh(); }
  }, 90);
  timers.push(t);
}
function answer(by, tool, text, after) {
  busy = "Thinking"; mood = "Thinking"; act("thinking");
  later(1400, function () {
    busy = tool.doing; mood = tool.mood; act("working", tool.variant);
    runs.unshift({ title: tool.title, by: by, at: "now", going: true, steps: tool.steps });
  });
  later(3400, function () {
    busy = null; mood = "Answering " + (by === "me" ? "you" : PEOPLE[by].name); act("speaking");
    var m = { agent: true, tool: tool.did, html: "" }; msgs.push(m);
    stream(m, text.split(" "), function () {
      mood = "Ready"; act("done"); runs[0].going = false;
      msgs.forEach(function (x) { delete x.queued; });
      if (after) after();
    });
  });
}
function play() {
  timers.forEach(function (t) { clearTimeout(t); clearInterval(t); }); timers = [];
  resetChat(); render();
  later(1500, function () { typing = "maya"; act("listening"); mood = "Listening"; });
  later(4200, function () {
    typing = null;
    msgs.push({ by: "maya", at: "2:11 PM", text: "Thanks. Pip, can you check whether Jon's pricing copy matches the prices in the launch email?" });
    answer("maya", { doing: "Reading Pricing page copy and launch-email.md", mood: "Working with files", variant: "file", title: "Compared the pricing copy with the launch email", did: "Read Jon's chat “Pricing page copy” and launch-email.md", steps: 4 },
      "They disagree on one line. Jon's page says the Team plan is $24 a seat; the email still says $20. Everything else matches. Jon is in the other chat right now if you want to ask which is right.");
  });
  later(6400, function () { where.jon = "launch"; view.popped = "jon"; });
  later(7600, function () { typing = "jon"; });
  later(9400, function () {
    typing = null;
    msgs.splice(msgs.length - (msgs[msgs.length - 1].agent ? 1 : 0), 0, { by: "jon", at: "2:12 PM", text: "$24 is right. Pip, fix the email please.", queued: "maya" });
  });
  later(13800, function () {
    answer("jon", { doing: "Editing launch-email.md", mood: "Working with files", variant: "file", title: "Fixed the price in the launch email", did: "Edited launch-email.md", steps: 2 },
      "Fixed: the launch email now says $24 a seat, and I ticked “Launch email” on the checklist.");
  });
}

function subsChat() {
  resetChat();
  where.jon = "s_status"; whereWords.s_status = "Pip · Launch checklist › Status page";
  var chip = function (x) { return '<button class="schip">' + orb(x.key, 20, { still: x.status !== "working" }) + AGENTS[x.key].name + ' sub-agent<span class="st">' + x.words + "</span>" + ic("right", 13) + "</button>"; };
  msgs = [
    { by: "maya", at: "2:02 PM", text: "Pip, are we actually ready for Thursday? Check the pricing copy against the email, that the status page is up, and that the launch list is deduplicated." },
    { agent: true, html: "<p>On it. I've started three sub-agents so these happen at the same time, and I'll tell you what each one finds.</p>" },
    { raw: '<div class="chipr" style="margin-top:-8px">' + SUBS.map(chip).join("") + "</div>" },
    { by: "me", at: "2:05 PM", text: "While they work: who owns the status page?" },
    { agent: true, html: "<p>You do, as of this afternoon. It is due Wednesday.</p>" },
    { raw: '<div class="rep">' + orb("s_price", 18, { still: true }) + "<span><b>Pricing check sub-agent</b> reported back</span><a>Open its chat</a></div>" },
    { agent: true, html: "<p>Pricing is in: the page says $24 a seat and the email says $20. Everything else matches.</p>" },
    { raw: '<div class="ask"><div class="hd">' + orb("s_list", 20, { still: true }) + "Email list sub-agent is waiting for an OK</div><div class=\"mut\">It wants to run a command on Sawyer's MacBook:</div><pre>sort -u launch-list.csv -o launch-list.csv</pre>" +
        '<div class="acts"><button class="btn sm pri" data-do="toast:Allowed. Maya and Jon see that you did.">Allow</button><button class="btn sm">Don\'t allow</button><span class="grow"></span><span class="mut" style="font-size:12.500px">Anyone in Tidewater can answer</span></div></div>' }
  ];
  runs = [{ title: "Answered who owns the status page", by: "me", at: "2:05 PM", steps: 1 }, { title: "Started three sub-agents for launch readiness", by: "maya", at: "2:02 PM", steps: 3 }];
}

/* ---------- what the buttons do ---------- */
function go(scene) {
  timers.forEach(function (t) { clearTimeout(t); clearInterval(t); }); timers = [];
  view.scene = scene; view.menu = scene === "switch" ? "ws" : null;
  view.dialog = scene === "invite" ? "invite" : scene === "new" ? "new" : null;
  if (location.hash !== "#" + scene) history.replaceState(null, "", "#" + scene);
  if (scene === "chat") play(); else { if (scene === "switch") resetChat(); if (scene === "subs") subsChat(); render(); }
}
function toast(words) {
  var t = document.createElement("div"); t.className = "toast"; t.textContent = words; app.appendChild(t);
  setTimeout(function () { t.remove(); }, 1800);
}
function send() {
  var box = document.getElementById("box"), text = box.value.trim();
  if (!text) return;
  box.value = "";
  msgs.push({ by: "me", at: "now", text: text }); refresh();
  answer("me", { doing: "Reading the launch checklist", mood: "Working with files", variant: "file", title: "Looked at the checklist again", did: "Read launch-checklist.md", steps: 1 },
    "This is a mock-up, so I can only pretend. In the real thing Maya and Jon would see your message arrive, and my answer being written, at the same moment you do.");
}
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-do]");
  if (!el) return;
  if (el.classList.contains("veil") && e.target.closest("[data-stop]") && !e.target.closest("[data-stop] [data-do]")) return;
  var d = el.dataset.do.split(":"), a = d[0], v = d.slice(1).join(":");
  if (a === "go") go(v);
  else if (a === "menu") { view.menu = v || null; if (!v && view.scene === "switch") view.scene = "chat"; render(); }
  else if (a === "dialog") { view.dialog = v || null; if (!v && (view.scene === "invite")) view.scene = "members"; render(); }
  else if (a === "fold") { view.open[v] = !view.open[v]; render(); }
  else if (a === "list") { view.list = !view.list; render(); }
  else if (a === "panel") { view.panel = !view.panel; render(); }
  else if (a === "theme") { document.documentElement.classList.toggle("dark"); render(); }
  else if (a === "toast") toast(v);
  else if (a === "sent") { view.dialog = null; view.scene = "members"; render(); toast("2 invitations sent"); }
  else if (a === "send") send();
  e.stopPropagation();
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey && e.target.id === "box") { e.preventDefault(); send(); }
  if (e.key === "Escape" && (view.menu || view.dialog)) { view.menu = null; view.dialog = null; if (view.scene === "switch") view.scene = "chat"; if (view.scene === "invite") view.scene = "members"; render(); }
});
window.addEventListener("hashchange", function () { var s = location.hash.slice(1); if (s && s !== view.scene) go(s); });

resetChat();
var first = location.hash.slice(1) === "bots" ? "chat" : location.hash.slice(1);
go(SCENES.some(function (x) { return x[0] === first; }) ? first : "chat");
})();
