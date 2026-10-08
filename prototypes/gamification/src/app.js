/* Gamification mock-up. ../agent-pages/src/head.js (icons, pretend people and agents, the
   creature) opens the function this file closes. wear.js, before it, is what a creature can wear. */

P.down = '<path d="m6 9 6 6 6-6"/>';
P.left = '<path d="m15 6-6 6 6 6"/>';
P.sideL = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/>';
P.side = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M15 4.5v15"/>';
P.aside = '<path d="M3.5 5h11.5v8.5H8.5l-3 2.5v-2.5h-2z"/><path d="M18 9h2.5v8.5H19V20l-3-2.5h-4.5v-1"/>';
P.shirt = '<path d="M8.500 4 3 7l2 4 2.500-1.200V20h9V9.800L19 11l2-4-5.500-3a3.500 3.500 0 0 1-7 0z"/>';
P.shuffle = '<path d="M3 7h3.500l9 10H20M3 17h3.500l2.700-3M13.300 9l2.200-2H20M18 5l2 2-2 2M18 15l2 2-2 2"/>';

/* ---------- pixel pictures: the treats, the box, a heart, a sparkle ---------- */
var PAL = { k: "#1b1d23", w: "#f6f3ea", s: "#d3cdbb", n: "#24382c", r: "#e5484d", R: "#b02a37", g: "#5fbf4a", b: "#7a4a2a", B: "#4f2f1a", t: "#dba968", T: "#b97a45", p: "#ff8fb3", Q: "#e0608a", y: "#ffd23f", c: "#2bb5a8", d: "#1f8a80", h: "#ffffff" };
var GIFT = ["....yy..yy....", "...y..yy..y...", "....y.yy.y....", ".kkkkkyykkkkk.", ".kccccyycccdk.", ".kccccyycccdk.", ".kkkkkyykkkkk.", "..kcccyyccdk..", "..kcccyyccdk..", "..kcccyyccdk..", "..kcccyyccdk..", "..kdddyydddk..", "..kkkkkkkkkk.."];
var ART = {
  onigiri: ["....kkkk....", "...kwwwwk...", "..kwwwwwwk..", "..kwwwwwwk..", ".kwwwwwwwwk.", ".kwwwwwwwsk.", "kwwwnnnnwwsk", "kwwwnnnnwwsk", "kwwsnnnnwssk", "kssknnnnkssk", ".kkkkkkkkkk."],
  cookie: ["...kkkkkk...", "..kttttttk..", ".kttBttttTk.", "kttttttBttTk", "kttttttttTTk", "ktBttttttTTk", "kttttBtttTTk", "ktttttttBTTk", ".kttBtttTTk.", "..kTTTTTTk..", "...kkkkkk..."],
  apple: ["......kk....", ".....kgk....", "..kkkbkkkk..", ".krrrbrrrrk.", "krrhrrrrrrRk", "krhrrrrrrrRk", "krrrrrrrrrRk", "krrrrrrrrRRk", ".krrrrrrRRk.", ".krrrrrRRRk.", "..kkkkkkkk.."],
  donut: ["...kkkkkk...", "..kppppppk..", ".kpyppppcpk.", "kppppkkpppQk", "kpcpk..kpyQk", "kpppk..kppQk", "kpypkkkkpcQk", "ktppppppyQtk", ".kttppppttk.", "..kttttttk..", "...kkkkkk..."],
  gift: GIFT, lid: GIFT.slice(0, 7), base: GIFT.slice(7),
  heart: [".kk.kk.", "krrkrrk", "krhrrrk", "krrrrrk", ".krrrk.", "..krk..", "...k..."],
  spark: ["..y..", "..y..", "yyhyy", "..y..", "..y.."]
};
var SPR = {};
Object.keys(ART).forEach(function (name) {
  var rows = ART[name], c = document.createElement("canvas"), x;
  c.width = rows[0].length; c.height = rows.length; x = c.getContext("2d");
  rows.forEach(function (row, j) { for (var i = 0; i < row.length; i++) if (row[i] !== ".") { x.fillStyle = PAL[row[i]]; x.fillRect(i, j, 1, 1); } });
  SPR[name] = c.toDataURL();
});
function px(name, size, cls) { return `<img class="px ${cls || ""}" src="${SPR[name]}" style="width:${size}px" alt="" draggable="false">`; }
var TREATS = { onigiri: "#f6f3ea", cookie: "#dba968", apple: "#e5484d", donut: "#ff8fb3" };

/* ---------- what there is to wear: a hundred things, in four places and five rarities ---------- */
var ITEMS = Wear ? Wear.ITEMS : {}, ORDER = Wear ? Wear.ORDER : [], SLOTS = Wear ? Wear.SLOTS : ["hat", "glasses", "face", "neck"], RARS = Wear ? Wear.RARITIES : [];
if (Wear) Wear.core = core;
var SLOT_NAMES = { hat: "Hats", glasses: "Glasses", face: "Face", neck: "Neck" };
var SLOT_ONE = { hat: "Hat", glasses: "Glasses", face: "Face", neck: "Neck" };
/* `odds` is how many boxes in a hundred hold one of that rarity. */
var RAR = {
  common: { name: "Common", c: "#9aa3ad", odds: 60 }, uncommon: { name: "Uncommon", c: "#4fbf67", odds: 25 }, rare: { name: "Rare", c: "#4a9bff", odds: 10 },
  epic: { name: "Epic", c: "#b266ff", odds: 4 }, legendary: { name: "Legendary", c: "#ffb92e", odds: 1 }
};
var BY_SLOT = {};
SLOTS.forEach(function (s) { BY_SLOT[s] = ORDER.filter(function (id) { return ITEMS[id].slot === s; }); });
var START = ["party", "beanie", "sprout", "cap", "round", "shades", "blush", "moustache", "bowtie", "scarf"];
function nameOf(id) { return ITEMS[id] ? ITEMS[id].name : id; }
function rarOf(id) { return RAR[ITEMS[id].rarity]; }
function found() { return ORDER.filter(function (id) { return view.owned[id]; }).length; }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

