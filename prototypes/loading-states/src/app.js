/* Loading states mock-up. Everything here is pretend: the agents, what they say, and the network. */
(function () {
"use strict";

/* ---------- icons ---------- */
var P = {
plus:'<path d="M12 5v14M5 12h14"/>',
sort:'<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
down:'<path d="m6 9 6 6 6-6"/>',
left:'<path d="m15 6-6 6 6 6"/>',
bar:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14"/>',
chats:'<path d="M4 5h11v8H8l-4 3z"/><path d="M9 16h8l3 3V9h-2"/>',
gear:'<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
clip:'<path d="m20 11-8.500 8.500a5 5 0 0 1-7-7L13 4a3.300 3.300 0 0 1 4.700 4.700l-8.500 8.500a1.700 1.700 0 0 1-2.400-2.400L14.500 7"/>',
mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
up:'<path d="M12 19V5M6 11l6-6 6 6"/>',
okc:'<circle cx="12" cy="12" r="9"/><path d="m8 12.500 2.700 2.700L16 9.500"/>',
file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
folder:'<path d="M3 7.500A1.500 1.500 0 0 1 4.500 6h4.600l2 2.200h8.400A1.500 1.500 0 0 1 21 9.700v7.800a1.500 1.500 0 0 1-1.500 1.500h-15A1.500 1.500 0 0 1 3 17.500z"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.200 2"/>',
x:'<path d="M6 6l12 12M18 6 6 18"/>',
user:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.500 18.200a6.500 6.500 0 0 1 11 0"/>',
book:'<path d="M12 6c-2-1.500-5-1.500-8 0v13c3-1.500 6-1.500 8 0 2-1.500 5-1.500 8 0V6c-3-1.500-6-1.500-8 0zM12 6v13"/>',
chip:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
bolt:'<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
plug:'<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
shield:'<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/>',
chart:'<path d="M5 20V10M12 20V4M19 20v-7"/>'
};
function ic(n, s) { s = s || 18; return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + P[n] + "</svg>"; }

/* ---------- pretend data ---------- */
var AG = {
  pip: { name: "Pip", seed: "Juniper", color: "#5f8a4e", tag: "Keeps the launch on track",
    msgs: [["u", "What is still open on the launch checklist? We ship Thursday."],
      ["a", "<p>Three things are still open in <code>launch-checklist.md</code>:</p><ul><li><b>Pricing page copy</b>: there is a draft, not yet approved.</li><li><b>Status page</b>: nobody owns it.</li><li><b>Launch email</b>: written, waiting on the final price.</li></ul><p>Everything else is ticked.</p>"],
      ["u", "Put the status page under my name. I'll do it tonight."],
      ["a", "<p>Done. The status page is yours in the checklist, due Wednesday.</p>"]],
    runs: ["Gave the status page to Sawyer", "Read the launch checklist"],
    autos: [["Monday launch digest", "Every Monday at 9:00 AM"], ["Check the status page", "Every hour"]],
    files: ["launch-checklist.md", "announcement-draft.md", "embargo-list.md"],
    doc: ["Launch checklist", "Thursday is the day. Everything that has to be true before the announcement goes out is on this page, with a name beside it.", "Pricing page copy is drafted and waiting for an OK. The status page is Sawyer's, due Wednesday. The launch email is written and only needs the final price."] },
  ledger: { name: "Ledger", seed: "Wren", color: "#c9952c", tag: "Invoices, books and the weekly numbers",
    msgs: [["u", "How did last week compare with the week before?"],
      ["a", "<p>Revenue was up 8% on the week before, almost all of it from the two annual plans that renewed on Tuesday.</p><p>Costs were flat. The one thing to look at is the hosting bill, which is 14% over what it was a month ago.</p>"],
      ["u", "Why is hosting up?"],
      ["a", "<p>Two machines were left running after the load test on the 2nd. Stopping them brings it back to where it was.</p>"]],
    runs: ["Traced the hosting increase", "Compared two weeks of revenue", "Filed 6 invoices"],
    autos: [["Weekly numbers", "Every Friday at 4:00 PM"]],
    files: ["weekly-numbers.md", "invoices-october.csv", "hosting-costs.md"],
    doc: ["Weekly numbers", "Revenue was up 8% on the week before. Two annual plans renewed on Tuesday and account for nearly all of it.", "Costs were flat apart from hosting, which is 14% over last month because of two machines left running after a load test."] },
  scout: { name: "Scout", seed: "Tarn", color: "#3f7f9c", tag: "Reads the internet so you do not have to",
    msgs: [["u", "Anything new from the three competitors this week?"],
      ["a", "<p>One thing worth your time: Harbor changed its free plan from five seats to three, and said so only in a changelog entry.</p><p>The other two published nothing but hiring posts.</p>"],
      ["u", "Keep an eye on Harbor's pricing page."],
      ["a", "<p>I will check it every morning and tell you the day it changes.</p>"]],
    runs: ["Set a daily check on Harbor's pricing", "Read 41 pages across three sites"],
    autos: [["Harbor pricing watch", "Every day at 8:00 AM"], ["Competitor roundup", "Every Monday at 8:30 AM"], ["Mentions of us", "Every 6 hours"]],
    files: ["competitors.md", "harbor-pricing-history.md", "reading-list.md"],
    doc: ["Competitors", "Three companies are watched: Harbor, Northlight and Quay. Each has a section below with what changed and when.", "Harbor cut its free plan from five seats to three this week. Northlight and Quay published only hiring posts."] },
  mochi: { name: "Mochi", seed: "Pilar", color: "#c0607a", tag: "Yours alone",
    msgs: [["u", "Remind me what I said I'd do this weekend."],
      ["a", "<p>Three things: fix the bike's back brake, call your sister on Saturday morning, and read the first two chapters for book club.</p>"],
      ["u", "Move the call to Sunday."],
      ["a", "<p>Moved. I will remind you on Sunday at ten.</p>"]],
    runs: ["Moved the call to Sunday"],
    autos: [["Sunday call reminder", "Once, Sunday at 10:00 AM"]],
    files: ["weekend.md", "book-club-notes.md"],
    doc: ["Weekend", "Fix the bike's back brake. Call your sister, now on Sunday at ten. Read the first two chapters for book club.", "Nothing else is written down for these two days."] }
};
var ORDER = ["pip", "ledger", "scout", "mochi"];
var SECTIONS = [["identity", "Identity", "user"], ["memory", "Memory", "book"], ["model", "Model and computer", "chip"], ["skills", "Skills", "bolt"], ["connectors", "Connectors", "plug"], ["permissions", "Permissions", "shield"], ["usage", "Usage", "chart"]];
/* The sections whose contents are the agent's own state, which is already here once it is open. */
var HERE = { identity: 1, memory: 1 };

/* ---------- the pretend app ---------- */
var mode = "new", L = 150, preload = true, hold = false;
/* What the frame shows, and, apart from it, what the tab mark and the sidebar say. Today those two move before the page under them does. */
var view = { agent: "pip", tab: "chat", settings: null };
var mark = { tab: "chat", lib: false };
var boot = null, bootOut = false;
var have = { "chat:pip": 1 }, waiting = {}, arrived = {};
var token = 0, clock = { label: "", t0: 0, first: null, done: null };

function k(kind, agent) { return kind + ":" + (agent || view.agent); }
/* Ask for something. It arrives one trip later, is kept from then on, and whoever asked is told. */
function get(key, then) {
  if (have[key]) { if (then) then(); return; }
  var w = waiting[key];
  if (w) { if (then) w.push(then); return; }
  w = waiting[key] = then ? [then] : [];
  var land = function () {
    if (hold) { held.push(land); return; }
    have[key] = 1; arrived[key] = 1; delete waiting[key];
    w.forEach(function (f) { f(); });
    render();
  };
  setTimeout(land, L);
}
var held = [];
function after(ms, token0, f) { setTimeout(function () { if (token0 === token) f(); }, ms); }
function begin(label) { token++; clock = { label: label, t0: performance.now(), first: null, done: null }; return token; }
function changed() { if (clock.first === null) clock.first = performance.now() - clock.t0; }
function finished() { changed(); if (clock.done === null) clock.done = performance.now() - clock.t0; bar(); }

function goAgent(id) {
  if (id === view.agent && view.tab === "chat") return;
  var t = begin("Open " + AG[id].name), key = k("chat", id);
  var show = function () { view.agent = id; view.tab = mark.tab = "chat"; mark.lib = false; changed(); render(); get(key, function () { if (t === token) finished(); }); };
  // Today: who is signed in is asked, then the agent's state, then where to go, then who is signed in again. Only then does the frame move.
  if (mode === "old") after(3 * L, t, show); else show();
  bar();
}
function goTab(tab) {
  if (tab === view.tab && tab === mark.tab) return;
  var t = begin(tab === "chat" ? "Chat tab" : tab === "library" ? "Library tab" : "Automations tab"), key = k(tab);
  var show = function () { view.tab = mark.tab = tab; mark.lib = tab === "library"; changed(); render(); get(key, function () { if (t === token) finished(); }); };
  if (mode === "old") {
    // Today the tab mark and the sidebar move at once and the page under them one trip later.
    mark.tab = tab; mark.lib = tab === "library"; changed(); render();
    after(L, t, show);
  } else show();
  bar();
}
function goSettings(section) {
  var t = begin(section === null ? "Close settings" : "Settings: " + SECTIONS.filter(function (s) { return s[0] === section; })[0][1]);
  var show = function () {
    view.settings = section; changed(); render();
    if (section === null || HERE[section]) finished(); else get(k("set-" + section), function () { if (t === token) finished(); });
  };
  if (mode === "old") after(L, t, show); else show();
  bar();
}
function reload() {
  var t = begin("Reload the page"), agent = view.agent;
  have = {}; waiting = {}; view.settings = null;
  // 350 ms stands for the page's own script arriving and starting.
  if (mode === "old") {
    boot = "black"; render();
    after(350 + 2 * L, t, function () { boot = null; changed(); render(); get(k("chat", agent), function () { if (t === token) finished(); }); if (view.tab !== "chat") get(k(view.tab, agent)); });
  } else {
    boot = "skeleton"; clock.first = 0; render();
    var open = function () { if (t !== token) return; bootOut = true; render(); setTimeout(function () { boot = null; bootOut = false; render(); }, 150); finished(); };
    setTimeout(function () { if (view.tab !== "chat") get(k(view.tab, agent)); get(k("chat", agent), open); }, 350);
  }
  bar();
}

/* ---------- pieces ---------- */
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function orb(key, size, still) {
  var a = AG[key];
  return '<span class="orb" style="width:' + size + "px;height:" + size + 'px">' + (still ? "" : '<canvas data-agent="' + key + '" data-size="' + size + '"></canvas>') +
    '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="35" rx="23" ry="22" fill="' + a.color + '"/><ellipse cx="24" cy="33" rx="5" ry="6.500" fill="#fff"/><ellipse cx="40" cy="33" rx="5" ry="6.500" fill="#fff"/><circle cx="25" cy="34" r="2.600" fill="#16181d"/><circle cx="41" cy="34" r="2.600" fill="#16181d"/></svg></span>';
}
function sk(w, h, cls) { return '<span class="sk ' + (cls || "") + '" style="display:block;width:' + w + ";height:" + h + 'px"></span>'; }
function lines(ws) { return ws.map(function (w) { return sk(w, 10, "line"); }).join(""); }
/* How a region is drawn for something asked for: what it is, or what stands in until it arrives. */
function fill(key, content, skeleton, today) {
  if (have[key]) return '<div class="' + (arrived[key] ? "arrive" : "") + '" style="display:contents">' + content() + "</div>";
  return mode === "old" ? (today || "") : '<div class="late" style="display:contents" aria-busy="true">' + skeleton + "</div>";
}
var SK_CHAT = '<div class="msgs">' + sk("44%", 42, "sku") + '<div class="skb" style="width:62%">' + lines(["92%", "100%", "78%", "40%"]) + "</div>" + sk("30%", 42, "sku") + '<div class="skb" style="width:48%">' + lines(["100%", "64%"]) + "</div></div>";
var SK_RUNS = [0, 1, 2].map(function (i) { return '<div class="run">' + sk("16px", 16, "c") + sk(["68%", "52%", "60%"][i], 10, "line") + "</div>"; }).join("");
var SK_CARDS = [0, 1].map(function (i) { return '<div class="card"><div class="grow" style="display:flex;flex-direction:column;gap:9px">' + sk(["38%", "30%"][i], 12, "line") + sk(["24%", "18%"][i], 10, "line") + "</div>" + sk("34px", 20, "c") + "</div>"; }).join("");
var SK_TREE = [0, 1, 2].map(function (i) { return '<div class="frow">' + sk("16px", 16) + sk(["62%", "74%", "48%"][i], 10, "line") + "</div>"; }).join("");
var SK_DOC = '<div class="doc">' + sk("46%", 30) + '<div style="display:flex;flex-direction:column;gap:13px;margin-top:26px">' + lines(["100%", "96%", "88%", "34%"]) + '</div><div style="display:flex;flex-direction:column;gap:13px;margin-top:30px">' + lines(["98%", "100%", "62%"]) + "</div></div>";
var SK_FORM = [0, 1, 2].map(function (i) { return '<div class="fld">' + sk(["90px", "120px", "70px"][i], 12, "line") + sk("100%", i === 2 ? 74 : 38) + "</div>"; }).join("");

function transcript(agent) {
  return fill(k("chat", agent), function () {
    return '<div class="msgs">' + AG[agent].msgs.map(function (m) { return '<div class="bub ' + m[0] + '">' + (m[0] === "u" ? esc(m[1]) : m[1]) + "</div>"; }).join("") + "</div>";
  }, SK_CHAT);
}
function composer(agent) {
  return '<div class="comp">' + ic("clip") + '<span class="grow">Message ' + AG[agent].name + "</span>" + ic("mic") + '<span class="send">' + ic("up", 16) + "</span></div>";
}
function body() {
  var a = AG[view.agent];
  if (view.tab === "chat") return '<div class="scroll">' + transcript(view.agent) + "</div>" + composer(view.agent);
  if (view.tab === "automations") {
    return '<div class="page"><div class="col"><div><h1>Automations</h1><p class="mut">Things your agent does on its own, once or on a schedule. To add one, ask in chat: “Every weekday at 9, tell me what is on my calendar.”</p></div><div style="display:flex;flex-direction:column;gap:12px">' +
      fill(k("automations"), function () { return a.autos.map(function (s) { return '<div class="card">' + ic("clock") + '<div class="grow"><div class="t">' + s[0] + '</div><div class="mut" style="font-size:13px">' + s[1] + '</div></div><span class="sw"></span></div>'; }).join(""); }, SK_CARDS) +
      "</div></div></div>";
  }
  return '<div class="page">' + fill(k("library"), function () { return '<div class="doc"><h1>' + a.doc[0] + "</h1><p>" + a.doc[1] + "</p><p>" + a.doc[2] + "</p></div>"; }, SK_DOC) + "</div>";
}
function side() {
  var a = AG[view.agent];
  var head = '<div class="ws"><span class="pf">SA</span><span>Personal</span><span class="mut">' + ic("sort", 14) + '</span><span class="grow"></span><span class="ib">' + ic("bar") + "</span></div>";
  var foot = '<div class="me"><span class="pf">SA</span><span class="grow">Sawyer</span><span class="mut">' + ic("sort", 14) + "</span></div>";
  if (mark.lib) {
    // Today the sidebar's list is put there by the library page, so it is empty until that page is.
    var shown = mode === "new" || view.tab === "library";
    return head + '<button class="back" data-tab="chat">' + ic("left", 14) + orb(view.agent, 20, true) + "<span>Agents</span></button>" + '<div class="tree">' +
      (shown ? fill(k("library"), function () { return a.files.map(function (f, i) { return '<div class="frow' + (i === 0 ? " sel" : "") + '">' + ic("file", 16) + '<span class="trunc">' + f + "</span></div>"; }).join(""); }, SK_TREE) : "") + "</div>" + foot;
  }
  return head + '<div class="cap"><span class="grow">Agents</span><span class="ib">' + ic("plus") + '</span></div><div class="agents">' +
    ORDER.map(function (id) { return '<button class="arow" data-agent="' + id + '">' + orb(id, 40) + '<span class="grow"><span class="n trunc" style="display:block">' + AG[id].name + '</span><span class="s trunc" style="display:block">' + AG[id].tag + "</span></span></button>"; }).join("") + "</div>" + foot;
}
function strip() {
  var a = AG[view.agent];
  return '<button class="who">' + orb(view.agent, 28) + "<span>" + a.name + '</span><span class="mut">' + ic("down", 12) + '</span></button><div class="tabs">' +
    [["chat", "Chat"], ["library", "Library"], ["automations", "Automations"]].map(function (t) { return '<button class="tab" data-tab="' + t[0] + '">' + t[1] + "</button>"; }).join("") +
    '</div><span class="grow"></span><span class="sc">' + ic("chats", 16) + 'Side chats</span><button class="ib" data-settings="identity" title="Settings">' + ic("gear") + '</button><span class="ib" style="color:var(--foreground)">' + ic("bar") + "</span>";
}
function pmood() {
  // Today the panel says the agent is ready before anything has been heard from it.
  return fill(k("chat"), function () { return "Ready"; }, sk("64px", 10, "line"), "Ready");
}
function plist() {
  var a = AG[view.agent];
  if (view.tab !== "chat") return "";
  return '<div class="cap">What it did here</div>' + fill(k("chat"), function () {
    return a.runs.map(function (r) { return '<div class="run"><span class="mut">' + ic("okc", 16) + '</span><span class="trunc">' + r + "</span></div>"; }).join("");
  }, SK_RUNS, '<p class="none">Nothing yet. When ' + a.name + " gets something substantial done in this chat, it notes it here, with its steps inside.</p>");
}
function modal() {
  if (view.settings === null) return "";
  var a = AG[view.agent], s = view.settings, title = SECTIONS.filter(function (x) { return x[0] === s; })[0][1], inner;
  if (s === "identity") inner = '<div class="fld"><label>Name</label><div class="inp">' + a.name + '</div></div><div class="fld"><label>Tagline</label><div class="inp">' + a.tag + '</div></div><div class="fld"><label>Personality</label><div class="inp tall mut">You are…</div></div>';
  else if (s === "memory") inner = '<div class="fld"><label>About you</label><div class="inp tall">Sawyer. Ships on Thursdays. Prefers short answers.</div></div><div class="fld"><label>What it has learned</label><div class="inp tall">The launch checklist lives in the library.</div></div>';
  else inner = fill(k("set-" + s), function () {
    if (s === "usage") return '<div class="fld"><label>This month</label><div class="mut">412 messages · $3.18</div><div class="bars">' + [30, 55, 42, 80, 64, 38, 90, 71, 48, 60, 35, 76].map(function (h) { return '<i style="height:' + h + '%"></i>'; }).join("") + "</div></div>";
    if (s === "model") return '<div class="fld"><label>Model</label><div class="inp">Claude Sonnet</div></div><div class="fld"><label>Computers</label><div class="inp"><span style="font-family:var(--mono)">computer-1</span>&nbsp;&nbsp;<span class="mut">Built-in shell</span></div></div><div class="fld"><label>When a message arrives while it is working</label><div class="inp">Change the answer</div></div>';
    return '<div class="fld"><label>' + title + '</label><div class="inp">Web search</div></div><div class="fld"><div class="inp">Calendar</div></div><div class="fld"><div class="inp">GitHub</div></div>';
  }, SK_FORM);
  return '<div class="veil" data-close><div class="dlg"><div class="snav"><div class="h">' + orb(view.agent, 32, true) + "<span>" + a.name + "<small>Agent settings</small></span></div>" +
    SECTIONS.map(function (x) { return '<button class="sn' + (x[0] === s ? " on" : "") + '" data-settings="' + x[0] + '">' + ic(x[2], 16) + x[1] + "</button>"; }).join("") +
    '</div><div class="sbody"><button class="ib x" data-close>' + ic("x") + "</button><h2>" + title + "</h2>" + inner + "</div></div></div>";
}
function bootView() {
  if (boot === null) return "";
  if (boot === "black") return '<div class="bootv black"></div>';
  var row = function (w) { return '<div class="arow">' + sk("40px", 40, "c") + '<span class="grow" style="display:flex;flex-direction:column;gap:8px">' + sk(w, 11, "line") + sk("70%", 9, "line") + "</span></div>"; };
  return '<div class="bootv' + (bootOut ? " out" : "") + '"><div class="side"><div class="ws">' + sk("28px", 28, "c") + sk("84px", 12, "line") + '</div><div class="cap">Agents</div><div class="agents">' + row("40%") + row("52%") + row("36%") + '</div><div class="me">' + sk("28px", 28, "c") + sk("70px", 11, "line") + '</div></div>' +
    '<div class="main"><div class="strip">' + sk("28px", 28, "c") + sk("70px", 13, "line") + '<div class="tabs" style="opacity:.5"><span class="tab">Chat</span><span class="tab">Library</span><span class="tab">Automations</span></div></div>' +
    '<div class="under"><div class="body"><div class="scroll">' + SK_CHAT + '</div><div class="comp"></div></div><div class="panel"><div class="ptop"><span style="width:208px;height:208px;display:grid;place-items:center">' + sk("168px", 168, "c") + '</span><h2 style="height:26px;display:flex;align-items:center">' + sk("90px", 13, "line") + '</h2></div><div class="pmood">' + sk("64px", 10, "line") + '</div><div class="plist"><div class="cap">What it did here</div>' + SK_RUNS + "</div></div></div></div></div>";
}

/* ---------- drawing ---------- */
var app = document.getElementById("app");
app.innerHTML = '<aside class="side" id="r-side"></aside><div class="main"><header class="strip" id="r-strip"></header><div class="under"><div class="body" id="r-body"></div><aside class="panel"><div class="ptop" id="r-ptop"></div><div class="pmood" id="r-pmood"></div><div class="plist" id="r-plist"></div></aside></div></div><div id="r-modal"></div><div id="r-boot"></div>';
var drawn = {};
var core = window.THREE && window.AgentOrbCore ? window.AgentOrbCore(window.THREE) : null;
if (core && !core.Stage.get("px")) core = null;
function patch(id, html) {
  // Only what changed is drawn again, so a creature that stays is not made anew.
  if (drawn[id] === html) return;
  var el = document.getElementById("r-" + id);
  el.querySelectorAll("canvas").forEach(function (cv) { if (cv._orb) cv._orb.dispose(); });
  el.innerHTML = html; drawn[id] = html;
  if (!core) return;
  var dark = document.documentElement.classList.contains("dark");
  el.querySelectorAll(".orb canvas").forEach(function (cv) {
    var a = AG[cv.dataset.agent], size = +cv.dataset.size;
    cv._orb = core.createOrb(cv, { seed: a.seed, color: a.color, size: Math.round(size * 1.24), dark: dark, slow: size < 60, notice: size >= 60 });
    cv.nextElementSibling.style.display = "none";
  });
}
function render() {
  var a = AG[view.agent];
  document.documentElement.style.setProperty("--agent-color", a.color);
  patch("side", side());
  patch("strip", strip());
  patch("body", body());
  patch("ptop", orb(view.agent, 208) + "<h2>" + a.name + "</h2>");
  patch("pmood", pmood());
  patch("plist", plist());
  patch("modal", modal());
  patch("boot", bootView());
  // Marks are set on what is there, and not drawn again.
  document.querySelectorAll("#r-side .arow").forEach(function (el) { el.classList.toggle("sel", el.dataset.agent === view.agent); });
  document.querySelectorAll("#r-strip .tab").forEach(function (el) { el.classList.toggle("on", el.dataset.tab === mark.tab); });
  arrived = {};
}
if (core) window.addEventListener("pointermove", function (e) { core.Runner.orbs.forEach(function (o) { if (o.notice) o.setPointer(e.clientX, e.clientY); }); }, { passive: true });

app.addEventListener("click", function (e) {
  var t = e.target.closest("[data-agent],[data-tab],[data-settings],[data-close]");
  if (!t || (t.tagName === "CANVAS")) return;
  if (t.dataset.settings) return goSettings(t.dataset.settings);
  if ("close" in t.dataset) { if (e.target === t || t.tagName === "BUTTON") goSettings(null); return; }
  if (t.dataset.tab) return goTab(t.dataset.tab);
  if (t.dataset.agent) return goAgent(t.dataset.agent);
});
/* Proposed: pointing at something starts fetching it, so that it is often here by the click. */
app.addEventListener("pointerover", function (e) {
  if (mode !== "new" || !preload) return;
  var t = e.target.closest("button[data-agent],button[data-tab]");
  if (!t) return;
  if (t.dataset.agent) get(k("chat", t.dataset.agent)); else if (t.dataset.tab !== "chat") get(k(t.dataset.tab));
});

/* ---------- the bar along the bottom ---------- */
var barEl = document.getElementById("bar");
var SAY = {
  old: "<b>Today.</b> A click asks who is signed in, then for the agent, then where to go, then who is signed in again. Nothing moves until all of that is back; then the chat is empty until its stream answers.",
  new: "<b>Proposed.</b> The click moves the frame at once: the agent's row, name, creature and color are already known. What is not here yet has a placeholder its own shape; what was seen before is shown as it was and refreshed."
};
function ms(n) { return Math.round(n / 10) * 10 + " ms"; }
function bar() {
  var c = clock, read = "";
  if (c.label) {
    var cls = mode === "old" ? "bad" : "good";
    read = "<b>" + c.label + "</b> · something moves: <b class='" + cls + "'>" + (c.first === null ? "…" : c.first < 20 ? "at once" : ms(c.first)) + "</b> · everything is there: <b class='" + cls + "'>" + (c.done === null ? "…" : c.done < 20 ? "at once" : ms(c.done)) + "</b>";
  }
  var b = function (on, attr, label) { return '<button class="' + (on ? "on" : "") + '" ' + attr + ">" + label + "</button>"; };
  barEl.innerHTML = '<div class="row"><span class="lab">Mock-up</span>' + b(mode === "old", 'data-mode="old"', "Today") + b(mode === "new", 'data-mode="new"', "Proposed") +
    '<span class="lab">Each trip to the server takes</span>' + [[60, "60 ms"], [150, "150 ms"], [400, "400 ms"], [1000, "1 s"]].map(function (x) { return b(L === x[0], 'data-l="' + x[0] + '"', x[1]); }).join("") +
    '<span class="lab">Proposed only</span>' + b(preload, "data-preload", "Fetch on hover") + b(hold, "data-hold", "Hold the placeholders") +
    '<span class="sp"></span><button class="act" data-forget>Forget what was loaded</button><button class="act" data-reload>Reload the page</button><button class="act" data-theme>Light / dark</button></div>' +
    '<div class="row"><span class="say grow">' + SAY[mode] + '</span><span class="read">' + read + "</span></div>";
}
barEl.addEventListener("click", function (e) {
  var t = e.target.closest("button"); if (!t) return;
  var d = t.dataset;
  if (d.mode) { mode = d.mode; mark.tab = view.tab; mark.lib = view.tab === "library"; clock.label = ""; drawn = {}; render(); }
  else if (d.l) L = +d.l;
  else if ("preload" in d) preload = !preload;
  else if ("hold" in d) { hold = !hold; if (!hold) { var h = held; held = []; h.forEach(function (f) { f(); }); } }
  else if ("forget" in d) { have = {}; have[k("chat")] = 1; if (view.tab !== "chat") have[k(view.tab)] = 1; }
  else if ("reload" in d) return reload();
  else if ("theme" in d) { document.documentElement.classList.toggle("dark"); drawn = {}; render(); }
  bar();
});

/* An address can set the scene, for a picture of it: #old or #new, then hold, l=400, and a place such as agent=scout, tab=library, settings=usage or reload. */
location.hash.slice(1).split(",").forEach(function (part) {
  var kv = part.split("=");
  if (kv[0] === "old" || kv[0] === "new") mode = kv[0];
  if (kv[0] === "hold") hold = true;
  if (kv[0] === "l") L = +kv[1];
  if (kv[0] === "light") document.documentElement.classList.remove("dark");
});
render(); bar();
location.hash.slice(1).split(",").forEach(function (part) {
  var kv = part.split("=");
  if (kv[0] === "agent") goAgent(kv[1]);
  if (kv[0] === "tab") goTab(kv[1]);
  if (kv[0] === "settings") goSettings(kv[1]);
  if (kv[0] === "reload") reload();
});
})();
