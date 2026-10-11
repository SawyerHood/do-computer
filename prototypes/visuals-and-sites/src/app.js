/* Visuals and shared sites mock-up. ../agent-pages/src/head.js (icons, pretend people and agents,
   the creature) opens the function this file closes. */

P.down = '<path d="m6 9 6 6 6-6"/>';
P.sideL = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/>';
P.side = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M15 4.5v15"/>';
P.aside = '<path d="M3.5 5h11.5v8.5H8.5l-3 2.5v-2.5h-2z"/><path d="M18 9h2.5v8.5H19V20l-3-2.5h-4.500v-1"/>';
P.globe = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.600 2.500 4 5.600 4 9s-1.400 6.500-4 9c-2.600-2.500-4-5.600-4-9s1.400-6.500 4-9z"/>';
P.expand = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M13 4.5v15M6.500 13.500l3-3M9.500 13v-2.500H7"/>';
P.share = '<path d="M12 15V3.500M7.500 7.500 12 3l4.500 4.500"/><path d="M6 11.500H5a1.500 1.500 0 0 0-1.500 1.500v6A1.500 1.500 0 0 0 5 20.500h14a1.500 1.500 0 0 0 1.500-1.500v-6a1.500 1.500 0 0 0-1.500-1.500h-1"/>';
P.copy = '<rect x="8.500" y="8.500" width="11.500" height="11.500" rx="2"/><path d="M15.500 8.500V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.500a2 2 0 0 0 2 2h2.500"/>';
P.ext = '<path d="M14 4h6v6M20 4l-9 9M18 14v4.500a1.500 1.500 0 0 1-1.500 1.500h-11A1.500 1.500 0 0 1 4 18.500v-11A1.500 1.500 0 0 1 5.500 6H10"/>';
P.file = '<path d="M6.500 3h7L19 8.500v11A1.500 1.500 0 0 1 17.500 21h-11A1.500 1.500 0 0 1 5 19.500v-15A1.500 1.500 0 0 1 6.500 3z"/><path d="M13.500 3v5.500H19"/>';
P.left = '<path d="m15 6-6 6 6 6"/>';
P.reload = '<path d="M20 12a8 8 0 1 1-2.600-5.900M20 4v4.500h-4.500"/>';

var app = document.getElementById("app"), strip = document.getElementById("strip");
var SCENES = [
  ["visual", "1 · A visual in the chat"], ["beside", "2 · Opened beside the chat"], null,
  ["shared", "3 · The agent shares a site"], ["share", "4 · Who can open it"], ["ask", "5 · The agent asks to make it public"], null,
  ["site", "6 · The site, in a browser tab"], ["private", "7 · Opened by someone outside"], null,
  ["library", "8 · Shared sites in the library"], ["phone", "9 · On a phone"]
];
var NOTES = {
  visual: ["A visual in the chat.", "Pip answered with a small page of its own, drawn straight on the chat above what it wrote, in the app's colors. The two buttons at its top right show when the pointer is over it: open it beside the chat, and share it."],
  beside: ["Opened beside the chat.", "The visual is a file in the library, under visuals/. Here it is open where Pip's panel is, as the page or as its source, and can be shared from there."],
  shared: ["The agent shares a site.", "Pip made a page and published it with a tool. The site has an address of its own, and to begin with only people in Tidewater can open it."],
  share: ["Who can open it.", "From the card's menu. The two choices work: the card, the library and the browser scenes follow. Stop sharing takes the address away and leaves the file."],
  ask: ["The agent asks to make it public.", "Pip may share with the workspace by itself. Making a page public is asked for in the app's usual approval request, and a person answers. Allow works."],
  site: ["The site, in a browser tab.", "The address opened by someone in Tidewater: the agent's page and nothing of Do Computer around it. The page's look is the agent's own."],
  "private": ["Opened by someone outside.", "The same address for someone who is not in the workspace, while it is shared with Tidewater only: nothing of the page, and a way to sign in. Once the site is public this scene shows the page."],
  library: ["Shared sites in the library.", "The library's front page lists what is shared as a website: what it is, the file or folder it serves, who shared it and who can open it. The menu on a row is the same one as in the chat."],
  phone: ["On a phone.", "The visual takes the width of the chat and is drawn again for it, not shrunk. Its buttons are always there, since nothing hovers on a phone."]
};
var KEYS = ["pip", "ledger", "scout"];
/* What is shared as a website. `pub` is whether anyone with the link may open it. */
var SITES;
function resetSites() {
  SITES = {
    plan: { title: "Launch plan", path: "sites/launch-plan/", id: "k3x9v2qd7m", by: "pip", at: "today" },
    q3: { title: "Signups, Q3", path: "visuals/signups-q3.html", id: "p8r4m1wz6c", by: "me", at: "today" },
    price: { title: "Pricing explainer", path: "sites/pricing-explainer/", id: "t7h2c5nb0j", by: "maya", at: "Tuesday", pub: true }
  };
}
var view = { scene: "visual", list: true, panel: true, pop: null, src: false, asked: null };
function addr(k) { return "do.computer/s/" + SITES[k].id; }
function wc(k) { var s = SITES[k]; return s.off ? '<span class="wc off">Not shared</span>' : `<span class="wc${s.pub ? " pub" : ""}">${ic(s.pub ? "globe" : "lock", 12)}${s.pub ? "Public" : "Tidewater only"}</span>`; }
function spinner(size) { return `<span class="spin mut" title="Working">${ic("ring", size || 13)}</span>`; }

