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