var app = document.getElementById("app"), strip = document.getElementById("strip");
var SCENES = [["panel", "1 · Treats"], ["earn", "2 · Earning one"], ["box", "3 · A box"], null, ["wardrobe", "4 · Wardrobe"], null, ["phone", "5 · On a phone"], ["bodies", "6 · On any body"]];
var NOTES = {
  panel: ["Nothing added to the panel but two small things beside Pip.", "Its treats on the left, its next box on the right, and a wardrobe button by its name. Drag a treat onto Pip, or press it. Treats are extras: Pip never needs one. Each one fills the box a little; two from here fill it."],
  earn: ["Where treats come from.", "Pip earns one each time it finishes a task for you, so they come from using it. It lands on the pile and nothing is said in the chat. Send a message to see it again."],
  box: ["A box.", "Enough treats and Pip finds a box. Press it. Inside is one thing to wear that Pip does not have yet, picked at random: usually common, now and then rare. Open as many as you like here."],
  wardrobe: ["The wardrobe: 100 things.", "41 for the head, 20 for the eyes, 20 for the face, 19 for the neck, in five rarities. Every tile is Pip itself wearing the thing. Here all of them are shown and can be tried on; turn the switch off to see it as Pip's owner would."],
  phone: ["On a phone.", "There is no panel on a phone, so the chat stays exactly as it is and Pip gets a page of its own, opened from its picture. Treats work on the middle phone."],
  bodies: ["On any body (not a screen in the app).", "Twelve creatures grown from random seeds. A stiff hat is lowered until it touches the head, ears fold out from under it, and a soft one is made from the skin itself, so nothing sits inside a head. The button checks that on hundreds more."]
};

/* What is on screen, and how Pip is. `joy` of NEED fills the box; `box` is one waiting to be opened. */
var NEED = 4;
var view = { scene: "panel", list: true, panel: true, tab: "hat", tryOn: null, step: 0, all: true };
var wear = { pip: { hat: "party" }, ledger: { glasses: "round", neck: "bowtie" }, scout: { hat: "headphones" }, mochi: { hat: "sprout", face: "blush" } };
var timers = [], eating = false;
function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
function setUp(over) {
  var owned = {};
  START.forEach(function (id) { owned[id] = true; });
  Object.assign(view, { treats: ["apple", "onigiri", "cookie"], joy: 2, box: false, loot: null, owned: owned, tab: "hat", tryOn: null, step: 0, mood: "Ready" }, over || {});
}
var KEYS = ["pip", "ledger", "scout", "mochi"];
var LINE = {
  pip: { words: "The status page is yours, due Wednesday", at: "now" },
  ledger: { words: "Priya: can you total October?", at: "52m" },
  scout: { words: "Three launches worth a look this week", at: "Tue" },
  mochi: { words: "Your notes from Monday are filed", at: "Mon" }
};

/* ---------- the creature, dressed ---------- */
function critter(key, size, o) {
  o = o || {};
  var h = orb(key, size, { id: o.id });
  if (o.wear) h = h.replace("<canvas ", '<canvas data-wear="' + esc(JSON.stringify(o.wear)) + '" ');
  return o.tile ? h.replace("<canvas ", "<canvas data-tile ") : h;
}
function outfitFor(cv) {
  var w = cv.dataset.wear ? JSON.parse(cv.dataset.wear) : wear[cv.dataset.agent] || {};
  if (cv.dataset.id === "stage" && view.tryOn) { w = Object.assign({}, w); w[view.tryOn.slot] = view.tryOn.id; }
  return w;
}
/* Creatures whose canvas has gone are let go; new canvases get one; all of them are dressed. One
   in a tile of the wardrobe keeps still after a moment, and moves while the pointer is on it. */
function mount() {
  if (!core) return;
  orbs = orbs.filter(function (o) {
    if (document.contains(o.canvas)) return true;
    if (Wear) Wear.strip(o);
    o.dispose();
    return false;
  });
  named = {};
  var dark = document.documentElement.classList.contains("dark");
  document.querySelectorAll(".orb canvas").forEach(function (cv) {
    var o = cv._orb;
    if (!o) {
      var a = AGENTS[cv.dataset.agent], size = +cv.dataset.size;
      o = cv._orb = core.createOrb(cv, { seed: a.seed, color: a.color, size: Math.round(size * 1.24), dark: dark, slow: size < 60 });
      cv.nextElementSibling.style.display = "none";
      orbs.push(o);
      if (cv.hasAttribute("data-tile")) setTimeout(function () { if (!o.hover) o.paused = true; }, 1300);
    }
    if (Wear) Wear.dress(o, outfitFor(cv));
    if (cv.dataset.id) named[cv.dataset.id] = o;
  });
}
function hover(e, on) {
  var t = e.target.closest && e.target.closest(".wtile"), cv = t && t.querySelector("canvas[data-tile]");
  if (cv && cv._orb) { cv._orb.hover = on; cv._orb.paused = !on; }
}
document.addEventListener("pointerover", function (e) { hover(e, true); });
document.addEventListener("pointerout", function (e) { hover(e, false); });
function $(sel) { return document.querySelector(sel); }
function act2(id, state) { if (named[id]) named[id].setState(state); }