/* ---------- the visual: a page Pip wrote, drawn here as it would be ---------- */
var FREE = [212, 230, 221, 248, 263, 255, 290, 312, 301, 340, 362, 355, 398], PAID = [38, 41, 40, 47, 52, 49, 58, 66, 61, 73, 80, 84, 96];
function chart(W, H) {
  var l = 30, r = 34, t = 8, b = 22, iw = W - l - r, ih = H - t - b, n = FREE.length;
  var x = (i) => l + iw * i / (n - 1), y = (v) => t + ih * (1 - v / 400), f = (v) => v.toFixed(1);
  var pts = (d) => d.map((v, i) => f(x(i)) + "," + f(y(v))).join(" ");
  var grid = [0, 100, 200, 300, 400].map((v) => `<line class="g" x1="${l}" x2="${W - r}" y1="${f(y(v))}" y2="${f(y(v))}"/><text x="${l - 8}" y="${f(y(v) + 4)}" text-anchor="end">${v}</text>`).join("");
  /* Thirteen weeks: July has the first five, August and September four each. */
  var months = [["Jul", 0, 4.5], ["Aug", 4.5, 8.5], ["Sep", 8.5, 12]].map((m) => `<text x="${f(x((m[1] + m[2]) / 2))}" y="${H - 4}" text-anchor="middle">${m[0]}</text>` + (m[1] ? `<line class="g" x1="${f(x(m[1]))}" x2="${f(x(m[1]))}" y1="${f(y(0))}" y2="${f(y(0) + 5)}"/>` : "")).join("");
  var series = (d, c) => `<polyline class="ln" points="${pts(d)}" style="stroke:var(${c})"/><circle class="dot" cx="${f(x(n - 1))}" cy="${f(y(d[n - 1]))}" r="4.500" style="fill:var(${c})"/><text class="v" x="${f(x(n - 1) + 9)}" y="${f(y(d[n - 1]) + 4)}" style="fill:var(${c})">${d[n - 1]}</text>`;
  return `<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Signups by week in the third quarter, free and paid">${grid}${months}${series(PAID, "--v2")}${series(FREE, "--v1")}</svg>`;
}
function visual(W, H, at) {
  var on = view.pop === "q3@" + at;
  return `<div class="viz"><div class="viz-acts${on ? " on" : ""}"><button class="ib" data-do="scene:beside" title="Open beside the chat">${ic("expand", 17)}</button><button class="ib${on ? " on" : ""}" data-do="share:q3@${at}" title="Share">${ic("share", 17)}</button>${on ? sharepop("q3") : ""}</div>` +
    `<div class="vt"><b>Signups by week, Q3</b><span class="lg"><i style="--c:var(--v1)"></i><span>Free</span><i style="--c:var(--v2)"></i><span>Paid</span></span></div>${chart(W, H)}</div>`;
}
var SOURCE = '<!doctype html>\n<meta charset="utf-8">\n<title>Signups by week, Q3</title>\n<style>\n  body { margin: 0; font: 14px/1.45 var(--dc-font);\n         color: var(--dc-foreground); background: transparent; }\n  .free { stroke: var(--dc-series-1); }\n  .paid { stroke: var(--dc-series-2); }\n  text  { fill: var(--dc-muted-foreground); font-size: 11px; }\n</style>\n<header>\n  <b>Signups by week, Q3</b>\n  <span class="legend"><i class="free"></i>Free <i class="paid"></i>Paid</span>\n</header>\n<svg viewBox="0 0 736 280" role="img">\n  <polyline class="free" points="30.0,145.5 86.0,134.2 142.0,139.9 …"/>\n  <polyline class="paid" points="30.0,254.2 86.0,252.4 142.0,253.0 …"/>\n  …\n</svg>';

