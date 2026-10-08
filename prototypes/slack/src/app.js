/* Slack mock-up. ../agent-pages/src/head.js (icons, pretend people and agents, the creature)
   opens the function this file closes. */

P.down = '<path d="m6 9 6 6 6-6"/>';
P.left = '<path d="m15 6-6 6 6 6"/>';
P.sideL = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/>';
P.side = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M15 4.5v15"/>';
P.aside = '<path d="M3.5 5h11.5v8.5H8.5l-3 2.5v-2.5h-2z"/><path d="M18 9h2.5v8.5H19V20l-3-2.5h-4.5v-1"/>';
P.book = '<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>';
P.chart = '<path d="M4 20h16M7 20v-6M12 20V6M17 20v-9"/>';
P.cpu = '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>';
P.trash = '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>';
P.ext = '<path d="M14 5h5v5M19 5l-8 8M11 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5"/>';
P.stop = '<rect x="7" y="7" width="10" height="10" rx="2"/>';
P.hash = '<path d="M9.500 4 7.500 20M16.500 4l-2 16M4.500 9h16M3.500 15h16"/>';
P.slack = '<rect width="3" height="8" x="13" y="2" rx="1.5"/><path d="M19 8.5V10h1.500A1.500 1.500 0 1 0 19 8.500"/><rect width="3" height="8" x="8" y="14" rx="1.5"/><path d="M5 15.500V14H3.500A1.500 1.500 0 1 0 5 15.500"/><rect width="8" height="3" x="14" y="13" rx="1.5"/><path d="M15.500 19H14v1.500a1.500 1.500 0 1 0 1.500-1.500"/><rect width="8" height="3" x="2" y="8" rx="1.5"/><path d="M8.500 5H10V3.500A1.500 1.500 0 1 0 8.500 5"/>';

/* Someone who is in the Slack workspace and not in this one. */
PEOPLE.dana = { name: "Dana", full: "Dana Whitfield", ini: "DW", c: "#64748b" };

var app = document.getElementById("app"), strip = document.getElementById("strip");
var SCENES = [
  ["setup", "1 · Add to Slack"], ["in-slack", "2 · In Slack"], null,
  ["slack", "3 · Over in Slack"], null,
  ["panel", "4 · In the agent"], ["thread", "5 · A thread"], ["guest", "6 · Someone outside"], null,
  ["connector", "7 · Slack as a connector"], ["ask", "8 · Using it"]
];
var NOTES = {
  setup: ["Agent settings, a new Slack section.", "Three steps and four things to paste. The first button opens Slack's own “create app” page already filled in for this agent, so nothing is typed there."],
  "in-slack": ["Once it is there.", "The agent is a bot in your Slack under its own name. No switches: the two rules about who it works for are stated, not set. The connector is offered from here, since it signs in with the same Slack app."],
  slack: ["Over in Slack (drawn plainly; this part is Slack's).", "Mention it and it answers in the thread. Mention it again there and it carries on the same conversation, having read what was said in between."],
  panel: ["Back in Do Computer.", "Each Slack thread is a conversation of the agent's. They are listed in its panel under “From Slack”, the way conversations from other agents are, and not in the sidebar. The main chat is untouched by them."],
  thread: ["A thread, opened.", "Read here, written in from Slack: no message box. A teammate has their face; the line under the strip says where it is and leads to Slack. While the agent is at work in one, it can be stopped from here."],
  guest: ["Someone who is not in the workspace.", "Dana is in the Slack workspace and not in Tidewater. The agent answers her, but using a connector or one of your own computers for her waits for an OK here. Try the two buttons."],
  connector: ["Slack as a connector.", "A second, separate thing: Slack's own MCP server, signed in to as a person. It sits with the other connectors and follows the same rules as they do."],
  ask: ["Using the connector.", "From any chat, the agent can search Slack, read channels and post. It does so as whoever signed in: it sees what they see, and what it sends is from them."]
};

/* What is on screen. `inSlack` is whether the bot has been added, `asMe` whether the connector is
   signed in, `dana` whether the outsider has asked, and `ok` what she was answered. */