/* ---------- the sidebar and the agent's strip, as they are in the app ---------- */
function side() {
  var row = (key) => {
    var a = AGENTS[key], l = LINE[key], cur = key === "pip";
    return `<div class="arow${cur ? " sel cur" : ""}" data-do="${cur ? "go:panel" : "toast:Only Pip is in this mock-up"}">${critter(key, 40)}<span class="grow"><div class="t"><span class="grow trunc">${a.name}</span><span class="end">${l.at}</span></div><div class="s"><span class="trunc">${esc(l.words)}</span></div></span></div>`;
  };
  return `<aside class="side"><div class="ws-h"><button class="wsw" data-do="toast:The workspace menu is as it is today">${tile("T", TEAM.c, 26)}<b class="trunc">Tidewater</b><span class="mut">${ic("sort", 13)}</span></button><button class="ib" data-do="list" title="Hide the sidebar">${ic("sideL", 17)}</button></div>` +
    `<div class="side-h" style="padding-top:8px"><h2 class="lbl">Agents</h2><button class="ib" data-do="toast:New agent" title="New agent">${ic("plus", 17)}</button></div><div class="chats flat">${KEYS.map(row).join("")}</div>` +
    `<div class="side-f me"><button class="prow" data-do="toast:Your menu is as it is today">${face("me", 26, "on")}<span class="grow trunc">Sawyer Hood</span><span class="mut">${ic("sort", 13)}</span></button></div></aside>`;
}
function ahead() {
  var t = (label, on) => `<button class="tab${on ? " on" : ""}" data-do="${on ? "go:panel" : "toast:" + label + " is as it is today"}">${label}</button>`;
  return '<header class="ahead">' + (view.list ? "" : `<button class="ib" data-do="list" title="Show the sidebar" style="margin-left:-6px">${ic("sideL", 17)}</button>`) +
    `<button class="who" data-do="toast:Another agent, as today">${critter("pip", 26)}<b>Pip</b><span class="mut">${ic("down", 13)}</span></button>` +
    `<nav class="tabs">${t("Chat", true)}${t("Library")}${t("Automations")}</nav><span class="grow"></span>${stack(["me", "maya"], 26)}` +
    `<button class="scb" data-do="toast:Side chats, as today">${ic("aside", 17)}Side chats<span class="n">5</span></button>` +
    `<span class="acts"><button class="ib" data-do="toast:Pip's settings, as today" title="Pip's settings">${ic("gear", 17)}</button><button class="ib${view.panel ? " on" : ""}" data-do="panel" title="Pip's panel">${ic("side", 17)}</button></span></header>`;
}

/* ---------- what is said ---------- */
function message(m) {
  if (m.day) return `<div class="dayd">${m.day}</div>`;
  if (m.tool) return `<div class="m"><div class="tool">${m.live ? `<span class="shine">${m.tool}</span>` : `<span>${m.tool}</span>`}</div></div>`;
  if (m.agent) return `<div class="m"><div class="prose">${m.html}</div></div>`;
  var mine = m.by === "me", p = PEOPLE[m.by];
  return `<div class="m h${mine ? " me" : ""}">${mine ? "" : `<div class="who"><b>${p.full}</b>${m.at}</div>`}<div class="line"><div class="bub">${esc(m.text)}</div>${mine ? "" : face(m.by, 30)}</div></div>`;
}
function talk() {
  var list = [{ day: "Today" },
    { by: "me", text: "Put the status page under my name. I'll do it tonight." },
    { agent: true, html: "<p>Done. The status page is yours in the checklist, due Wednesday.</p>" }];
  if (view.scene !== "earn") return list;
  list.push({ by: "me", text: "Check the pricing page for typos before legal sees it." });
  if (view.step === 1) list.push({ tool: "Reading pricing.md", live: true });
  if (view.step >= 2) list.push({ tool: "Read pricing.md · changed 2 lines" },
    { agent: true, html: "<p>Two typos, both fixed: “recieve” in the Team plan and a doubled “the” under Billing. Nothing else stood out.</p>" });
  return list;
}
function middle() {
  return `<div class="acol">${ahead()}<div class="chat"><div class="scroll"><div class="msgs" id="msgs">${talk().map(message).join("")}</div></div><div class="foot"><div class="comp"><textarea placeholder="Message Pip"></textarea><div class="r"><button class="ib" title="Attach">${ic("clip", 17)}</button><span class="grow"></span><button class="send" data-do="send" title="Send">${ic("up", 17)}</button></div></div></div></div></div>`;
}