/* ---------- a shared site: its card, and the popover that says who can open it ---------- */
function sharepop(k, cls) {
  var s = SITES[k];
  var row = (pub, icon, n, d) => `<button class="wrow${!!s.pub === pub ? " on" : ""}" data-do="who:${k}:${pub ? "pub" : "ws"}"><span class="gl">${ic(icon, 16)}</span><span class="grow"><div class="n">${n}</div><div class="d">${d}</div></span><span class="rd"></span></button>`;
  return `<div class="sharepop ${cls || ""}"><h4>${ic("globe", 16)}Shared as a website</h4><div class="lk"><span class="grow trunc">${addr(k)}</span><button class="btn sm" data-do="copy:${k}">${ic("copy", 13)}Copy</button></div>` +
    `<div class="lb">Who can open it</div>${row(false, "lock", "People in Tidewater", "Anyone in this workspace who is signed in")}${row(true, "globe", "Anyone with the link", "No sign-in needed")}` +
    `<hr><button class="stopsh" data-do="unshare:${k}">Stop sharing</button></div>`;
}
function siteCard(k, at) {
  var s = SITES[k], on = view.pop === k + "@" + at;
  var acts = s.off ? `<button class="btn sm" data-do="reshare:${k}">Share again</button>` :
    `<button class="btn sm" data-do="copy:${k}">${ic("copy", 13)}Copy link</button><button class="btn sm" data-do="scene:site">Open${ic("ext", 13)}</button>${view.phone ? "" : `<button class="ib${on ? " on" : ""}" data-do="share:${k}@${at}" title="Who can open it">${ic("down", 15)}</button>`}`;
  return `<div class="sitec-w"><div class="sitec${s.off ? " off" : ""}"><span class="gl">${ic("globe", 19)}</span><div class="w"><div class="t"><b class="trunc">${s.title}</b>${wc(k)}</div><div class="a">${s.off ? "The page is still in the library" : addr(k)}</div></div><div class="acts">${acts}</div></div>${on ? sharepop(k, "up") : ""}</div>`;
}