var view = { scene: "setup", list: true, panel: true, inSlack: false, asMe: false, dana: false, ok: null, sec: "slack" };
var KEYS = ["pip", "ledger", "scout"];
var LINE = {
  pip: { words: "Answering in Slack", at: "now", busy: true },
  ledger: { words: "Priya: can you total October?", at: "52m" },
  scout: { words: "Three launches worth a look this week", at: "Tue" }
};
var SECTIONS = [["identity", "Identity", "user"], ["memory", "Memory", "book"], ["model", "Model", "cpu"], ["skills", "Skills", "bolt"], ["connectors", "Connectors", "plug"], ["slack", "Slack", "slack"], ["permissions", "Permissions", "shield"], ["usage", "Usage", "chart"]];

function li(icon, name, desc, end) { return `<div class="li">${icon}<div class="grow"><div class="n">${name}</div><div class="d">${desc}</div></div>${end || ""}</div>`; }
function spinner(size) { return `<span class="spin mut" title="Working">${ic("ring", size || 13)}</span>`; }
function slk(size, cls) { return `<span class="slk ${cls || ""}" style="--s:${size}px">${ic("slack", Math.round(size * 0.52))}</span>`; }
/* How the launch thread is getting on, which depends on how far the story has gone. */
function launchStatus() { return !view.dana ? "done" : view.ok === null ? "waiting" : "done"; }
function threads() {
  return [
    { id: "launch", title: "What is still open on the launch checklist?", place: "#launch", status: launchStatus(), at: view.dana ? "now" : "12m" },
    { id: "status", title: "Is the status page up yet?", place: "#support", status: "working" },
    { id: "october", title: "Can you total October for me?", place: "Direct message", status: "done", at: "1h" }
  ];
}
var WORDS = { working: "answering", waiting: "waiting for your OK", done: "answered" };
function mark(status, at) {
  return status === "working" ? spinner(14) : status === "waiting" ? '<span class="amber" title="Waiting for your OK"></span>' : `<span class="mut" style="font-size:11.5px">${at || ""}</span>`;
}

/* ---------- the sidebar and the agent's strip, as they are in the app ---------- */
function side() {
  var row = (key) => {
    var a = AGENTS[key], l = LINE[key], cur = key === "pip";
    return `<div class="arow${cur ? " sel cur" : ""}" data-do="${cur ? "scene:panel" : "toast:Only Pip is in this mock-up"}">${orb(key, 40)}<span class="grow"><div class="t"><span class="grow trunc">${a.name}</span><span class="end">${l.busy ? spinner(13) : l.at}</span></div><div class="s"><span class="trunc">${esc(l.words)}</span></div></span></div>`;
  };
  return `<aside class="side"><div class="ws-h"><button class="wsw" data-do="toast:The workspace menu is as it is today">${tile("T", TEAM.c, 26)}<b class="trunc">Tidewater</b><span class="mut">${ic("sort", 13)}</span></button><button class="ib" data-do="list" title="Hide the sidebar">${ic("sideL", 17)}</button></div>` +
    `<div class="side-h" style="padding-top:8px"><h2 class="lbl">Agents</h2><button class="ib" data-do="toast:New agent" title="New agent">${ic("plus", 17)}</button></div><div class="chats flat">${KEYS.map(row).join("")}</div>` +
    `<div class="side-f me"><button class="prow" data-do="toast:Your menu is as it is today">${face("me", 26, "on")}<span class="grow trunc">Sawyer Hood</span><span class="mut">${ic("sort", 13)}</span></button></div></aside>`;
}
function ahead() {
  var t = (label, on) => `<button class="tab${on ? " on" : ""}" data-do="${on ? "scene:panel" : "toast:" + label + " is as it is today"}">${label}</button>`;
  return '<header class="ahead">' + (view.list ? "" : `<button class="ib" data-do="list" title="Show the sidebar" style="margin-left:-6px">${ic("sideL", 17)}</button>`) +
    `<button class="who" data-do="toast:Another agent, as today">${orb("pip", 26, { still: true })}<b>Pip</b><span class="mut">${ic("down", 13)}</span></button>` +
    `<nav class="tabs">${t("Chat", true)}${t("Library")}${t("Automations")}</nav><span class="grow"></span>${stack(["me", "maya"], 26)}` +
    `<button class="scb" data-do="toast:Side chats, as today">${ic("aside", 17)}Side chats<span class="n">5</span></button>` +
    `<span class="acts"><button class="ib" data-do="scene:${view.inSlack ? "in-slack" : "setup"}" title="Pip's settings">${ic("gear", 17)}</button><button class="ib${view.panel ? " on" : ""}" data-do="panel" title="Pip's panel">${ic("side", 17)}</button></span></header>`;
}