/* ---------- beside the creature: its treats on one side, its next box on the other ---------- */
function pile() {
  var n = view.treats.length;
  return `<button class="pile${n ? "" : " none"}" id="pile" data-treat title="${n ? n + (n === 1 ? " treat" : " treats") + ". Drag one onto Pip, or press." : "No treats. Pip earns one for each task it finishes."}">${px(n ? view.treats[n - 1] : "cookie", 30)}${n ? `<span class="n">${n}</span>` : ""}</button>`;
}
function gift() {
  var left = NEED - view.joy, to = view.scene === "phone" ? "toast:The box opens over the page, as on the third phone" : "box";
  return `<button class="gift${view.box ? " ready" : ""}" id="gift" data-do="${to}" title="${view.box ? "Pip found a box. Press to open it." : left + (left === 1 ? " more treat" : " more treats") + " until Pip's next box"}"><span class="gbox">${px("gift", 34, "dim")}<span class="fill" style="height:${view.box ? 100 : Math.round(100 * view.joy / NEED)}%">${px("gift", 34)}</span></span>${view.box ? px("spark", 11, "tw") : ""}</button>`;
}
function pet(size) { return `<div class="pet">${critter("pip", size, { id: "main" })}${pile()}${gift()}</div>`; }
function paintPet() {
  var p = $("#pile"), g = $("#gift");
  if (p) p.outerHTML = pile();
  if (g) g.outerHTML = gift();
}
function runList() {
  var run = (r) => `<div class="run"><span class="mut">${ic("okc", 16)}</span><div class="grow"><div class="t">${esc(r.title)}</div><div class="s">${face(r.by, 15)}for ${r.by === "me" ? "you" : PEOPLE[r.by].name} · ${r.at} · ${r.steps} steps</div></div></div>`;
  return runs.map(run).join("");
}
function panel() {
  return `<aside class="panel"><div class="top">${pet(176)}` +
    `<div class="pnrow"><button class="pname" data-do="toast:Pip's settings, as today">Pip<span class="mut">${ic("gear", 14)}</span></button><button class="ib" data-do="go:wardrobe" title="Pip's wardrobe">${ic("shirt", 16)}</button></div><p id="mood">${view.mood}</p></div>` +
    `<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>What it did here</h3><div id="runs">${runList()}</div></div></aside>`;
}
function say(words) { view.mood = words; var el = $("#mood"); if (el) el.textContent = words; }

/* ---------- giving it a treat ---------- */
function mouthOf(o) {
  var r = o.canvas.getBoundingClientRect(), u = o.uB, c = u.uCenterV.value;
  return { x: r.left + r.width / 2 * (1 + c.x), y: r.top + r.height / 2 * (1 - (c.y + u.uS.value * u.uMouth.value.x * u.uShape.value.y)), r: r.width * u.uS.value / 2 };
}
function bits(at, color) {
  for (var i = 0; i < 5; i++) {
    var b = document.createElement("i"), a = Math.random() * Math.PI - Math.PI;
    b.className = "bit";
    b.style.cssText = `left:${at.x}px;top:${at.y}px;background:${color};--dx:${Math.round(Math.cos(a) * 34)}px;--dy:${Math.round(Math.sin(a) * 18 + 30)}px`;
    document.body.appendChild(b);
    setTimeout(function (el) { el.remove(); }, 600, b);
  }
}
function hearts() {
  var box = $(".pet");
  if (!box) return;
  [-34, 4, 38].forEach(function (x, i) {
    setTimeout(function () {
      box.insertAdjacentHTML("beforeend", `<img class="px heart" src="${SPR.heart}" style="--x:${x}px" alt="">`);
      var h = box.lastElementChild;
      setTimeout(function () { h.remove(); }, 1200);
    }, i * 140);
  });
}
function heldAt(g, x, y) { g.style.left = x + "px"; g.style.top = y + "px"; }
function eat(d) {
  var o = named.main;
  if (!o) { d.el.remove(); return; }
  eating = true;
  view.treats.pop(); paintPet();
  var m = mouthOf(o), n = 0;
  d.el.style.transition = "left .2s ease-out, top .2s ease-out, transform .1s";
  heldAt(d.el, m.x, m.y);
  o.setState("speaking");
  var t = setInterval(function () {
    n++;
    o.feed("token", 1); o.sp.squash.v -= 1.1;
    bits(m, TREATS[d.food]);
    d.el.style.transform = `translate(-50%,-50%) scale(${[0.8, 0.55, 0.3][n - 1]})`;
    if (n < 3) return;
    clearInterval(t);
    later(function () {
      d.el.remove();
      o.setState("done"); hearts();
      if (!view.box && ++view.joy >= NEED) view.box = true;
      paintPet();
      eating = false;
    }, 240);
  }, 300);
  timers.push(t);
}
var drag = null;
document.addEventListener("pointerdown", function (e) {
  var el = e.target.closest("[data-treat]");
  if (!el || eating || drag) return;
  if (!view.treats.length) return toast("No treats. Pip earns one for each task it finishes.");
  e.preventDefault();
  var f = view.treats[view.treats.length - 1], g = document.createElement("img");
  g.src = SPR[f]; g.className = "px held"; document.body.appendChild(g);
  heldAt(g, e.clientX, e.clientY);
  drag = { food: f, el: g, x: e.clientX, y: e.clientY, moved: false, near: false };
  // while a treat is held close, it opens its mouth for it
  drag.timer = setInterval(function () { if (drag && drag.near && named.main) named.main.feed("token", 0.9); }, 70);
});
document.addEventListener("pointermove", function (e) {
  if (!drag) return;
  heldAt(drag.el, e.clientX, e.clientY);
  if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 8) drag.moved = true;
  var o = named.main;
  if (!o) return;
  var m = mouthOf(o), near = Math.hypot(e.clientX - m.x, e.clientY - m.y) < m.r * 1.5;
  if (near !== drag.near) { drag.near = near; o.setState(near ? "speaking" : "idle"); }
});
document.addEventListener("pointerup", function (e) {
  if (!drag) return;
  var d = drag, o = named.main;
  drag = null; clearInterval(d.timer);
  var m = o && mouthOf(o), over = m && Math.hypot(e.clientX - m.x, e.clientY - m.y) < m.r * 1.5;
  if (over || !d.moved) return eat(d);
  if (o) o.setState("idle");
  d.el.remove();
});