/* ---------- the sidebar and the agent's strip, as they are in the app ---------- */
function pipLine() {
  var s = view.scene;
  if (s === "ask" && !view.asked) return { words: "Waiting for an OK", end: '<span class="amber"></span>' };
  if (s === "visual" || s === "beside") return { words: "Free signups nearly doubled over the quarter.", end: "now" };
  return { words: SITES.plan.pub ? "It is public now." : "The launch plan is on a page of its own.", end: "now" };
}
var LINE = { ledger: { words: "Priya: can you total October?", end: "52m" }, scout: { words: "Three launches worth a look this week", end: "Tue" } };
function side() {
  var row = (key) => {
    var a = AGENTS[key], cur = key === "pip", l = cur ? pipLine() : LINE[key];
    return `<div class="arow${cur ? " sel cur" : ""}" data-do="${cur ? "scene:visual" : "toast:Only Pip is in this mock-up"}">${orb(key, 40)}<span class="grow"><div class="t"><span class="grow trunc">${a.name}</span><span class="end">${l.end}</span></div><div class="s"><span class="trunc">${esc(l.words)}</span></div></span></div>`;
  };
  return `<aside class="side"><div class="ws-h"><button class="wsw" data-do="toast:The workspace menu is as it is today">${tile("T", TEAM.c, 26)}<b class="trunc">Tidewater</b><span class="mut">${ic("sort", 13)}</span></button><button class="ib" data-do="list" title="Hide the sidebar">${ic("sideL", 17)}</button></div>` +
    `<div class="side-h" style="padding-top:8px"><h2 class="lbl">Agents</h2><button class="ib" data-do="toast:New agent" title="New agent">${ic("plus", 17)}</button></div><div class="chats flat">${KEYS.map(row).join("")}</div>` +
    `<div class="side-f me"><button class="prow" data-do="toast:Your menu is as it is today">${face("me", 26, "on")}<span class="grow trunc">Sawyer Hood</span><span class="mut">${ic("sort", 13)}</span></button></div></aside>`;
}
function ahead(tab) {
  var t = (label, to) => `<button class="tab${label === tab ? " on" : ""}" data-do="${to || "toast:" + label + " is as it is today"}">${label}</button>`;
  return '<header class="ahead">' + (view.list ? "" : `<button class="ib" data-do="list" title="Show the sidebar" style="margin-left:-6px">${ic("sideL", 17)}</button>`) +
    `<button class="who" data-do="toast:Another agent, as today">${orb("pip", 26, { still: true })}<b>Pip</b><span class="mut">${ic("down", 13)}</span></button>` +
    `<nav class="tabs">${t("Chat", "scene:visual")}${t("Library", "scene:library")}${t("Automations")}</nav><span class="grow"></span>${stack(["me"], 26)}` +
    `<button class="scb" data-do="toast:Side chats, as today">${ic("aside", 17)}Side chats<span class="n">5</span></button>` +
    `<span class="acts"><button class="ib" data-do="toast:Pip's settings, as today" title="Pip's settings">${ic("gear", 17)}</button><button class="ib${view.panel ? " on" : ""}" data-do="panel" title="Pip's panel">${ic("side", 17)}</button></span></header>`;
}