/* ---------- what is said ---------- */
function message(m) {
  if (m.day) return `<div class="dayd">${m.day}</div>`;
  if (m.tool) return `<div class="m"><div class="tool">${m.live ? `<span class="shine">${m.tool}</span>` : `<span>${m.tool}</span>`}</div></div>`;
  if (m.note) return `<div class="said">${m.note}</div>`;
  if (m.agent) return `<div class="m"><div class="prose">${m.html}</div></div>`;
  var mine = m.by === "me" && !m.slack, p = PEOPLE[m.by];
  // Someone known only from Slack has no face here: the Slack mark stands where one would be.
  var who = m.slack === "outside" ? slk(30, "who") : face(m.by, 30);
  var via = m.slack ? `<span class="via">${ic("slack", 11)}in Slack${m.slack === "outside" ? " · not in Tidewater" : ""}</span>` : "";
  return `<div class="m h${mine ? " me" : ""}">${mine ? "" : `<div class="who"><b>${p.full}</b>${m.at}${via}</div>`}<div class="line"><div class="bub">${esc(m.text)}</div>${mine ? "" : who}</div></div>`;
}
function composer(words) {
  return `<div class="comp"><textarea placeholder="${words}"></textarea><div class="r"><button class="ib" title="Attach">${ic("clip", 17)}</button><span class="grow"></span><button class="send" data-do="toast:Only the navigation works in this mock-up" title="Send">${ic("up", 17)}</button></div></div>`;
}
var OPEN = "<p>Three things are still open:</p><ul><li><b>Pricing page copy</b>: Jon has a draft, not yet approved.</li><li><b>Status page</b>: Sawyer's, due Wednesday.</li><li><b>Launch email</b>: written, waiting on the final price.</li></ul>";
var NEEDS = "<p>Searching Slack is something I do as Sawyer, so it needs an OK from the Tidewater team first. I have asked, and I will answer here once someone says yes.</p>";
var PRICE = "<p>Leadership settled on <b>$24 a seat, billed yearly</b>. Maya proposed it on Thursday and Sawyer agreed on Friday.</p>";
var REFUSED = "<p>The team said no to that, so I cannot look it up. Maya or Sawyer would know.</p>";
function launchTalk() {
  var list = [
    { by: "jon", at: "2:02 PM", slack: "member", text: "@Pip what is still open on the launch checklist? We ship Thursday." },
    { agent: true, html: OPEN }
  ];
  if (!view.dana) return list;
  list.push({ by: "dana", at: "2:14 PM", slack: "outside", text: "@Pip what did leadership settle on for the price? It was in #leadership last week." }, { agent: true, html: NEEDS });
  if (view.ok === "yes") list.push({ note: "<b>Sawyer</b> allowed this once" }, { tool: "Searched Slack" }, { agent: true, html: PRICE });
  if (view.ok === "no") list.push({ note: "<b>Sawyer</b> said no" }, { agent: true, html: REFUSED });
  return list;
}
/* The main chat is its own conversation: what is said in Slack is not copied into it. */
function mainTalk() {
  return [{ day: "Today" },
    { by: "me", text: "Put the status page under my name. I'll do it tonight." },
    { agent: true, html: "<p>Done. The status page is yours in the checklist, due Wednesday.</p>" },
    { by: "maya", at: "2:21 PM", text: "Pip, remind everyone on Thursday at 9 that we ship at noon." },
    { agent: true, html: "<p>I will, at 9:00 on Thursday, here in this chat.</p>" }];
}
function askTalk() {
  return [{ day: "Today" },
    { by: "me", text: "What did we decide about the Team price in Slack last week?" },
    { tool: "Searched Slack · 2 searches, 1 thread read" },
    { agent: true, html: "<p>In <b>#leadership</b> on Thursday, Maya proposed <b>$24 a seat, billed yearly</b>, and you agreed on Friday.</p><p>One loose end: in <b>#launch</b>, Jon asked whether that holds past ten seats. Nobody answered him.</p>" },
    { by: "me", text: "Tell Jon in #launch that it does." },
    { tool: "Sent a message in Slack" },
    { agent: true, html: "<p>Posted in <b>#launch</b>, in Jon's thread, as you: “Yes, $24 covers every seat past ten too.”</p>" }];
}

