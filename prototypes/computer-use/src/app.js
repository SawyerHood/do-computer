/* Screen and browser mock-up. ../agent-pages/src/head.js (icons, pretend people and agents, the
   creature) opens the function this file closes. */

P.down = '<path d="m6 9 6 6 6-6"/>';
P.sideL = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/>';
P.side = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M15 4.5v15"/>';
P.aside = '<path d="M3.5 5h11.5v8.5H8.5l-3 2.5v-2.5h-2z"/><path d="M18 9h2.5v8.5H19V20l-3-2.5h-4.5v-1"/>';
P.stop = '<rect x="7" y="7" width="10" height="10" rx="2"/>';
P.warn = '<circle cx="12" cy="12" r="9"/><path d="M12 7.500v5.500M12 16.200v.3"/>';
P.globe = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.800 3 2.800 15 0 18M12 3c-2.800 3-2.800 15 0 18"/>';
P.big = '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>';
P.pause = '<path d="M9 6v12M15 6v12"/>';
P.play = '<path d="M8 5.500v13l10-6.500z"/>';

var app = document.getElementById("app"), strip = document.getElementById("strip");
var SCENES = [
  ["screen", "1 · Using your screen"], ["browser", "2 · Using a browser"], ["large", "3 · Opened large"], ["ended", "4 · When it ends"], null,
  ["yours", "5 · On your computer"], ["paused", "6 · Paused"], null,
  ["allow", "7 · Allowing it"], null,
  ["phone", "8 · On a phone"]
];
var NOTES = {
  screen: ["Pip is using your MacBook's screen.", "A little window in the chat, where Pip began: the screen as it is now, with Pip's pointer on it and a line for what it is doing. Click it to open it large. Pause and Stop are on it."],
  browser: ["Pip is using a browser.", "The same window. A browser of Pip's own on the MacBook: only the page is shown, with its address beside the computer's name."],
  large: ["The window opened large.", "The screen, and the steps so far beside it. This is still only watching: the mouse and keyboard are Pip's."],
  ended: ["When it ends.", "The window folds to one line, as word of a finished command does. Open “What it did” for the picture Pip took at each step."],
  yours: ["What you see on the MacBook itself.", "Pip has a pointer of its own, in its colour, with its name. Yours stays yours: you can keep working. A bar says who is using the computer, with Pause and Stop. The Do Computer app draws all of this over everything else."],
  paused: ["Paused.", "From the bar, the window in the chat, or Esc. Pip waits where it is and is told nothing has gone wrong."],
  allow: ["Allowing it.", "Two switches for each computer, in the Do Computer app on that computer, where an agent cannot reach them. Beside it: what a chat says when the screen is switched off."],
  phone: ["On a phone.", "The same window, as wide as the chat. Touch it for the steps."]
};
var view = { scene: "screen", list: true, panel: true, big: false, open: {}, frame: 7, held: false, ptr: "name", on: { screen: false, browser: true } };
var KEYS = ["pip", "ledger", "scout"];
var PIP = AGENTS.pip.color;