/* ---------- what is said ---------- */
function message(m) {
  if (m.day) return `<div class="dayd">${m.day}</div>`;
  if (m.tool) return `<div class="m"><div class="tool"><span class="shine">${m.tool}…</span></div></div>`;
  if (m.agent) return `<div class="m">${m.vis ? visual(m.vis[0], m.vis[1], "chat") : ""}${m.site ? siteCard(m.site, "card") : ""}<div class="prose">${m.html}</div></div>`;
  return `<div class="m h me"><div class="line"><div class="bub">${esc(m.text)}</div></div></div>`;
}
function talk(scene, size) {
  var list = [{ day: "Today" }], link = `<code>${addr("plan")}</code>`;
  if (scene === "visual") return list.concat({ by: "me", text: "How did signups go this quarter?" },
    { agent: true, vis: size, html: "<p>Free signups nearly doubled, from 212 a week to 398, and most of the rise came after the pricing page changed on 18 August. Paid grew faster still: 15% of signups in July, 19% in September.</p>" + (view.phone ? "" : "<p>The chart is kept in the library as <code>visuals/signups-q3.html</code>.</p>") });
  list.push({ by: "me", text: "Put the launch plan on a page the team can open." },
    { agent: true, site: "plan", html: "<p>The launch plan is on a page of its own now. Everyone in Tidewater can open it with that link once they are signed in, and it follows <code>sites/launch-plan/</code> in the library, so it changes when I change the plan.</p><p>It can be made public too, if someone outside needs to see it.</p>" });
  if (scene !== "ask") return list;
  list.push({ by: "me", text: "make it public so I can send it to the agency" });
  if (!view.asked) list.push({ tool: "Waiting for an OK to make the page public" });
  else if (view.asked === "no") list.push({ agent: true, html: "<p>I have left it as it was: only people in Tidewater can open it. If the agency only needs to read it once, I can send them a PDF of the page.</p>" });
  else list.push({ agent: true, html: `<p>It is public now: anyone with the link can open it, with no sign-in. Here it is for the agency:</p><p>${link}</p><p>Say the word and I will close it to Tidewater again after the launch.</p>` });
  return list;
}
function composer(words) {
  return `<div class="comp"><textarea placeholder="${words}"></textarea><div class="r"><button class="ib" title="Attach">${ic("clip", 17)}</button><span class="grow"></span><button class="send" data-do="toast:Only the sharing and the navigation work in this mock-up" title="Send">${ic("up", 17)}</button></div></div>`;
}
function askBox() {
  if (view.scene !== "ask" || view.asked) return "";
  return `<div class="ask"><div class="hd">${ic("shield", 17)}<span><b>Pip</b> wants to: <b>Make a page public</b></span></div><div class="from">Launch plan · anyone with the link could open it</div><pre>${addr("plan")}</pre>` +
    `<div class="acts"><button class="btn sm pri" data-do="ok:yes">Allow once</button><button class="btn sm" data-do="ok:always">Always allow</button><button class="btn sm" data-do="ok:no">Don't allow</button></div></div>`;
}
function middle() {
  var s = view.scene, vis = s === "visual" || s === "beside";
  return `<div class="acol">${ahead("Chat")}<div class="chat"><div class="scroll"><div class="msgs">${talk(vis ? "visual" : s, s === "beside" ? [630, 260] : [736, 280]).map(message).join("")}</div></div><div class="foot">${askBox()}${composer("Message Pip")}</div></div></div>`;
}
function panel() {
  var s = view.scene, wait = s === "ask" && !view.asked;
  var run = (r) => `<div class="run">${r.going ? spinner(16) : `<span class="mut">${ic("okc", 16)}</span>`}<div class="grow"><div class="t">${esc(r.title)}</div><div class="s">${face("me", 15)}for you · ${r.at} · ${r.steps} ${r.steps === 1 ? "step" : "steps"}</div></div></div>`;
  var did = s === "visual" ? [{ title: "Drew signups by week", at: "2:14 PM", steps: 3 }] : [{ title: "Shared the launch plan as a site", at: "2:31 PM", steps: 4 }];
  if (s === "ask") did.unshift(wait ? { title: "Making the launch plan public", at: "2:36 PM", steps: 1, going: true } : { title: view.asked === "no" ? "Left the launch plan as it was" : "Made the launch plan public", at: "2:36 PM", steps: 1 });
  did.push({ title: "Gave the status page to Sawyer", at: "1:40 PM", steps: 2 });
  return `<aside class="panel"><div class="top">${orb("pip", 176, { id: "main" })}<button class="pname" data-do="toast:Pip's settings, as today">Pip<span class="mut">${ic("gear", 14)}</span></button><p>${wait ? "Waiting for an OK" : "Ready"}</p></div>` +
    `<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>What it did here</h3>${did.map(run).join("")}</div></aside>`;
}
/* The visual opened where the panel is. */
function docPanel() {
  var on = view.pop === "q3@doc", seg = (label, src) => `<button class="${view.src === src ? "on" : ""}" data-do="src:${src ? "source" : "page"}">${label}</button>`;
  return `<aside class="panel docp"><div class="dh"><span class="mut">${ic("file", 16)}</span><span class="fn grow trunc">visuals/signups-q3.html</span><span class="seg">${seg("Page", false)}${seg("Source", true)}</span>` +
    `<span class="sw-w"><button class="btn sm" data-do="share:q3@doc">${ic("share", 14)}Share</button>${on ? sharepop("q3") : ""}</span><button class="ib" data-do="scene:visual" title="Close">${ic("x", 17)}</button></div>` +
    `<div class="pg">${view.src ? `<pre class="src">${esc(SOURCE)}</pre>` : visual(720, 400, "page")}</div>` +
    `<div class="df">${wc("q3")}<span class="grow trunc">Written by Pip today · shared by Sawyer at ${addr("q3")}</span></div></aside>`;
}