/* ---------- earning: a task is finished, and a treat comes of it ---------- */
function earn() {
  view.step = 0; paintTalk();
  later(function () { view.step = 1; paintTalk(); say("Reading pricing.md"); act("working", "file"); }, 900);
  later(function () {
    view.step = 2;
    runs.unshift({ title: "Fixed two typos on the pricing page", by: "me", at: "2:31 PM", steps: 4 });
    paintTalk(); $("#runs").innerHTML = runList();
    say("Ready"); act("done");
    // the treat comes out of it and lands on the pile
    var o = named.main, from = o ? mouthOf(o) : { x: 0, y: 0 }, to = $("#pile").getBoundingClientRect(), g = document.createElement("img");
    g.src = SPR.donut; g.className = "px held fly"; document.body.appendChild(g);
    heldAt(g, from.x, from.y - 30);
    later(function () { heldAt(g, to.left + to.width / 2, to.top + to.height / 2); }, 350);
    later(function () { g.remove(); view.treats.push("donut"); paintPet(); $("#pile").classList.add("bump"); }, 1100);
  }, 3900);
}
function paintTalk() {
  var m = $("#msgs");
  if (!m) return;
  m.innerHTML = talk().map(message).join("");
  m.parentNode.scrollTop = 1e6;
}

/* ---------- a box: one thing Pip does not have yet, picked at random ---------- */
function roll() {
  var left = ORDER.filter(function (id) { return !view.owned[id]; });
  if (!left.length) return null;
  var tiers = RARS.filter(function (r) { return left.some(function (id) { return ITEMS[id].rarity === r; }); });
  var total = tiers.reduce(function (n, r) { return n + RAR[r].odds; }, 0), at = Math.random() * total, tier = tiers[0];
  for (var i = 0; i < tiers.length; i++) { at -= RAR[tiers[i]].odds; if (at < 0) { tier = tiers[i]; break; } }
  return pick(left.filter(function (id) { return ITEMS[id].rarity === tier; }));
}
function sparks(n) {
  var at = [[8, 14], [86, 10], [12, 46], [90, 42], [24, 5], [72, 4], [4, 30], [95, 26]];
  return at.slice(0, n).map((p, i) => `<img class="px spark" src="${SPR.spark}" style="left:${p[0]}%;top:${p[1]}%;animation-delay:${i * 0.19}s" alt="">`).join("");
}
function shut() {
  return `<button class="lootbox" data-do="open" title="Open it">${px("lid", 140, "lid")}${px("base", 140)}</button><h2>Pip found a box</h2><p class="sub">Press it to open.</p>`;
}
function reveal(id, size) {
  var it = ITEMS[id], r = RAR[it.rarity], on = Object.assign({}, wear.pip), tier = RARS.indexOf(it.rarity);
  on[it.slot] = id;
  return `<div class="rays" style="--rc:${r.c}"></div>${sparks(3 + tier * 1.25 | 0)}<div class="rar" style="--rc:${r.c}">${r.name}</div>${critter("pip", size || 200, { id: "gift", wear: on })}` +
    `<h2>${it.name}</h2><p class="sub">${SLOT_ONE[it.slot]} · ${found()} of ${ORDER.length} found</p>` +
    `<div class="acts"><button class="btn pri" data-do="don:${id}">Wear it</button><button class="btn" data-do="close">Keep it for later</button></div>`;
}
function boxDlg() {
  return `<div class="veil dim" data-do="close"><div class="dlg unl" data-stop><div class="boxin">${view.loot ? reveal(view.loot) : shut()}</div>` +
    (view.loot ? `<button class="again" data-do="again">Open another (only in this mock-up)</button>` : "") + `</div></div>`;
}
function openBox() {
  var el = $(".lootbox");
  if (!el || el.classList.contains("shake")) return;
  var id = roll();
  if (!id) return toast("Pip has all hundred.");
  view.loot = id; view.owned[id] = true; view.joy = 0; view.box = false;
  el.style.setProperty("--rc", rarOf(id).c);
  el.classList.add("shake");
  later(function () { el.classList.add("burst"); }, 700);
  later(function () { render(); act2("gift", "done"); }, 1150);
}