/* ---------- the pretend screens ---------- */
/* Each is drawn for a number of steps taken: 0 is before the first. */
function deskDraw(n) {
  var mailUp = n >= 1 && n < 4, opened = n >= 2, sel = n >= 6 ? 1 : n >= 4 ? 0 : -1, typing = n === 4 || n === 6;
  var mails = [["Jon Reyes", "Pricing copy, round two", "Thu"], ["Maya Okafor", "October invoice", "Wed"], ["Priya Nair", "Vendor contract questions", "Tue"], ["Stripe", "Your payout is on its way", "Mon"], ["Linear", "Your weekly digest", "Mon"]];
  var list = mails.map((m, i) => `<div class="mrow${opened && i === 1 ? " on" : ""}"><b>${m[0]}</b><span>${m[2]}</span><div>${m[1]}</div></div>`).join("");
  var msg = !opened ? '<p class="none">No message selected</p>' : '<h4>October invoice</h4><p class="from">Maya Okafor · to you · Wed 9:12 AM</p><p>Harbor Print sent this for October. Can it go in the launch budget?</p>' +
    '<div class="inv"><b>Harbor Print Co.</b> · Invoice 2291<table><tr><td>Printing</td><td>$4,820.00</td></tr><tr><td>Shipping</td><td>$1,240.00</td></tr><tr><td>Total</td><td>$6,060.00</td></tr></table></div>';
  var rows = [["Printing", "5,000", n >= 5 ? "4,820" : ""], ["Shipping", "1,500", n >= 7 ? "1,240" : ""], ["Ads", "3,000", "2,950"], ["Launch party", "800", ""], ["Total", "10,300", n >= 7 ? "9,010" : n >= 5 ? "7,770" : "2,950"]];
  var grid = '<div class="n h"></div><div class="h">Item</div><div class="h r">Budget</div><div class="h r">Actual</div>' + rows.map((r, i) => {
    var t = i === 4 ? " tot" : "";
    return `<div class="n">${i + 2}</div><div class="${t}">${r[0]}</div><div class="r${t}">${r[1]}</div><div class="r${t}${i === sel ? " sel" : ""}">${r[2]}${i === sel && typing ? '<span class="caret"></span>' : ""}</div>`;
  }).join("") + '<div class="n">7</div><div></div><div></div><div></div><div class="n">8</div><div></div><div></div><div></div>';
  var dock = [["F", "#4a90d9"], ["M", "#2f7f86"], ["S", "#5aa9e6"], ["N", "#3da35d"], ["T", "#e0a63a"], ["⚙", "#7d848b"]].map((d, i) => `<i style="--c:${d[1]}"${i === 1 && n >= 1 || i === 3 ? ' class="run"' : ""}>${d[0]}</i>`).join("");
  return `<div class="st-desk"><div class="mbar"><b>${mailUp ? "Mail" : "Numbers"}</b><span>File</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span><span class="sp"></span><span>Wed 2:14 PM</span></div>` +
    `<div class="w${mailUp ? "" : " behind"}" style="left:40px;top:56px;width:590px;height:470px;z-index:${mailUp ? 3 : 1}"><div class="wt"><i></i><i></i><i></i><span>Inbox</span></div><div class="mailb"><div class="ml">${list}</div><div class="mv">${msg}</div></div></div>` +
    `<div class="w${mailUp ? " behind" : ""}" style="left:600px;top:170px;width:640px;height:480px;z-index:2"><div class="wt"><i></i><i></i><i></i><span>launch-budget</span></div><div class="tb"><span>Sheet 1</span><span>Insert</span><span>Table</span><span>Format</span>${n >= 8 ? '<span class="sv">Saved</span>' : n >= 5 ? "<span style=\"margin-left:auto\">Edited</span>" : ""}</div><div class="grid">${grid}</div></div>` +
    `<div class="dock">${dock}</div></div>`;
}
function webDraw(n) {
  if (n < 1) return '<div class="st-web blank"></div>';
  var nav = '<div class="wnavb"><b>Tidewater</b><span>Product</span><span>Pricing</span><span>Docs</span><span class="cta">Sign in</span></div>';
  if (n >= 7) return `<div class="st-web">${nav}<div class="sent"><span class="tick">✓</span><h2>Check your email</h2><p>We sent a link to pip@tidewater.studio to start your Team trial.</p></div></div>`;
  if (n >= 4) return `<div class="st-web">${nav}<div class="form"><h2>Start your Team trial</h2><div class="s">14 days free, then $290 a year.</div><label>Work email</label><div class="in${n >= 5 ? " f" : ""}">${n >= 6 ? "pip@tidewater.studio" : ""}${n === 5 ? '<span class="caret"></span>' : ""}</div><div class="go">Create account</div><div class="fine">No card needed.</div></div></div>`;
  var y = n >= 2, plans = [["Solo", y ? "90" : "9", "For one person and one site."], ["Team", y ? "290" : "29", "Five seats, shared drafts, review links."], ["Studio", y ? "790" : "79", "Unlimited seats and client workspaces."]];
  return `<div class="st-web">${nav}<h1>Simple pricing</h1><div class="lede">Every plan starts with 14 days free.</div><div class="seg"><span class="${y ? "" : "on"}">Monthly</span><span class="${y ? "on" : ""}">Yearly</span></div>` +
    plans.map((p, i) => `<div class="plan${i === 1 ? " hot" : ""}" style="left:${166 + i * 324}px"><h3>${p[0]}</h3><div class="pr">$${p[1]} <small>${y ? "a year" : "a month"}</small></div><div class="sv">${y ? "Two months free" : ""}</div><p>${p[2]}</p><div class="go">Start trial</div></div>`).join("") + "</div>";
}
/* `to` is where the pointer goes for a step; `k` what kind of step it is. */
var SCN = {
  desk: { on: "MacBook", what: "the screen", icon: "desktop", start: [700, 430], secs: 38, draw: deskDraw, steps: [
    { to: [550, 758], say: "Clicking Mail in the Dock", k: "click" },
    { to: [150, 188], say: "Opening “October invoice”", k: "click" },
    { say: "Reading the invoice", k: "look" },
    { to: [1130, 297], say: "Clicking the Printing cell", k: "click" },
    { say: "Typing 4,820", k: "type" },
    { to: [1130, 331], say: "Clicking the Shipping cell", k: "click" },
    { say: "Typing 1,240", k: "type" },
    { say: "Pressing ⌘S", k: "key" }
  ] },
  web: { on: "MacBook", what: "a browser", icon: "globe", start: [640, 400], secs: 21, draw: webDraw, steps: [
    { say: "Opening tidewater.studio/pricing", k: "nav" },
    { to: [695, 250], say: "Clicking Yearly", k: "click" },
    { say: "Reading the prices", k: "look" },
    { to: [640, 564], say: "Clicking Start trial", k: "click" },
    { to: [640, 372], say: "Clicking the email box", k: "click" },
    { say: "Typing pip@tidewater.studio", k: "type" },
    { to: [640, 436], say: "Clicking Create account", k: "click" }
  ] }
};
function urlAt(n) { return n < 1 ? "about:blank" : n < 4 ? "tidewater.studio/pricing" : n < 7 ? "tidewater.studio/signup?plan=team" : "tidewater.studio/signup/sent"; }
/* Where each pretend screen is in its steps. `n` steps are taken; `doing` is the one under way. */
var live = { desk: { n: 2, doing: -1, hold: 0 }, web: { n: 1, doing: -1, hold: 0 } };
var tick = 0;
function clock(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function whereAt(key, n) {
  var s = SCN[key], at = s.start;
  for (var i = 0; i < n && i < s.steps.length; i++) if (s.steps[i].to) at = s.steps[i].to;
  return at;
}
function saying(key) {
  var s = SCN[key], l = live[key];
  if (view.held) return "Paused";
  return l.doing >= 0 ? s.steps[l.doing].say : l.n >= s.steps.length ? "Looking at what changed" : key === "web" ? "Looking at the page" : "Looking at the screen";
}

/* The agent's pointer. */
var ARROW = `<svg class="arrow" width="20" height="20" viewBox="0 0 20 20"><path d="M2.500 2l5 14.500 2.300-6.200 6.200-2.300z" fill="${PIP}" stroke="#fff" stroke-width="1.500" stroke-linejoin="round"/></svg>`;
var RIDER = `<svg class="rider" viewBox="0 0 64 64"><ellipse cx="32" cy="35" rx="23" ry="22" fill="${PIP}" stroke="#fff" stroke-width="3"/><ellipse cx="24" cy="33" rx="5" ry="6.500" fill="#fff"/><ellipse cx="40" cy="33" rx="5" ry="6.500" fill="#fff"/><circle cx="25" cy="34" r="2.600" fill="#16181d"/><circle cx="41" cy="34" r="2.600" fill="#16181d"/></svg>`;
var MINE = '<svg width="18" height="18" viewBox="0 0 20 20"><path d="M2.500 2l5 14.500 2.300-6.200 6.200-2.300z" fill="#111" stroke="#fff" stroke-width="1.500" stroke-linejoin="round"/></svg>';
function pointer(at, wait) {
  return `<span class="aptr${wait ? " wait" : ""}" style="--x:${at[0]};--y:${at[1]}"><span class="rip"></span>${ARROW}${view.ptr === "name" ? `<span class="tag">Pip${wait ? " · waiting" : ""}</span>` : RIDER}</span>`;
}
/* A screen. With `at` it is the picture of one step; without, it is the one that is going. */
function screen(key, o) {
  o = o || {};
  var still = o.at !== undefined, n = still ? o.at : live[key].n;
  var mine = o.mine ? `<span class="mine-ptr" style="--x:${o.mine[0]};--y:${o.mine[1]}">${MINE}</span>` : "";
  return `<span class="scr ${o.cls || ""}"${still ? "" : ` data-live="${key}"`}><span class="stage">${SCN[key].draw(n)}</span><span class="flash"></span>${mine}${pointer(whereAt(key, n), view.held && !still)}</span>`;
}

function spinner(size) { return `<span class="spin mut" title="Working">${ic("ring", size || 13)}</span>`; }

/* ---------- the sidebar and the agent's strip, as they are in the app ---------- */
function sceneKey() { return view.scene === "browser" ? "web" : "desk"; }
function pipLine() {
  var s = view.scene;
  if (s === "ended") return { words: "The budget has October's numbers.", end: "now" };
  if (view.held) return { words: "Paused on MacBook", end: `<span title="Paused">${ic("pause", 13)}</span>` };
  return { words: s === "browser" ? "Using a browser on MacBook" : "Using MacBook's screen", end: spinner(13) };
}
var LINE = { ledger: { words: "Priya: can you total October?", end: "52m" }, scout: { words: "Three launches worth a look this week", end: "Tue" } };
function side() {
  var row = (key) => {
    var a = AGENTS[key], cur = key === "pip", l = cur ? pipLine() : LINE[key];
    return `<div class="arow${cur ? " sel cur" : ""}" data-do="toast:${cur ? "This is Pip's main chat" : "Only Pip is in this mock-up"}">${orb(key, 40)}<span class="grow"><div class="t"><span class="grow trunc">${a.name}</span><span class="end">${l.end}</span></div><div class="s"><span class="trunc">${esc(l.words)}</span></div></span></div>`;
  };
  return `<aside class="side"><div class="ws-h"><button class="wsw" data-do="toast:The workspace menu is as it is today">${tile("T", TEAM.c, 26)}<b class="trunc">Tidewater</b><span class="mut">${ic("sort", 13)}</span></button><button class="ib" data-do="list" title="Hide the sidebar">${ic("sideL", 17)}</button></div>` +
    `<div class="side-h" style="padding-top:8px"><h2 class="lbl">Agents</h2><button class="ib" data-do="toast:New agent" title="New agent">${ic("plus", 17)}</button></div><div class="chats flat">${KEYS.map(row).join("")}</div>` +
    `<div class="side-f me"><button class="prow" data-do="toast:Your menu is as it is today">${face("me", 26, "on")}<span class="grow trunc">Sawyer Hood</span><span class="mut">${ic("sort", 13)}</span></button></div></aside>`;
}
function ahead() {
  var t = (label, on) => `<button class="tab${on ? " on" : ""}" data-do="toast:${label} is as it is today">${label}</button>`;
  return '<header class="ahead">' + (view.list ? "" : `<button class="ib" data-do="list" title="Show the sidebar" style="margin-left:-6px">${ic("sideL", 17)}</button>`) +
    `<button class="who" data-do="toast:Another agent, as today">${orb("pip", 26, { still: true })}<b>Pip</b><span class="mut">${ic("down", 13)}</span></button>` +
    `<nav class="tabs">${t("Chat", true)}${t("Library")}${t("Automations")}</nav><span class="grow"></span>${stack(["me"], 26)}` +
    `<button class="scb" data-do="toast:Side chats, as today">${ic("aside", 17)}Side chats<span class="n">5</span></button>` +
    `<span class="acts"><button class="ib" data-do="toast:Pip's settings, as today" title="Pip's settings">${ic("gear", 17)}</button><button class="ib${view.panel ? " on" : ""}" data-do="panel" title="Pip's panel">${ic("side", 17)}</button></span></header>`;
}

/* ---------- what is said ---------- */
/* The little window: a screen or a browser that the agent is using now. */
function viewer(key, phone) {
  var s = SCN[key], web = key === "web";
  var what = web ? `<span class="url" data-url>${urlAt(live.web.n)}</span>` : "the screen";
  return `<div class="m" id="view-${key}"><div class="view${view.held ? " held" : ""}">` +
    `<div class="vh"><span class="mut">${ic(s.icon, 15)}</span><span class="grow trunc"><b>${s.on}</b> <span class="k">· ${what} · <span data-clock="${key}">${clock(s.secs + tick)}</span></span></span>` +
    (phone ? "" : `<button class="ib" data-do="hold" title="${view.held ? "Let Pip carry on" : "Pause"}">${ic(view.held ? "play" : "pause", 15)}</button><button class="ib" data-do="large" title="Open it large">${ic("big", 15)}</button>`) + `<button class="btn sm" data-do="stop">Stop</button></div>` +
    `<button class="vs" data-do="large" title="Open it large">${screen(key, { cls: phone ? "sm" : "" })}${view.held ? `<span class="held-tag">${ic("pause", 14)}Paused</span>` : ""}</button>` +
    `<div class="vf">${view.held ? `<span class="mut">${ic("pause", 13)}</span>` : spinner(13)}<span class="trunc" data-say="${key}">${esc(saying(key))}</span>${view.held ? '<button class="btn sm" data-do="hold">Carry on</button>' : ""}</div></div></div>`;
}
/* Word that it ended, with the pictures it took. */
function ended(phone) {
  var s = SCN.desk, open = view.open.film, f = view.frame;
  var film = !open ? "" : `<div class="film">${screen("desk", { at: f + 1, cls: phone ? "sm" : "" })}<div class="cap"><b>${f + 1} of ${s.steps.length}</b><span class="grow trunc">${esc(s.steps[f].say.replace(/^(\w+)ing /, (m, w) => ({ Click: "Clicked ", Open: "Opened ", Read: "Read ", Typ: "Typed ", Press: "Pressed " })[w] || m))}</span></div>` +
    `<div class="row">${s.steps.map((st, i) => `<button class="th${i === f ? " on" : ""}" data-do="frame:${i}" title="${esc(st.say)}">${screen("desk", { at: i + 1, cls: "xs" })}</button>`).join("")}</div></div>`;
  return `<div class="word"><div class="l"><span class="mut">${ic("okc", 16)}</span><span>Pip used <b>MacBook’s screen</b> for 1m 12s · 8 steps</span></div>` +
    `<button class="more${open ? " open" : ""}" data-do="fold:film">${ic("right", 13)}What it did</button>${film}</div>`;
}
function message(m) {
  if (m.day) return `<div class="dayd">${m.day}</div>`;
  if (m.viewer) return viewer(m.viewer, m.phone);
  if (m.ended) return ended(m.phone);
  if (m.agent) return `<div class="m"><div class="prose">${m.html}</div></div>`;
  return `<div class="m h me"><div class="line"><div class="bub">${esc(m.text)}</div></div></div>`;
}
function talk(scene, phone) {
  var list = [{ day: "Today" }];
  if (scene === "browser") return list.concat({ by: "me", text: "Are the yearly prices live on the pricing page? And check a Team trial still starts from there." }, { viewer: "web", phone: phone });
  list.push({ by: "me", text: "Maya emailed October's invoice from Harbor Print. Put the numbers in the launch budget on my MacBook." });
  if (scene === "ended") return list.concat({ ended: true, phone: phone }, { agent: true, html: "<p>The launch budget has October's numbers from Harbor Print: printing <b>$4,820</b> and shipping <b>$1,240</b>. Both are under what was budgeted, and the total spent so far is $9,010 of $10,300.</p><p>I saved the sheet and left Mail and Numbers open as they were.</p>" });
  return list.concat({ viewer: "desk", phone: phone });
}
function composer(words, phone) {
  var busy = view.scene !== "ended";
  return `<div class="comp"><textarea placeholder="${words}"></textarea><div class="r"><button class="ib" title="Attach">${ic("clip", 17)}</button><span class="grow"></span>` +
    (busy && !phone ? `<button class="send halt" data-do="stop" title="Stop">${ic("stop", 17)}</button>` : `<button class="send" data-do="toast:Only the window and the navigation work in this mock-up" title="Send">${ic("up", 17)}</button>`) + "</div></div>";
}
function middle() {
  return `<div class="acol">${ahead()}<div class="chat"><div class="scroll"><div class="msgs">${talk(view.scene).map(message).join("")}</div></div><div class="foot">${composer("Message Pip")}</div></div></div>`;
}
function panel() {
  var s = view.scene, key = sceneKey(), going = s !== "ended";
  var run = (r) => `<div class="run">${r.going ? spinner(16) : `<span class="mut">${ic("okc", 16)}</span>`}<div class="grow"><div class="t">${esc(r.title)}</div><div class="s">${face("me", 15)}for you · ${r.at} · ${r.steps} ${r.steps === 1 ? "step" : "steps"}</div></div></div>`;
  var did = [s === "browser" ? { title: "Checking the pricing page", at: "2:14 PM", steps: 4, going: true } : s === "ended" ? { title: "Put October in the launch budget", at: "2:14 PM", steps: 8 } : { title: "Putting October in the launch budget", at: "2:14 PM", steps: 5, going: true },
    { title: "Gave the status page to Sawyer", at: "1:40 PM", steps: 2 }, { title: "Read the launch checklist", at: "1:38 PM", steps: 3 }];
  var doing = !going ? "Ready" : view.held ? "Paused" : s === "browser" ? "Using a browser" : "Using the screen";
  var now = !going ? "" : `<div class="sec"><h3><span>On ${SCN[key].on} now</span></h3><div class="job" data-do="large" title="Open it large"><span class="mini">${screen(key, { cls: "xs" })}</span><span class="grow"><div class="t">${key === "web" ? "A browser" : "The screen"}</div><div class="s trunc" data-say="${key}">${esc(saying(key))}</div></span><button class="btn sm" data-do="stop">Stop</button></div></div>`;
  return `<aside class="panel"><div class="top">${orb("pip", 176, { id: "main" })}<button class="pname" data-do="toast:Pip's settings, as today">Pip<span class="mut">${ic("gear", 14)}</span></button><p>${doing}</p></div>${now}` +
    `<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>What it did here</h3>${did.map(run).join("")}</div></aside>`;
}
/* The steps so far, and the one under way. */
function steps(key) {
  var l = live[key];
  return SCN[key].steps.map((st, i) => `<div class="step${i < l.n ? "" : i === l.doing ? " now" : " todo"}" data-i="${i}"><span class="mk">${i < l.n ? ic("check", 13) : spinner(12)}</span><span class="trunc">${esc(st.say)}</span></div>`).join("");
}
function large() {
  var key = sceneKey(), s = SCN[key];
  return `<div class="veil dim" data-do="shut"><div class="dlg big" data-do="none"><div class="bs">${screen(key)}</div><div class="bl"><div class="bh"><b>${s.on}</b><span class="k">${key === "web" ? `<span class="url" data-url>${urlAt(live.web.n)}</span>` : "The screen"} · <span data-clock="${key}">${clock(s.secs + tick)}</span></span></div>` +
    `<div class="steps" data-steps="${key}">${steps(key)}</div><div class="bf"><button class="btn" data-do="hold">${ic(view.held ? "play" : "pause", 15)}${view.held ? "Carry on" : "Pause"}</button><button class="btn" data-do="stop">${ic("stop", 15)}Stop</button></div></div>` +
    `<button class="ib x" data-do="shut" title="Close">${ic("x", 17)}</button></div></div>`;
}

/* ---------- on the computer itself ---------- */
function yours() {
  var held = view.held;
  var bar = held ? `${orb("pip", 26, { still: true })}<b>Pip is paused</b><span class="k">It carries on when you say.</span><button class="btn sm" data-do="hold">${ic("play", 13)}Carry on</button><button class="btn sm" data-do="stop">Stop</button>`
    : `${orb("pip", 26, { still: true })}<b>Pip is using this computer</b><span class="k trunc" data-say="desk">${esc(saying("desk"))}</span><button class="btn sm" data-do="hold">${ic("pause", 13)}Pause</button><button class="btn sm" data-do="stop">Stop</button><kbd>esc</kbd>`;
  return `<div class="yours"><div class="mon${held ? " held" : ""}">${screen("desk", { cls: "big", mine: [860, 560] })}<div class="glow"></div><div class="ypill">${bar}</div></div></div>`;
}

/* ---------- allowing it ---------- */
function allow() {
  var sw = (k) => `<button class="tg${view.on[k] ? " on" : ""}" data-do="sw:${k}" title="${view.on[k] ? "On" : "Off"}"></button>`;
  var perms = !view.on.screen ? "" : `<div class="perm"><div><span class="ok">${ic("okc", 14)}</span>macOS lets Do Computer control this Mac</div><div><span class="mut">${ic("warn", 14)}</span><span class="grow">macOS has not let Do Computer record the screen</span><button class="btn sm" data-do="toast:This opens System Settings at Screen Recording">Open System Settings</button></div></div>`;
  var win = `<div class="appw"><div class="wt"><i></i><i></i><i></i><span>Do Computer</span></div><main><div><h1>This computer</h1><p class="mut">Agents you connect to it can run commands and read and change files here, as you.</p></div>` +
    `<div class="cardy"><div class="rw"><span class="dot"></span><span class="grow"><div class="n">Connected as “MacBook”</div><div class="d">Pip and Ledger can work here.</div></span><button class="btn sm" data-do="toast:As it is today">Stop sharing</button></div></div>` +
    `<h2>What agents can use here</h2><div class="cardy">` +
    `<div class="rw"><span class="grow"><div class="n">The screen</div><div class="d">They see the screen and use the mouse and keyboard, with a pointer of their own that you can watch. You can pause or stop them at any time.</div>${perms}</span>${sw("screen")}</div>` +
    `<div class="rw"><span class="grow"><div class="n">A browser</div><div class="d">A browser of their own on this computer. It keeps its own sign-ins and has none of yours.</div></span>${sw("browser")}</div></div>` +
    `<p class="k">An agent cannot change these. They are kept on this computer.</p></main></div>`;
  var chat = view.on.screen
    ? `<div class="m h me"><div class="line"><div class="bub">Put October's invoice in the launch budget on my MacBook.</div></div></div><div class="m"><div class="tool"><span class="shine">Using MacBook's screen…</span></div></div>`
    : `<div class="m h me"><div class="line"><div class="bub">Put October's invoice in the launch budget on my MacBook.</div></div></div>` +
      `<div class="ask"><div class="hd">${ic("desktop", 17)}MacBook does not let agents use its screen</div><div class="mut">Sawyer can switch it on in the Do Computer app on that computer, under This Computer.</div></div>` +
      `<div class="m"><div class="prose"><p>I cannot use the screen on your MacBook yet: that is switched off there. I can still read the invoice if it is saved as a file, and edit the budget if you tell me where the sheet is kept. Or switch the screen on and I will do it the way you would.</p></div></div>`;
  return `<div class="allow"><figure><figcaption><b>In the Do Computer app, on the computer</b>Try the switches.</figcaption>${win}</figure>` +
    `<figure><figcaption><b>In a chat, ${view.on.screen ? "once it is on" : "while the screen is off"}</b>${view.on.screen ? "Nothing more to answer: it starts." : "Pip is told why, and so are you."}</figcaption><div class="sidechatty">${chat}</div></figure></div>`;
}

/* ---------- on a phone: the chat only ---------- */
function phoneScene() {
  var top = `<div class="m-top"><button class="ib">${ic("list", 18)}</button><span class="who">${orb("pip", 24, { still: true })}<b>Pip</b><span class="mut">${ic("down", 12)}</span></span><span class="grow"></span><button class="ib">${ic("gear", 17)}</button></div>` +
    `<nav class="tabs m-tabs">${["Chat", "Library", "Automations"].map((t) => `<span class="tab${t === "Chat" ? " on" : ""}">${t}</span>`).join("")}</nav>`;
  var one = (scene, o, title, words) => {
    var keep = { open: view.open, frame: view.frame };
    view.open = o.film ? { film: true } : {};
    var inner = talk(scene, true).slice(1).map(message).join("") + (o.steps ? `<div class="steps" data-steps="desk">${steps("desk")}</div>` : "");
    view.open = keep.open;
    return `<figure class="phone-w"><div class="phone">${top}<div class="scroll"><div class="msgs">${inner}</div></div><div class="foot">${composer("Message Pip", true)}</div></div><figcaption><b>${title}</b>${words}</figcaption></figure>`;
  };
  return '<div class="phones">' + one("screen", {}, "Going", "The window where Pip began, with the screen as it is now.") +
    one("screen", { steps: true }, "Touched", "The steps so far unfold under it. Stop is on the window.") +
    one("browser", {}, "A browser", "The same, with the page's address.") +
    one("ended", { film: true }, "Ended", "One line, and the pictures behind it.") + "</div>";
}

/* ---------- drawing and what the buttons do ---------- */
function fit() { document.querySelectorAll(".scr").forEach((el) => { el.style.setProperty("--k", el.clientWidth / 1280); }); }
function render() {
  var s = view.scene;
  app.innerHTML = s === "phone" ? phoneScene() : s === "yours" || s === "paused" ? yours() : s === "allow" ? allow()
    : (view.list ? side() : "") + `<div class="main">${middle()}${view.panel ? panel() : ""}</div>` + (view.big ? large() : "");
  strip.innerHTML = "<b>Mock-up</b>" + SCENES.map((x) => x ? `<button class="${x[0] === s ? "on" : ""}" data-do="scene:${x[0]}">${x[1]}</button>` : "<i></i>").join("") +
    `<span class="sp"></span><button data-do="ptr">Pointer: ${view.ptr === "name" ? "its name" : "the creature"}</button><button data-do="theme">Light / dark</button>` + `<div class="note"><b>${NOTES[s][0]}</b>${NOTES[s][1]}</div>`;
  if (location.hash !== "#" + s) history.replaceState(null, "", "#" + s);
  fit();
  mountOrbs();
  act(s === "ended" || s === "allow" || view.held ? "idle" : "working");
  document.querySelectorAll(".scroll").forEach((p) => { p.scrollTop = p.scrollHeight; });
}
/* A scene from the strip, or from the address: set up so that it shows what it is named for. */
function show(scene) {
  view.scene = scene; view.list = true; view.panel = true;
  view.held = scene === "paused"; view.big = scene === "large";
  view.open = scene === "ended" ? { film: true } : {};
  view.frame = 3;
  render();
}
function toast(words) {
  var t = document.createElement("div"); t.className = "toast"; t.textContent = words; app.appendChild(t);
  setTimeout(function () { t.remove(); }, 2600);
}
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-do]");
  if (!el) return;
  var d = el.dataset.do.split(":"), a = d[0], v = d.slice(1).join(":");
  e.stopPropagation();
  if (a === "none") return;
  if (a === "toast") return toast(v);
  if (a === "scene") return show(v);
  if (a === "stop") { show("ended"); return toast("Stopped. Pip is told that you stopped it, and how far it got."); }
  if (a === "large") { if (view.scene === "phone") return toast("On a phone the steps unfold under the window"); view.big = true; if (view.scene === "screen") view.scene = "large"; }
  else if (a === "shut") { view.big = false; if (view.scene === "large") view.scene = "screen"; }
  else if (a === "hold") { view.held = !view.held; if (view.scene === "paused" && !view.held) view.scene = "yours"; else if (view.scene === "yours" && view.held) view.scene = "paused"; }
  else if (a === "fold") view.open[v] = !view.open[v];
  else if (a === "frame") view.frame = +v;
  else if (a === "sw") view.on[v] = !view.on[v];
  else if (a === "list") view.list = !view.list;
  else if (a === "panel") view.panel = !view.panel;
  else if (a === "ptr") view.ptr = view.ptr === "name" ? "creature" : "name";
  else if (a === "theme") document.documentElement.classList.toggle("dark");
  render();
});
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  if (view.big) { view.big = false; if (view.scene === "large") view.scene = "screen"; render(); }
  else if (view.scene === "yours") { view.held = true; view.scene = "paused"; render(); }
});
window.addEventListener("hashchange", function () { var s = location.hash.slice(1); if (NOTES[s] && s !== view.scene) show(s); });
window.addEventListener("resize", fit);