/* ---------- the site in a browser, and the library ---------- */
function browser(tab, body) {
  return `<div class="brw-w"><div class="brw"><div class="brw-tabs"><span class="dots"><i></i><i></i><i></i></span><span class="brw-tab">${ic(tab === "Launch plan" ? "file" : "lock", 13)}<span class="grow trunc">${tab}</span>${ic("x", 12)}</span><span style="align-self:center">${ic("plus", 15)}</span></div>` +
    `<div class="brw-bar">${ic("left", 17)}${ic("right", 17)}${ic("reload", 15)}<div class="brw-url">${ic("lock", 12)}<b style="font-weight:400">do.computer<span>/s/${SITES.plan.id}</span></b></div>${ic("dots", 17)}</div><div class="brw-body">${body}</div></div></div>`;
}
function launchPage() {
  var li = (done, words, who) => `<li class="${done ? "d" : ""}"><span class="bx">${done ? ic("check", 12) : ""}</span><span class="t">${words}</span><em>${who}</em></li>`;
  return `<div class="lp"><div class="in"><div class="kick">Tidewater · autumn launch</div><h1>Launch plan</h1><p class="sub">Yearly billing goes live on Thursday. This page is the one place that says what is done, what is not, and who has it.</p>` +
    `<div class="steps"><div class="d"><small>Monday</small><b>Price agreed</b>$24 a seat, billed yearly</div><div class="d"><small>Tuesday</small><b>Copy frozen</b>Pricing page and email</div><div class="n"><small>Wednesday</small><b>Status page live</b>Dry run at 4 PM</div><div><small>Thursday</small><b>Launch</b>Email goes at 9 AM</div></div>` +
    `<div class="cols"><section><h2>Checklist</h2><ul>${li(true, "Agree the yearly price", "Maya")}${li(true, "Pricing page copy approved", "Jon")}${li(true, "Launch email written", "Maya")}${li(false, "Status page set up", "Sawyer · Wed")}${li(false, "Dry run of checkout on the new plan", "Jon · Wed")}${li(false, "Send the launch email", "Pip · Thu 9 AM")}</ul></section>` +
    `<section><h2>At a glance</h2><div class="aside"><b>Still open</b><div class="big">3 of 6</div><p>Nothing is late.</p></div><div class="aside"><b>Who to ask</b><p>Price and copy: Maya Okafor<br>Checkout and the site: Jon Reyes<br>Everything else: ask Pip in Tidewater</p></div></section></div>` +
    `<p class="ft">Kept up to date by Pip · last changed today at 2:31 PM</p></div></div>`;
}
function gate() {
  return `<div class="gate"><span class="gl">${ic("lock", 21)}</span><h1>This page is shared with one workspace only.</h1><p>Sign in with an account that is in it to open the page.</p><button class="btn pri" data-do="toast:Sign in, as today. Then back to this address">Sign in</button><small>Do Computer</small></div>`;
}
function library() {
  var tree = [[0, "folder", "sites"], [1, "folder", "launch-plan", "plan"], [2, "file", "index.html"], [2, "file", "checklist.html"], [1, "folder", "pricing-explainer", "price"], [0, "folder", "visuals"], [1, "file", "signups-q3.html", "q3"], [1, "file", "churn-by-plan.html"], [0, "folder", "notes"], [0, "file", "launch-checklist.md"], [0, "file", "pricing-copy.md"], [0, "file", "investor-update.md"]];
  var node = (n) => `<button class="sn" style="--d:${n[0]}" data-do="toast:Files open as they do today">${ic(n[1], 15)}<span class="trunc">${n[2]}</span>${n[3] && !SITES[n[3]].off ? `<span class="wc" title="Shared as a website">${ic(SITES[n[3]].pub ? "globe" : "lock", 12)}</span>` : ""}</button>`;
  var keys = ["plan", "q3", "price"].filter((k) => !SITES[k].off);
  var row = (k) => {
    var s = SITES[k], on = view.pop === k + "@row", who = s.by === "pip" ? `${orb("pip", 18, { still: true })}Pip` : `${face(s.by, 18)}${PEOPLE[s.by].full}`;
    return `<div class="srow"><span class="gl">${ic("globe", 18)}</span><div class="grow"><div class="n"><span class="trunc">${s.title}</span></div><div class="d"><code>${s.path}</code>·<span class="trunc">${addr(k)}</span></div></div><span class="by">${who} · ${s.at}</span><span class="wc-w">${wc(k)}</span>` +
      `<button class="ib" data-do="copy:${k}" title="Copy link">${ic("link", 16)}</button><button class="ib${on ? " on" : ""}" data-do="share:${k}@row" title="Who can open it">${ic("dots", 17)}</button>${on ? sharepop(k) : ""}</div>`;
  };
  var recent = [["file", "signups-q3.html", "visuals · Pip, 2:14 PM"], ["file", "index.html", "sites/launch-plan · Pip, 2:31 PM"], ["note", "launch-checklist.md", "Sawyer, 2:05 PM"], ["note", "pricing-copy.md", "Jon, yesterday"]];
  return `<div class="acol">${ahead("Library")}<div class="lib"><div class="ltree"><div class="th"><span class="grow">Files</span><button class="ib" data-do="toast:New file, as today" title="New file">${ic("plus", 16)}</button></div><div class="nodes">${tree.map(node).join("")}</div></div>` +
    `<div class="lfront"><div class="in"><h1>Library</h1><p class="sub">What Pip and the team keep: notes, pages and visuals.</p>` +
    `<h3>${ic("globe", 13)}Shared as websites</h3><div class="rows">${keys.length ? keys.map(row).join("") : '<div class="srow"><span class="none">Nothing is shared as a website.</span></div>'}</div>` +
    `<h3>Recent</h3><div class="fgrid">${recent.map((f) => `<button class="fcard" data-do="toast:Files open as they do today"><span class="gl">${ic(f[0], 16)}</span><span class="grow"><div class="n trunc">${f[1]}</div><div class="d trunc">${f[2]}</div></span></button>`).join("")}</div></div></div></div></div>`;
}