/* ---------- the wardrobe ---------- */
function worn() {
  var w = wear.pip;
  return SLOTS.map(function (s) {
    var t = view.tryOn && view.tryOn.slot === s ? view.tryOn.id : null, id = t || w[s];
    return `<div class="wchip"><span class="k">${SLOT_ONE[s]}</span>${id ? `<i class="rdot" style="--rc:${rarOf(id).c}"></i>` : ""}<span class="grow trunc">${t ? nameOf(t) + ' <span class="mut">· trying on</span>' : w[s] ? nameOf(w[s]) : '<span class="mut">Nothing</span>'}</span>${w[s] && !t ? `<button class="ib" data-do="off:${s}" title="Take it off">${ic("x", 13)}</button>` : ""}</div>`;
  }).join("");
}
function tryLine() { return view.tryOn ? `${ic("lock", 13)}Not found yet. It could be in the next box.` : found() + " of " + ORDER.length + " found"; }
function sorted(slot) {
  return BY_SLOT[slot].slice().sort(function (a, b) {
    return (view.owned[a] ? 0 : 1) - (view.owned[b] ? 0 : 1) || RARS.indexOf(ITEMS[a].rarity) - RARS.indexOf(ITEMS[b].rarity) || ORDER.indexOf(a) - ORDER.indexOf(b);
  });
}
function tiles() {
  var t = view.tab;
  return `<button class="wtile" data-item="" data-do="wear:">${critter("pip", 64, { wear: {}, tile: true })}<span>Nothing</span></button>` +
    sorted(t).map(function (id) {
      var r = rarOf(id), has = view.owned[id], o = {};
      o[t] = id;
      if (!has && !view.all) return `<div class="wtile unk" style="--rc:${r.c}"><b>?</b><span>${r.name}</span><i class="rbar"></i></div>`;
      return `<button class="wtile${has ? "" : " locked"}" style="--rc:${r.c}" data-item="${id}" data-do="wear:${id}" title="${r.name}">${critter("pip", 64, { wear: o, tile: true })}<span>${nameOf(id)}</span><i class="rbar"></i>${has ? "" : `<em>${ic("lock", 10)}</em>`}</button>`;
    }).join("");
}
function tabsRow() {
  return SLOTS.map((s) => `<button class="tab${s === view.tab ? " on" : ""}" data-do="tab:${s}">${SLOT_NAMES[s]}<small>${BY_SLOT[s].filter((id) => view.owned[id]).length}/${BY_SLOT[s].length}</small></button>`).join("");
}
function legend() { return RARS.map((r) => `<span><i class="rdot" style="--rc:${RAR[r].c}"></i>${RAR[r].name}</span>`).join(""); }
function wardrobe() {
  return `<div class="veil dim" data-do="close"><div class="dlg setm ward" data-stop>` +
    `<div class="wstage"><div class="floor">${critter("pip", 230, { id: "stage" })}</div><h2>Pip</h2><p class="mut wline" id="trying">${tryLine()}</p><div class="worn" id="worn">${worn()}</div>` +
    `<div class="r"><button class="btn sm" data-do="shuffle">${ic("shuffle", 14)}Surprise me</button><button class="btn sm quiet" data-do="bare">Take it all off</button></div></div>` +
    `<div class="col"><div class="sh"><h1>Wardrobe</h1><p>What Pip wears, it wears everywhere it is seen. New things come out of boxes.</p></div>` +
    `<div class="wbar"><nav class="tabs wt" id="wtabs">${tabsRow()}</nav><label class="sw" title="Only in this mock-up"><input type="checkbox" data-do="all"${view.all ? " checked" : ""}>Show what Pip hasn't found</label></div>` +
    `<div class="grid" id="grid">${tiles()}</div><div class="legend">${legend()}</div></div>` +
    `<button class="ib x" data-do="close" title="Close">${ic("x", 16)}</button></div></div>`;
}
/* After a change of clothes: the tiles keep their creatures, only what is marked moves. */
function paintWardrobe(redo) {
  if (redo) $("#grid").innerHTML = tiles();
  var cur = wear.pip[view.tab] || "", t = view.tryOn && view.tryOn.slot === view.tab ? view.tryOn.id : null;
  document.querySelectorAll("#grid .wtile").forEach(function (el) {
    el.classList.toggle("on", !t && el.dataset.item === cur);
    el.classList.toggle("try", !!t && t === el.dataset.item);
  });
  $("#worn").innerHTML = worn(); $("#trying").innerHTML = tryLine(); $("#wtabs").innerHTML = tabsRow();
  mount();
}
function shuffled(from, chance) {
  var o = {};
  SLOTS.forEach(function (s) { var list = from(s); if (list.length && Math.random() < (s === "hat" ? 0.9 : chance)) o[s] = pick(list); });
  return o;
}
function ownedIn(s) { return BY_SLOT[s].filter(function (id) { return view.owned[id]; }); }