/* What is on a going screen is changed where it is: nothing is drawn again for it. */
function paint(key, how) {
  var l = live[key], at = whereAt(key, l.doing >= 0 && SCN[key].steps[l.doing].to ? l.doing + 1 : l.n);
  document.querySelectorAll(`.scr[data-live="${key}"]`).forEach((el) => {
    if (how !== "move") el.querySelector(".stage").innerHTML = SCN[key].draw(l.n);
    var c = el.querySelector(".aptr");
    c.style.setProperty("--x", at[0]); c.style.setProperty("--y", at[1]);
    if (how === "click") { c.classList.remove("click"); void c.offsetWidth; c.classList.add("click"); }
    if (how === "look") { el.classList.remove("look"); void el.offsetWidth; el.classList.add("look"); }
  });
  document.querySelectorAll(`[data-say="${key}"]`).forEach((el) => { el.textContent = saying(key); });
  document.querySelectorAll(`[data-steps="${key}"]`).forEach((el) => { el.innerHTML = steps(key); el.scrollTop = el.scrollHeight; });
  if (key === "web") document.querySelectorAll("[data-url]").forEach((el) => { el.textContent = urlAt(l.n); });
}
/* One step: the pointer goes there, and then the step is taken. When the steps run out they
   begin again, which a real screen would not. */
function advance(key) {
  var s = SCN[key], l = live[key];
  if (l.doing >= 0) return;
  if (l.n >= s.steps.length) {
    if (++l.hold < 3) return paint(key, "move");
    l.hold = 0; l.n = 0;
    return paint(key);
  }
  var st = s.steps[l.n];
  l.doing = l.n;
  paint(key, "move");
  setTimeout(function () { l.n++; l.doing = -1; paint(key, st.k === "click" ? "click" : st.k === "look" ? "look" : ""); }, st.to ? 780 : 520);
}
setInterval(function () {
  tick++;
  var s = view.scene;
  if (view.held || s === "ended" || s === "allow") return;
  document.querySelectorAll("[data-clock]").forEach((el) => { el.textContent = clock(SCN[el.dataset.clock].secs + tick); });
  if (tick % 2) return;
  advance("desk");
  if (s === "browser" || s === "phone") advance("web");
}, 900);

resetChat();
var first = location.hash.slice(1);
show(NOTES[first] ? first : "screen");
})();