/* ---------- on a phone: the chat only ---------- */
function phoneScene() {
  var top = `<div class="m-top"><button class="ib">${ic("list", 18)}</button><span class="who">${orb("pip", 24, { still: true })}<b>Pip</b><span class="mut">${ic("down", 12)}</span></span><span class="grow"></span><button class="ib">${ic("gear", 17)}</button></div>` +
    `<nav class="tabs m-tabs">${["Chat", "Library", "Automations"].map((t) => `<span class="tab${t === "Chat" ? " on" : ""}">${t}</span>`).join("")}</nav>`;
  var one = (scene, title, words) => {
    view.phone = true;
    var inner = top + `<div class="scroll"><div class="msgs">${talk(scene, [294, 165]).slice(1).map(message).join("")}</div></div><div class="foot">${composer("Message Pip")}</div>`;
    view.phone = false;
    return `<figure class="phone-w wide"><div class="phone">${inner}</div><figcaption><b>${title}</b>${words}</figcaption></figure>`;
  };
  return '<div class="phones">' + one("visual", "A visual", "As wide as the chat, drawn for that width. The two buttons are always there.") +
    one("shared", "A shared site", "The same card, with its actions on a line of their own.") + "</div>";
}

/* ---------- drawing and what the buttons do ---------- */
function render() {
  var s = view.scene, body;
  if (s === "phone") body = phoneScene();
  else if (s === "site") body = browser("Launch plan", SITES.plan.off ? gate() : launchPage());
  else if (s === "private") body = SITES.plan.pub && !SITES.plan.off ? browser("Launch plan", launchPage()) : browser("Do Computer", gate());
  else body = (view.list ? side() : "") + `<div class="main">${s === "library" ? library() : middle() + (s === "beside" ? docPanel() : view.panel ? panel() : "")}</div>`;
  app.innerHTML = body;
  strip.innerHTML = "<b>Mock-up</b>" + SCENES.map((x) => x ? `<button class="${x[0] === s ? "on" : ""}" data-do="scene:${x[0]}">${x[1]}</button>` : "<i></i>").join("") +
    '<span class="sp"></span><button data-do="theme">Light / dark</button>' + `<div class="note"><b>${NOTES[s][0]}</b>${NOTES[s][1]}</div>`;
  if (location.hash !== "#" + s) history.replaceState(null, "", "#" + s);
  mountOrbs();
  act(s === "ask" && !view.asked ? "waiting" : "idle");
  document.querySelectorAll(".acol .scroll").forEach((p) => { p.scrollTop = p.scrollHeight; });
}
/* A scene from the strip, or from the address: set up so that it shows what it is named for. The
   sidebar is folded away while a visual is open beside the chat, to leave it room. Who
   can open a site is kept from scene to scene, so that a choice made in one shows in the others. */