/* A thread from Slack, where the chat is: a line that says where it is, what was said, and in
   place of the message box, the way to Slack. */
function threadMiddle() {
  var s = launchStatus();
  var ask = view.dana && view.ok === null
    ? `<div class="ask"><div class="hd">${ic("shield", 17)}<span><b>Pip</b> wants to: <b>Use Slack</b></span></div><div class="from">Asked for by Dana Whitfield in Slack, who is not in Tidewater. It would search as Sawyer.</div><pre>search “price” in #leadership</pre><div class="acts"><button class="btn sm pri" data-do="ok:yes">Allow once</button><button class="btn sm" data-do="ok:no">Don't allow</button></div></div>` : "";
  return `<div class="acol">${ahead()}<div class="subbar"><button class="back" data-do="scene:panel">${ic("left", 15)}Main chat</button><span class="place">${ic("slack", 14)}#launch</span><b class="trunc">What is still open on the launch checklist?</b><span class="grow"></span>` +
    `<span class="st">${mark(s)}${s === "waiting" ? "Waiting for your OK" : "Answered"}</span><a data-do="scene:slack">Open in Slack${ic("ext", 13)}</a></div>` +
    `<div class="chat"><div class="scroll"><div class="msgs">${launchTalk().map(message).join("")}</div></div><div class="foot">${ask}<div class="readonly">${ic("slack", 16)}<span class="grow">This conversation is in Slack. Reply there to carry it on.</span><a data-do="scene:slack">Open in Slack${ic("ext", 13)}</a></div></div></div></div>`;
}
function middle() {
  if (view.scene === "thread" || view.scene === "guest") return threadMiddle();
  var ask = view.scene === "ask";
  return `<div class="acol">${ahead()}<div class="chat"><div class="scroll"><div class="msgs">${(ask ? askTalk() : mainTalk()).map(message).join("")}</div></div><div class="foot">${composer("Message Pip")}</div></div></div>`;
}
function panel() {
  var here = view.scene === "thread" || view.scene === "guest";
  var row = (t) => `<button class="frm${here && t.id === "launch" ? " sel" : ""}" data-do="${t.id === "launch" ? "scene:" + (view.dana ? "guest" : "thread") : "toast:Only the #launch thread opens in this mock-up"}">${slk(32)}<span class="grow"><div class="t trunc">${esc(t.title)}</div><div class="s${t.status === "waiting" ? " hot" : ""}">${t.place} · ${WORDS[t.status]}</div></span>${mark(t.status, t.at)}</button>`;
  var run = (r) => `<div class="run"><span class="mut">${ic("okc", 16)}</span><div class="grow"><div class="t">${esc(r.title)}</div><div class="s">${face(r.by, 15)}for ${r.by === "me" ? "you" : PEOPLE[r.by].name} · ${r.at} · ${r.steps} steps</div></div></div>`;
  var doing = view.scene === "guest" && view.ok === null ? "Waiting for your OK" : "Answering in Slack";
  return `<aside class="panel"><div class="top">${orb("pip", 176, { id: "main" })}<button class="pname" data-do="scene:${view.inSlack ? "in-slack" : "setup"}">Pip<span class="mut">${ic("gear", 14)}</span></button><p>${doing}</p></div>` +
    (view.inSlack ? `<div class="sec"><h3><span>From Slack</span></h3>${threads().map(row).join("")}</div>` : "") +
    `<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>What it did here</h3>${here ? run({ title: "Read the launch checklist", by: "jon", at: "2:02 PM", steps: 3 }) : runs.map(run).join("")}</div></aside>`;
}