/* ---------- on a phone: the chat as it is, and a page of Pip's own ---------- */
function phones() {
  var phone = (inner, title, words) => `<figure class="phone-w"><div class="phone">${inner}</div><figcaption><b>${title}</b>${words}</figcaption></figure>`;
  var tabs = `<nav class="tabs m-tabs">${["Chat", "Library", "Automations"].map((t) => `<span class="tab${t === "Chat" ? " on" : ""}">${t}</span>`).join("")}</nav>`;
  var top = `<div class="m-top"><button class="ib">${ic("list", 18)}</button><span class="who"><span class="dotted">${critter("pip", 26)}<i></i></span><b>Pip</b><span class="mut">${ic("down", 12)}</span></span><span class="grow"></span>${stack(["me", "maya"], 20)}<button class="ib">${ic("gear", 17)}</button></div>`;
  var chat = `<div class="scroll"><div class="msgs">${talk().map(message).join("")}</div></div><div class="foot"><div class="comp"><textarea placeholder="Message Pip"></textarea><div class="r"><span class="mut">${ic("clip", 16)}</span><span class="grow"></span><span class="send">${ic("up", 16)}</span></div></div></div>`;
  var mine = ORDER.filter((id) => view.owned[id]).slice(0, 6);
  var care = `<div class="m-top"><button class="ib">${ic("left", 18)}</button><b>Pip</b><span class="grow"></span><button class="ib">${ic("gear", 17)}</button></div>` +
    `<div class="m-care">${pet(150)}<p class="mut">Treats come from the tasks Pip finishes. Enough of them and it finds a box.</p></div>` +
    `<div class="m-ward"><div class="h2" style="margin:0 0 6px">Wardrobe<span class="sp"></span><span style="text-transform:none;letter-spacing:0">${found()} of ${ORDER.length}</span></div>` +
    `<nav class="tabs wt m-wt">${SLOTS.map((s, i) => `<span class="tab${i ? "" : " on"}">${SLOT_NAMES[s]}</span>`).join("")}</nav>` +
    `<div class="grid three">${mine.map((id) => { var o = {}; o[ITEMS[id].slot] = id; return `<span class="wtile${wear.pip[ITEMS[id].slot] === id ? " on" : ""}" style="--rc:${rarOf(id).c}">${critter("pip", 50, { wear: o, tile: true })}<span>${nameOf(id)}</span><i class="rbar"></i></span>`; }).join("")}</div></div>`;
  var opened = `<div class="m-top"><span class="grow"></span><button class="ib">${ic("x", 17)}</button></div><div class="unl m-unl"><div class="boxin">${reveal("wizard", 170)}</div></div>`;
  return `<div class="phones">` +
    phone(top + tabs + chat, "The chat, as it is", "Nothing is added to it. Pip's picture wears what Pip wears, and a dot on it says a box is waiting. Tapping the picture opens Pip's page.") +
    phone(care, "Pip's page", "Where looking after it lives on a phone: its treats, its next box, and its wardrobe underneath. Try a treat here.") +
    phone(opened, "A box, opened", "The same moment as on a wide screen, as a sheet over the page.") + "</div>";
}

/* ---------- the same things on bodies grown from random seeds ---------- */
var WORDS = ["Alder", "Birch", "Cedar", "Dune", "Ember", "Fable", "Grove", "Heron", "Iris", "Jade", "Kestrel", "Lark", "Moss", "Nettle", "Opal", "Quill", "Reed", "Sorrel", "Thistle", "Umber", "Vale", "Willow", "Yarrow", "Zephyr"];
var crowd = [], crowdAll = false, checked = "";
function newCrowd() {
  var colors = core ? Object.keys(core.PALETTE).map(function (k) { return core.PALETTE[k]; }) : ["#5f8a4e"];
  crowd = [];
  for (var i = 0; i < 12; i++) { var name = pick(WORDS) + " " + Math.floor(Math.random() * 900 + 100); AGENTS["body" + i] = { name: name, seed: name, color: pick(colors) }; crowd.push("body" + i); }
  newOutfits();
}
function newOutfits() { crowd.forEach(function (k) { wear[k] = crowdAll ? shuffled(function (s) { return BY_SLOT[s]; }, 0.6) : { hat: pick(BY_SLOT.hat) }; }); }
function bodies() {
  var words = (k) => SLOTS.filter((s) => wear[k][s]).map((s) => nameOf(wear[k][s])).join(", ");
  return `<div class="lineup"><div class="sh"><h1>On any body</h1><p>Twelve creatures grown from random seeds, each in ${crowdAll ? "an outfit" : "a hat"} picked at random.</p></div>` +
    `<div class="lus">${crowd.map((k) => `<div class="lu">${critter(k, 124)}<span class="mut">${words(k)}</span></div>`).join("")}</div>` +
    `<div class="r"><button class="btn" data-do="crowd">${ic("shuffle", 15)}New bodies</button><button class="btn" data-do="outfits">New ${crowdAll ? "outfits" : "hats"}</button><button class="btn quiet" data-do="crowdall">${crowdAll ? "Hats only" : "Whole outfits"}</button><button class="btn quiet" data-do="check">Check 200 more bodies</button></div>` +
    `<p class="hint" id="checked">${checked}</p></div>`;
}
/* Each of these things on each of `n` new bodies: how many have a corner inside the body, and which is worst. */
function check(n, ids) {
  if (!core || !Wear) return null;
  var cv = document.createElement("canvas"), o = core.createOrb(cv, { seed: "check", size: 190 }), worst = { d: -9 }, sunk = 0, tried = 0, bad = {};
  o.paused = true;
  ids = ids || BY_SLOT.hat;
  for (var i = 0; i < n; i++) {
    o.setSeed("check/" + i + "/" + Math.random());
    ids.forEach(function (id) {
      var w = {};
      w[ITEMS[id].slot] = id;
      Wear.dress(o, w);
      var d = Wear.audit(o);
      tried++;
      if (d > 0.012) { sunk++; bad[id] = (bad[id] || 0) + 1; }
      if (d > worst.d) worst = { d: d, id: id, seed: o.seed };
    });
  }
  Wear.strip(o); o.dispose();
  return { tried: tried, sunk: sunk, worst: worst, bad: bad };
}
window.__check = check;
window.__items = ORDER;