function show(scene) {
  view.scene = scene; view.list = scene !== "beside"; view.panel = true; view.src = false; view.asked = null;
  view.pop = scene === "share" ? "plan@card" : null;
  if (scene === "ask" || scene === "shared") { SITES.plan.pub = false; SITES.plan.off = false; }
  render();
}
function toast(words) {
  var t = document.createElement("div"); t.className = "toast"; t.textContent = words; app.appendChild(t);
  setTimeout(function () { t.remove(); }, 2600);
}
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-do]");
  if (!el) { if (view.pop && !e.target.closest(".sharepop")) { view.pop = null; render(); } return; }
  var d = el.dataset.do.split(":"), a = d[0], v = d.slice(1).join(":"), said = null;
  e.stopPropagation();
  if (a === "toast") return toast(v);
  if (a === "copy") return toast("Copied " + addr(v));
  if (a === "scene") return show(v);
  if (a === "share") view.pop = view.pop === v ? null : v;
  else if (a === "who") { SITES[d[1]].pub = d[2] === "pub"; said = d[2] === "pub" ? "Anyone with the link can open it now" : "Only people in Tidewater can open it now"; }
  else if (a === "unshare") { SITES[v].off = true; SITES[v].pub = false; view.pop = null; said = "No longer shared. The address stops working, and the file stays in the library."; }
  else if (a === "reshare") { SITES[v].off = false; said = "Shared with Tidewater again, at the same address"; }
  else if (a === "ok") { view.asked = v; if (v !== "no") SITES.plan.pub = true; if (v === "always") said = "Pip will not ask again before making a page public"; }
  else if (a === "src") view.src = v === "source";
  else if (a === "list") view.list = !view.list;
  else if (a === "panel") view.panel = !view.panel;
  else if (a === "theme") document.documentElement.classList.toggle("dark");
  render();
  if (said) toast(said);
});
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && view.pop) { view.pop = null; render(); } });
window.addEventListener("hashchange", function () { var s = location.hash.slice(1); if (NOTES[s] && s !== view.scene) show(s); });

resetChat();
resetSites();
var first = location.hash.slice(1);
show(NOTES[first] ? first : "visual");
})();