/* ---------- the agent's settings ---------- */
function head(title, words) { return `<div class="sh"><h1>${title}</h1><p>${words}</p></div>`; }
function slackSection() {
  if (!view.inSlack) return head("Slack", "Put Pip in Slack as a bot. Mention it in a channel or message it, and it answers there.") +
    `<ol class="steps">` +
    `<li class="step"><span class="num">1</span><div class="grow"><h3>Create the Slack app</h3><p>Slack's page opens already filled in for Pip. Choose your workspace there and press Create.</p><button class="btn" data-do="toast:Slack's “create an app” page opens in a new tab, filled in">${ic("slack", 16)}Create Pip's Slack app${ic("ext", 14)}</button></div></li>` +
    `<li class="step"><span class="num">2</span><div class="grow"><h3>Install it</h3><p style="margin-bottom:0">On the app's page in Slack, press <b>Install to Workspace</b>.</p></div></li>` +
    `<li class="step"><span class="num">3</span><div class="grow"><h3>Paste what Slack gives you</h3><p>Both are on the app's page in Slack.</p>` +
    `<div class="two-f"><div><label>Bot token</label><input class="field mono" placeholder="xoxb-…"><small>Under OAuth &amp; Permissions</small></div><div><label>Signing secret</label><input class="field mono" type="password" placeholder="••••••••"><small>Under Basic Information</small></div></div>` +
    `<div class="aside-l">Only for searching Slack as you · optional</div>` +
    `<div class="two-f"><div><label>Client ID</label><input class="field mono"></div><div><label>Client secret</label><input class="field mono" type="password"></div></div>` +
    `<button class="btn pri" style="margin-top:16px" data-do="connect">Connect</button></div></li></ol>` +
    `<div class="kv"><b>Slack sends what is said to</b>https://do.computer/api/slack/events/4f1c…a2e9</div>`;
  return head("Slack", "Pip is in Slack as a bot. Mention it in a channel or message it, and it answers there.") +
    `<div class="box">${li(slk(32), "@Pip <span class=\"ok-t\" style=\"margin-left:6px\">In Slack</span>", "Tidewater · tidewater.slack.com · added by you today", `<button class="btn sm quiet bad" data-do="disconnect">Remove from Slack</button>`)}</div>` +
    `<p class="hint">Each thread it is spoken to in shows up in Pip's panel, under From Slack.</p>` +
    `<div class="h2">Who it works for there</div><div class="box">` +
    li(stack(["me", "maya", "jon", "priya"], 26), "People in Tidewater", "Found by their email address. Pip works for them in Slack as it does here.") +
    li(slk(26, "who"), "Everyone else in the Slack workspace", "Pip answers them. Using a connector or one of your own computers for them waits for an OK here.") + `</div>` +
    `<div class="h2">Search and write as you</div><div class="box">` +
    li(`<span class="mut">${ic("plug", 17)}</span>`, "Slack connector" + (view.asMe ? ' <span class="ok-t" style="margin-left:6px">Connected</span>' : ""),
      view.asMe ? "Signed in as Sawyer Hood. Pip can search Slack, read channels and send messages as you." : "Lets Pip search Slack, read channels and send messages as whoever signs in.",
      view.asMe ? `<button class="btn sm" data-do="sec:connectors">Open in Connectors</button>` : `<button class="btn sm" data-do="asme">Connect Slack as you</button>`) + `</div>`;
}
function connectorsSection() {
  var card = (name, host, tone, words, acts) => `<div class="card-c"><div class="r"><div class="grow"><h2>${name}</h2><div class="d">${host}</div></div>${tone}</div><div class="d">${words}</div><div class="r">${acts}</div></div>`;
  var on = `<label class="d" style="display:flex;align-items:center;gap:6px"><input type="checkbox" checked style="accent-color:var(--primary)">In use</label><span class="grow"></span><button class="btn sm quiet">${ic("trash", 14)}Remove</button>`;
  var ok = '<span class="ok-t">Connected</span>';
  return head("Connectors", "Other services Pip can reach. A teammate who uses one acts through whoever connected it.") +
    (view.asMe ? card(`<span style="display:inline-flex;align-items:center;gap:7px">${ic("slack", 16)}Slack</span>`, "mcp.slack.com · signed in as Sawyer Hood", ok, "14 tools: search messages, search files, search people, read a channel, read a thread, send a message, add a reaction, …", `<button class="btn sm">Refresh</button>${on}`)
      : card(`<span style="display:inline-flex;align-items:center;gap:7px">${ic("slack", 16)}Slack</span>`, "mcp.slack.com", "", "Lets Pip search Slack, read channels and send messages as whoever signs in. It signs in with Pip's Slack app.", `<button class="btn sm pri" data-do="asme">Connect Slack as you</button>`)) +
    card("GitHub", "api.githubcopilot.com", ok, "31 tools: search code, read a file, open a pull request, …", `<button class="btn sm">Refresh</button>${on}`) +
    card("Linear", "mcp.linear.app", ok, "22 tools: list issues, create an issue, comment, …", `<button class="btn sm">Refresh</button>${on}`) +
    `<button class="btn" style="margin-top:14px">${ic("plus", 16)}Add a connector</button>`;
}
function settingsModal() {
  var body = view.sec === "slack" ? slackSection() : view.sec === "connectors" ? connectorsSection() : head(SECTIONS.filter((x) => x[0] === view.sec)[0][1], "As it is today. Only Slack and Connectors are drawn in this mock-up.");
  return `<div class="veil dim" data-do="close"><div class="dlg setm" data-stop><nav class="snav"><div class="sm-h">${orb("pip", 30, { still: true })}<span><b>Pip</b><span class="mut">Agent settings</span></span></div>` +
    SECTIONS.map((x) => `<button class="sn${view.sec === x[0] ? " on" : ""}" data-do="sec:${x[0]}">${ic(x[2], 16)}${x[1]}</button>`).join("") +
    `</nav><div class="col">${body}</div><button class="ib x" data-do="close" title="Close">${ic("x", 16)}</button></div></div>`;
}