/* ---------- drawing and what the buttons do ---------- */
var OVER = { wardrobe: 1, box: 1 };
function render() {
  var s = view.scene;
  app.innerHTML = s === "bodies" ? bodies() : s === "phone" ? phones() : (view.list ? side() : "") + `<div class="main">${middle()}${view.panel ? panel() : ""}</div>` + (s === "wardrobe" ? wardrobe() : s === "box" ? boxDlg() : "");
  strip.innerHTML = "<b>Mock-up</b>" + SCENES.map((x) => x ? `<button class="${x[0] === s ? "on" : ""}" data-do="scene:${x[0]}">${x[1]}</button>` : "<i></i>").join("") +
    '<span class="sp"></span><button data-do="theme">Light / dark</button>' + `<div class="note"><b>${NOTES[s][0]}</b>${NOTES[s][1]}</div>`;
  if (location.hash !== "#" + s) history.replaceState(null, "", "#" + s);
  mount();
  if (s === "wardrobe") paintWardrobe();
}
/* A scene from the strip, or from the address: set up so that it shows what it is named for. */
function show(scene) {
  timers.forEach(clearTimeout); timers = []; eating = false;
  resetChat();
  view.scene = scene; view.list = view.panel = true;
  if (scene === "earn") setUp({ treats: [], joy: 1 });
  else if (scene === "box" || scene === "phone") setUp({ joy: NEED, box: true });
  else setUp();
  if (scene === "bodies" && !crowd.length) newCrowd();
  render();
  if (scene === "earn") earn();
}
/* The same without starting over, for moving about inside the story. */
function go(scene) { view.scene = scene; view.tryOn = null; if (scene === "wardrobe") view.tab = "hat"; render(); }
function toast(words) {
  var t = document.createElement("div"); t.className = "toast"; t.textContent = words; app.appendChild(t);
  setTimeout(function () { t.remove(); }, 2600);
}
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-do],[data-stop]");
  if (!el || !el.dataset.do) return;
  var d = el.dataset.do.split(":"), a = d[0], v = d.slice(1).join(":"), w = wear.pip;
  e.stopPropagation();
  if (a === "toast") return toast(v);
  if (a === "scene") return show(v);
  if (a === "go") return go(v);
  if (a === "close") { view.loot = null; return go("panel"); }
  if (a === "box") {
    var left = NEED - view.joy;
    if (!view.box) return toast(left + (left === 1 ? " more treat" : " more treats") + " until Pip's next box.");
    view.loot = null; return go("box");
  }
  if (a === "open") return openBox();
  if (a === "again") { view.loot = null; view.box = true; view.joy = NEED; return render(); }
  if (a === "send") { if (view.scene !== "earn") return show("earn"); timers.forEach(clearTimeout); timers = []; runs.splice(0, runs.length - 2); return earn(); }
  if (a === "tab") { view.tab = v; view.tryOn = null; return paintWardrobe(true); }
  if (a === "all") { view.all = el.checked; view.tryOn = null; return paintWardrobe(true); }
  if (a === "wear") {
    if (v && !view.owned[v]) view.tryOn = view.tryOn && view.tryOn.id === v ? null : { slot: view.tab, id: v };
    else { view.tryOn = null; if (!v || w[view.tab] === v) delete w[view.tab]; else w[view.tab] = v; }
    return paintWardrobe();
  }
  if (a === "off") { delete w[v]; return paintWardrobe(); }
  if (a === "bare") { wear.pip = {}; view.tryOn = null; return paintWardrobe(); }
  if (a === "shuffle") { wear.pip = shuffled(ownedIn, 0.55); view.tryOn = null; return paintWardrobe(); }
  if (a === "don") { w[ITEMS[v].slot] = v; view.loot = null; return go("panel"); }
  if (a === "crowd") { newCrowd(); return render(); }
  if (a === "outfits") { newOutfits(); return render(); }
  if (a === "crowdall") { crowdAll = !crowdAll; newOutfits(); return render(); }
  if (a === "check") {
    $("#checked").textContent = "Checking…";
    return setTimeout(function () {
      var r = check(200);
      checked = `${r.tried.toLocaleString()} fittings (200 new bodies × ${BY_SLOT.hat.length} hats): ${r.sunk} with any part inside the head. Deepest: ${Math.max(0, r.worst.d * 100).toFixed(1)}% of a body's radius.`;
      if ($("#checked")) $("#checked").textContent = checked;
    }, 30);
  }
  if (a === "list") view.list = !view.list;
  else if (a === "panel") view.panel = !view.panel;
  else if (a === "theme") document.documentElement.classList.toggle("dark");
  render();
});
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && OVER[view.scene]) { view.loot = null; go("panel"); } });
window.addEventListener("hashchange", function () { var s = location.hash.slice(1); if (NOTES[s] && s !== view.scene) show(s); });

var first = location.hash.slice(1);
show(NOTES[first] ? first : "panel");
})();