/* ---------- Slack itself ---------- */
function slackScene() {
  var av = (id) => `<span class="sl-av" style="--c:${PEOPLE[id].c}">${PEOPLE[id].ini}</span>`;
  var bot = (size) => `<span class="sl-av bot"${size ? ` style="width:${size}px;height:${size}px"` : ""}>${orb("pip", size || 36, { still: true })}</span>`;
  var at = '<span class="sl-at">@Pip</span>';
  var human = (id, time, html) => `<div class="sl-m">${av(id)}<div class="grow"><div class="n">${PEOPLE[id].full}<small>${time}</small></div><p>${html}</p></div></div>`;
  var pip = (time, html) => `<div class="sl-m">${bot()}<div class="grow"><div class="n">Pip<span class="app">APP</span><small>${time}</small></div>${html}</div></div>`;
  var replies = 1 + (view.dana ? 2 : 0) + (view.dana && view.ok ? 1 : 0);
  var thread = [human("jon", "2:02 PM", `${at} what is still open on the launch checklist? We ship Thursday.`), `<div class="sl-div">${replies} ${replies === 1 ? "reply" : "replies"}</div>`, pip("2:02 PM", OPEN)];
  if (view.dana) thread.push(human("dana", "2:14 PM", `${at} what did leadership settle on for the price? It was in #leadership last week.`), pip("2:14 PM", NEEDS));
  if (view.ok === "yes") thread.push(pip("2:16 PM", PRICE));
  if (view.ok === "no") thread.push(pip("2:16 PM", REFUSED));
  var ch = (name, cls) => `<div class="sl-ch ${cls || ""}">${ic("hash", 14)}${name}</div>`;
  return `<div class="sl"><aside class="sl-side"><h2>Tidewater</h2><div class="lb">Channels</div>${ch("general")}${ch("launch", "on")}${ch("leadership")}${ch("support", "b")}<div class="lb">Apps</div><div class="sl-ch">${bot(18)}Pip</div></aside>` +
    `<section class="sl-main"><div class="sl-h">${ic("hash", 16)}launch <span>12 members</span></div><div class="sl-body">` +
    human("maya", "1:40 PM", "Pricing page goes to legal tomorrow morning.") +
    `<div class="sl-m">${av("jon")}<div class="grow"><div class="n">Jon Reyes<small>2:02 PM</small></div><p>${at} what is still open on the launch checklist? We ship Thursday.</p><span class="sl-rep">${bot(22)}${replies} ${replies === 1 ? "reply" : "replies"} <span>Last reply today at ${view.dana ? (view.ok ? "2:16" : "2:14") : "2:02"} PM</span></span></div></div>` +
    human("maya", "2:20 PM", `${at} is the status page up yet?`) + `<div class="sl-think">${spinner(13)}Pip is thinking…</div>` +
    `</div><div class="sl-box">Message #launch</div></section>` +
    `<section class="sl-thread"><div class="sl-h">Thread <span># launch</span></div><div class="sl-body">${thread.join("")}</div><div class="sl-box">Reply… mention @Pip to ask it again</div></section>` +
    `<button class="sl-back" data-do="scene:${view.dana ? "guest" : "thread"}">${ic("left", 14)}This thread in Do Computer</button></div>`;
}

/* ---------- drawing and what the buttons do ---------- */
var OVER = { setup: 1, "in-slack": 1, connector: 1 };
function render() {
  var s = view.scene;
  app.innerHTML = s === "slack" ? slackScene() : (view.list ? side() : "") + `<div class="main">${middle()}${view.panel ? panel() : ""}</div>` + (OVER[s] ? settingsModal() : "");
  strip.innerHTML = "<b>Mock-up</b>" + SCENES.map((x) => x ? `<button class="${x[0] === s ? "on" : ""}" data-do="scene:${x[0]}">${x[1]}</button>` : "<i></i>").join("") +
    '<span class="sp"></span><button data-do="theme">Light / dark</button>' + `<div class="note"><b>${NOTES[s][0]}</b>${NOTES[s][1]}</div>`;
  if (location.hash !== "#" + s) history.replaceState(null, "", "#" + s);
  mountOrbs();
}
/* A scene from the strip, or from the address: set up so that it shows what it is named for. */
function show(scene) {
  view.scene = scene; view.list = view.panel = true;
  if (scene === "setup") { view.inSlack = false; view.asMe = false; view.sec = "slack"; }
  else view.inSlack = true;
  if (scene === "in-slack") view.sec = "slack";
  if (scene === "connector") { view.sec = "connectors"; view.asMe = true; }
  if (scene === "ask") view.asMe = true;
  if (scene === "guest") { if (!view.dana) view.ok = null; view.dana = true; }
  if (scene === "thread" || scene === "panel") { view.dana = false; view.ok = null; }
  render();
}
function toast(words) {
  var t = document.createElement("div"); t.className = "toast"; t.textContent = words; app.appendChild(t);
  setTimeout(function () { t.remove(); }, 2400);
}
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-do],[data-stop]");
  if (!el || !el.dataset.do) return;
  var d = el.dataset.do.split(":"), a = d[0], v = d.slice(1).join(":");
  e.stopPropagation();
  if (a === "toast") return toast(v);
  if (a === "scene") return show(v);
  if (a === "close") { view.scene = "panel"; view.dana = false; view.ok = null; }
  else if (a === "sec") { view.sec = v; if (!OVER[view.scene]) view.scene = "in-slack"; }
  else if (a === "connect") { view.inSlack = true; view.scene = "in-slack"; }
  else if (a === "disconnect") { view.inSlack = false; view.asMe = false; view.scene = "setup"; }
  else if (a === "asme") { view.asMe = true; render(); return toast("Slack's own sign-in page opens here, then brings you back"); }
  else if (a === "ok") view.ok = v;
  else if (a === "list") view.list = !view.list;
  else if (a === "panel") view.panel = !view.panel;
  else if (a === "theme") document.documentElement.classList.toggle("dark");
  render();
});
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && OVER[view.scene]) { view.scene = "panel"; render(); } });
window.addEventListener("hashchange", function () { var s = location.hash.slice(1); if (NOTES[s] && s !== view.scene) show(s); });

resetChat();
var first = location.hash.slice(1);
show(NOTES[first] ? first : "setup");
})();
