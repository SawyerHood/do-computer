/* Model sign-in mock-up. ../agent-pages/src/head.js (icons, pretend people and agents, the
   creature) opens the function this file closes. */

P.down = '<path d="m6 9 6 6 6-6"/>';
P.sideL = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/>';
P.side = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M15 4.5v15"/>';
P.aside = '<path d="M3.5 5h11.5v8.5H8.5l-3 2.5v-2.5h-2z"/><path d="M18 9h2.5v8.5H19V20l-3-2.5h-4.5v-1"/>';
P.book = '<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>';
P.chart = '<path d="M4 20h16M7 20v-6M12 20V6M17 20v-9"/>';
P.cpu = '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>';
P.ext = '<path d="M14 5h5v5M19 5l-8 8M11 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5"/>';
P.key = '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.500-8.500M16 6.500l2.500 2.500M19 3.500 21 5.500"/>';
P.bell = '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.500 2h-15zM10 20.500a2.200 2.200 0 0 0 4 0"/>';
P.copy = '<rect x="8.500" y="8.500" width="11" height="11" rx="2"/><path d="M5.500 15.500h-1v-10a1 1 0 0 1 1-1h10v1"/>';
P.warn = '<path d="M12 4 2.500 20h19zM12 10v5M12 17.500h.01"/>';

var app = document.getElementById("app"), strip = document.getElementById("strip");
var SCENES = [
  ["models", "1 · Models"], null,
  ["claude", "2 · Claude"], ["codex", "3 · ChatGPT, by a code"], ["codex-page", "4 · ChatGPT, by a page"], ["key", "5 · A key"], null,
  ["signed-in", "6 · Signed in"], ["picker", "7 · Choosing a model"], ["lapsed", "8 · When it lapses"]
];
var NOTES = {
  models: ["Workspace settings, a new Models section.", "Every provider pi can sign in to, the ones most asked for first. A subscription is signed in to on the provider's own page; anything else takes a key. Try the buttons."],
  claude: ["A Claude Pro or Max subscription.", "Claude's page opens in a new tab and ends by showing a code, which is pasted here. That is the one way that works from a hosted app; nothing is asked about how."],
  codex: ["A ChatGPT subscription, by a code.", "OpenAI shows a page to type a short code into. The window waits and closes by itself when OpenAI says it is done."],
  "codex-page": ["A ChatGPT subscription, by a page.", "The other way OpenAI offers. Its page ends at an address on your own machine that does not load, so the address itself is pasted here. Clumsier, and it needs nothing switched on at OpenAI."],
  key: ["A key.", "For any provider. One field, typed in secret, kept with the workspace and never shown again."],
  "signed-in": ["Once signed in.", "Who signed in and with what, and how many models it gives. In a team it is said plainly that everyone's agents can use it. Whoever signed in, or an admin, can sign out."],
  picker: ["Choosing a model for an agent.", "The picker says where each model comes from. The same model can be there twice, once on a subscription and once paid by the token, and has to be told apart."],
  lapsed: ["When a sign-in is gone.", "Signed out, or a subscription's sign-in that could not be renewed. An agent still set to one of its models says so in place of its reply, with the two ways out."]
};

/* Who is signed in to what. `way` is "sub" for a subscription and "key" for a key. */
var view = { scene: "models", list: true, panel: true, sec: "models", signed: {}, dlg: null, more: false, open: true };
var KEYS = ["pip", "ledger", "scout"];
var LINE = { pip: { words: "Done. The status page is yours", at: "2m" }, ledger: { words: "Priya: can you total October?", at: "52m" }, scout: { words: "Three launches worth a look this week", at: "Tue" } };
var WS_SECTIONS = [["team", "Team", "users"], ["computers", "Computers", "desktop"], ["models", "Models", "cpu"], ["agents", "New agents", "plus"], ["notifications", "Notifications", "bell"]];
var AG_SECTIONS = [["identity", "Identity", "user"], ["memory", "Memory", "book"], ["model", "Model", "cpu"], ["skills", "Skills", "bolt"], ["connectors", "Connectors", "plug"], ["permissions", "Permissions", "shield"], ["usage", "Usage", "chart"]];

/* The providers shown first. `sub` is what its subscription sign-in is called; `key` whether it
   takes a key; `n` how many models it gives. */
var PROVIDERS = [
  { id: "anthropic", name: "Anthropic", c: "#c96442", sub: "Claude Pro or Max", key: true, n: 17 },
  { id: "openai", name: "OpenAI", c: "#10a37f", sub: "ChatGPT", key: true, n: 44 },
  { id: "codex", name: "OpenAI Codex", c: "#0f766e", sub: "ChatGPT Plus or Pro", key: false, n: 9 },
  { id: "copilot", name: "GitHub Copilot", c: "#6e5494", sub: "Copilot", key: true, n: 34 },
  { id: "openrouter", name: "OpenRouter", c: "#6467f2", sub: "OpenRouter", key: true, n: 312, own: true },
  { id: "google", name: "Google", c: "#4285f4", sub: null, key: true, n: 21 },
  { id: "xai", name: "xAI", c: "#3f3f46", sub: "SuperGrok or X Premium", key: true, n: 8 }
];
var REST = ["Ant Ling", "Azure OpenAI", "Baseten", "Cerebras", "Cloudflare AI Gateway", "Cloudflare Workers AI", "DeepSeek", "Fireworks", "Groq", "Hugging Face", "Kimi For Coding", "Meta", "MiniMax", "Mistral", "Moonshot AI", "NVIDIA", "OpenCode", "Qwen", "Together", "TypeSafe", "Vercel AI Gateway", "Xiaomi", "Z.AI"];
function prov(id) { return PROVIDERS.filter((p) => p.id === id)[0]; }
function pm(p, size) { return `<span class="pm" style="--c:${p.c};--s:${size || 32}px">${p.name[0]}</span>`; }

function spinner(size) { return `<span class="spin mut" title="Working">${ic("ring", size || 13)}</span>`; }

/* ---------- the sidebar, the agent's strip and the chat, as they are in the app ---------- */
function side() {
  var row = (key) => {
    var a = AGENTS[key], l = LINE[key], cur = key === "pip";
    return `<div class="arow${cur ? " sel cur" : ""}" data-do="${cur ? "scene:lapsed" : "toast:Only Pip is in this mock-up"}">${orb(key, 40)}<span class="grow"><div class="t"><span class="grow trunc">${a.name}</span><span class="end">${l.at}</span></div><div class="s"><span class="trunc">${esc(l.words)}</span></div></span></div>`;
  };
  return `<aside class="side"><div class="ws-h"><button class="wsw" data-do="scene:models">${tile("T", TEAM.c, 26)}<b class="trunc">Tidewater</b><span class="mut">${ic("sort", 13)}</span></button><button class="ib" data-do="list" title="Hide the sidebar">${ic("sideL", 17)}</button></div>` +
    `<div class="side-h" style="padding-top:8px"><h2 class="lbl">Agents</h2><button class="ib" data-do="toast:New agent" title="New agent">${ic("plus", 17)}</button></div><div class="chats flat">${KEYS.map(row).join("")}</div>` +
    `<div class="side-f me"><button class="prow" data-do="scene:models">${face("me", 26, "on")}<span class="grow trunc">Sawyer Hood</span><span class="mut">${ic("sort", 13)}</span></button></div></aside>`;
}
function ahead() {
  var t = (label, on) => `<button class="tab${on ? " on" : ""}" data-do="${on ? "scene:lapsed" : "toast:" + label + " is as it is today"}">${label}</button>`;
  return '<header class="ahead">' + (view.list ? "" : `<button class="ib" data-do="list" title="Show the sidebar" style="margin-left:-6px">${ic("sideL", 17)}</button>`) +
    `<button class="who" data-do="toast:Another agent, as today">${orb("pip", 26, { still: true })}<b>Pip</b><span class="mut">${ic("down", 13)}</span></button>` +
    `<nav class="tabs">${t("Chat", true)}${t("Library")}${t("Automations")}</nav><span class="grow"></span>${stack(["me", "maya"], 26)}` +
    `<button class="scb" data-do="toast:Side chats, as today">${ic("aside", 17)}Side chats<span class="n">5</span></button>` +
    `<span class="acts"><button class="ib" data-do="scene:picker" title="Pip's settings">${ic("gear", 17)}</button><button class="ib${view.panel ? " on" : ""}" data-do="panel" title="Pip's panel">${ic("side", 17)}</button></span></header>`;
}
function message(m) {
  if (m.day) return `<div class="dayd">${m.day}</div>`;
  if (m.failed) return `<div class="m"><div class="failed"><div class="t">${ic("warn", 17)}The workspace isn't signed in to this model's provider.</div><div class="d">Pip is set to Claude Sonnet 5.5 on a Claude subscription, and Tidewater is no longer signed in to Anthropic. Sign in again, or pick another model for Pip.</div><div class="acts"><button class="btn sm pri" data-do="scene:claude">Sign in again</button><button class="btn sm" data-do="scene:picker">Pick another model</button></div></div></div>`;
  if (m.agent) return `<div class="m"><div class="prose">${m.html}</div></div>`;
  var mine = m.by === "me", p = PEOPLE[m.by];
  return `<div class="m h${mine ? " me" : ""}">${mine ? "" : `<div class="who"><b>${p.full}</b>${m.at}</div>`}<div class="line"><div class="bub">${esc(m.text)}</div>${mine ? "" : face(m.by, 30)}</div></div>`;
}
function talk() {
  var list = [{ day: "Today" },
    { by: "me", text: "Put the status page under my name. I'll do it tonight." },
    { agent: true, html: "<p>Done. The status page is yours in the checklist, due Wednesday.</p>" }];
  if (view.scene === "lapsed") list.push({ by: "maya", at: "4:10 PM", text: "Pip, is the launch email ready to go?" }, { failed: true });
  return list;
}
function middle() {
  return `<div class="acol">${ahead()}<div class="chat"><div class="scroll"><div class="msgs">${talk().map(message).join("")}</div></div><div class="foot"><div class="comp"><textarea placeholder="Message Pip"></textarea><div class="r"><button class="ib" title="Attach">${ic("clip", 17)}</button><span class="grow"></span><button class="send" data-do="toast:Only the navigation works in this mock-up" title="Send">${ic("up", 17)}</button></div></div></div></div></div>`;
}
function panel() {
  var run = (r) => `<div class="run"><span class="mut">${ic("okc", 16)}</span><div class="grow"><div class="t">${esc(r.title)}</div><div class="s">${face(r.by, 15)}for ${r.by === "me" ? "you" : PEOPLE[r.by].name} · ${r.at} · ${r.steps} steps</div></div></div>`;
  return `<aside class="panel"><div class="top">${orb("pip", 176, { id: "main" })}<button class="pname" data-do="scene:picker">Pip<span class="mut">${ic("gear", 14)}</span></button><p>${view.scene === "lapsed" ? "Could not answer" : "Ready"}</p></div>` +
    `<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>What it did here</h3>${runs.map(run).join("")}</div></aside>`;
}

/* ---------- workspace settings: the Models section ---------- */
function head(title, words) { return `<div class="sh"><h1>${title}</h1><p>${words}</p></div>`; }
function providerRow(p) {
  var s = view.signed[p.id];
  if (s) {
    var who = s.by === "me" ? "you" : PEOPLE[s.by].name;
    return `<div class="li">${pm(p)}<div class="grow"><div class="n">${p.name} <span class="ok-t" style="margin-left:6px">Signed in</span></div><div class="d">${s.way === "sub" ? p.sub + " subscription" : "API key"} · by ${who}, today · ${p.n} models</div></div><div class="acts"><button class="btn sm quiet bad" data-do="out:${p.id}">Sign out</button></div></div>`;
  }
  var acts = (p.sub ? `<button class="btn sm" data-do="in:${p.id}:sub">Sign in with ${p.sub}</button>` : "") + (p.key ? `<button class="btn sm quiet" data-do="in:${p.id}:key">${ic("key", 14)}Use a key</button>` : "");
  var what = p.own ? "Already here. Sign in to use your own account." :
    p.sub && p.key ? "A subscription or a key." : p.sub ? "A subscription, as the Codex CLI uses." : "A key.";
  return `<div class="li">${pm(p)}<div class="grow"><div class="n">${p.name}</div><div class="d">${what}</div></div><div class="acts">${acts}</div></div>`;
}
function modelsSection() {
  var any = Object.keys(view.signed).length > 0;
  return head("Models", "What Tidewater's agents can run on. Sign in with a subscription or a key, and every agent of the workspace can be set to its models.") +
    `<div class="box">${`<div class="li"><span class="pm own">${ic("cpu", 16)}</span><div class="grow"><div class="n">Do Computer's models</div><div class="d">312 models through OpenRouter, paid for by this deployment. Always there.</div></div></div>`}</div>` +
    `<div class="h2">Model providers</div><div class="box">${PROVIDERS.map(providerRow).join("")}` +
    (view.more ? `<div class="more">${REST.map((n) => `<span class="chip" data-do="in:other:key:${n}">${n}</span>`).join("")}</div>` : "") +
    `<button class="morebtn" data-do="more">${ic(view.more ? "down" : "right", 14)}${view.more ? "Fewer" : REST.length + " more, each with a key"}</button></div>` +
    `<p class="hint">${any ? "Everyone in Tidewater can set an agent to a model of a provider signed in to here, and what the agents use counts against whoever signed in." : "A sign-in belongs to the workspace: everyone in Tidewater can then set agents to its models. What they use counts against whoever signed in."} Nobody is shown a key or a token again, and agents never see one.</p>`;
}

/* ---------- agent settings: the model picker, open ---------- */
function pickerSection() {
  var row = (name, id, facts, on, tag) => `<div class="mrow${on ? " on" : ""}" data-do="toast:Chosen"><div class="grow"><div class="n">${name}${tag ? `<small>${tag}</small>` : ""}</div><div class="d">${id} · ${facts}</div></div>${on ? `<span class="ck">${ic("check", 16)}</span>` : ""}</div>`;
  var a = prov("anthropic"), c = prov("codex");
  return head("Model", "What Pip runs on, and how hard it thinks before it answers.") +
    `<div class="lab">Model</div><div class="mp">Search 338 models</div>` +
    `<div class="mlist">` +
    `<div class="g">${pm(a, 16)}Claude subscription · signed in by you</div>` +
    row("Claude Sonnet 5.5", "anthropic/claude-sonnet-5-5", "on the subscription · 1M context", true, "suggested") +
    row("Claude Opus 5.5", "anthropic/claude-opus-5-5", "on the subscription · 1M context", false, "suggested") +
    row("Claude Haiku 5.5", "anthropic/claude-haiku-5-5", "on the subscription · 1M context", false, "suggested") +
    `<div class="g">${pm(c, 16)}ChatGPT subscription · signed in by Maya</div>` +
    row("GPT-6.1 Sol", "openai-codex/gpt-6.1-sol", "on the subscription · 272K context", false, "suggested") +
    row("GPT-6 Astra", "openai-codex/gpt-6-astra", "on the subscription · 272K context", false, "suggested") +
    `<div class="g"><span class="pm own" style="--s:16px">${ic("cpu", 10)}</span>Do Computer · OpenRouter</div>` +
    row("Claude Sonnet 5.5", "anthropic/claude-sonnet-5.5", "$2 in, $10 out per million tokens · 1M context", false, "suggested") +
    row("Claude Opus 5.5", "anthropic/claude-opus-5.5", "$4 in, $20 out per million tokens · 1M context", false, "suggested") +
    row("GPT-5.1", "openai/gpt-5.1", "$1.25 in, $10 out per million tokens · 400K context", false, "suggested") +
    `<p style="border-top:1px solid var(--border);padding:8px 14px;font-size:12px;color:var(--muted-foreground)">330 more. Type to narrow them down.</p></div>`;
}

function settingsModal() {
  var agent = view.scene === "picker";
  var sections = agent ? AG_SECTIONS : WS_SECTIONS, sec = agent ? "model" : view.sec;
  var body = agent ? pickerSection() : sec === "models" ? modelsSection() : head(sections.filter((x) => x[0] === sec)[0][1], "As it is today. Only Models is drawn in this mock-up.");
  var who = agent ? `${orb("pip", 30, { still: true })}<span><b>Pip</b><span class="mut">Agent settings</span></span>` : `${tile("T", TEAM.c, 30)}<span><b>Tidewater</b><span class="mut">Workspace settings</span></span>`;
  return `<div class="veil dim" data-do="close"><div class="dlg setm" data-stop><nav class="snav"><div class="sm-h">${who}</div>` +
    sections.map((x) => `<button class="sn${sec === x[0] ? " on" : ""}" data-do="${agent ? "toast:As it is today" : "sec:" + x[0]}">${ic(x[2], 16)}${x[1]}</button>`).join("") +
    `</nav><div class="col">${body}</div><button class="ib x" data-do="close" title="Close">${ic("x", 16)}</button></div></div>`;
}

/* ---------- the sign-in window ---------- */
function step(n, title, words, inner) { return `<li class="step"><span class="num">${n}</span><div class="grow"><h3>${title}</h3><p>${words}</p>${inner}</div></li>`; }
function signIn() {
  var d = view.dlg, p = prov(d.p) || { name: d.name, c: "#64748b", sub: null };
  var foot = (label, ok) => `<div class="acts"><span class="grow"></span><button class="btn" data-do="cancel">Cancel</button>${label ? `<button class="btn pri" data-do="${ok}">${label}</button>` : ""}</div>`;
  var shared = `<p class="fine">Everyone in Tidewater can then set agents to these models, and what the agents use counts against your account there.</p>`;
  var body;
  if (d.way === "key") {
    body = `<h2>${p.name} API key</h2><p class="sub">Paid for by the token, on your account with ${p.name}.</p>` +
      `<div class="one-f"><label>API key</label><input class="field mono" type="password" placeholder="${d.p === "anthropic" ? "sk-ant-…" : "Paste the key"}"><small>Kept with the workspace and never shown again. Agents never see it.</small></div>` + shared + foot("Save", "done");
  } else if (d.p === "anthropic") {
    body = `<h2>Sign in with Claude</h2><p class="sub">Use a Claude Pro or Max subscription for Tidewater's agents.</p><ol class="steps">` +
      step(1, "Sign in at Claude", "Claude's page opens in a new tab. Sign in and allow access; it then shows a code.", `<button class="btn" data-do="toast:claude.ai opens in a new tab">Open Claude's sign-in page${ic("ext", 14)}</button>`) +
      step(2, "Paste the code it shows", "", `<input class="field mono" placeholder="code#state">`) + `</ol>` +
      `<p class="fine">Everyone in Tidewater can then set agents to these models, and what the agents use counts against your Claude plan. Anthropic decides how use outside its own apps is billed; it may count as extra usage.</p>` + foot("Sign in", "done");
  } else if (d.step === "code") {
    body = `<h2>Sign in with ChatGPT</h2><p class="sub">Enter this code on OpenAI's page.</p><div class="code">QK7P-XM2D</div>` +
      `<div class="acts" style="margin-top:12px"><button class="btn" data-do="toast:auth.openai.com/codex/device opens in a new tab">Open OpenAI's page${ic("ext", 14)}</button><button class="btn quiet" data-do="toast:Copied">${ic("copy", 14)}Copy the code</button></div>` +
      `<div class="wait">${spinner(14)}<span class="grow">Waiting for you to enter it there. This closes by itself.</span><span>14:32 left</span></div>` + shared +
      `<div class="acts"><button class="btn quiet" data-do="way:page" style="margin-left:-14px">Use a page instead</button><span class="grow"></span><button class="btn" data-do="cancel">Cancel</button><button class="btn pri" data-do="done" title="In the app this happens by itself, once the code is entered at OpenAI">Entered (pretend)</button></div>`;
  } else if (d.step === "page") {
    body = `<h2>Sign in with ChatGPT</h2><p class="sub">Use a ${p.sub} subscription for Tidewater's agents.</p><ol class="steps">` +
      step(1, "Sign in at OpenAI", "OpenAI's page opens in a new tab.", `<button class="btn" data-do="toast:auth.openai.com opens in a new tab">Open OpenAI's sign-in page${ic("ext", 14)}</button>`) +
      step(2, "Paste the address you end up at", "After you sign in, the tab goes to an address that starts with <span class=\"mono\">localhost:1455</span> and does not load. That is expected. Copy the whole address from the address bar.", `<input class="field mono" placeholder="http://localhost:1455/auth/callback?code=…">`) + `</ol>` + shared +
      `<div class="acts"><button class="btn quiet" data-do="way:code" style="margin-left:-14px">Use a code instead</button><span class="grow"></span><button class="btn" data-do="cancel">Cancel</button><button class="btn pri" data-do="done">Sign in</button></div>`;
  } else {
    body = `<h2>Sign in with ${p.sub}</h2><p class="sub">${p.name}'s own page opens in a new tab and, once you have signed in, brings what it gives back here.</p>` +
      `<div class="acts" style="margin-top:0"><button class="btn" data-do="toast:${p.name}'s page opens in a new tab">Open ${p.name}'s sign-in page${ic("ext", 14)}</button></div>` + shared + foot("Pretend I signed in", "done");
  }
  return `<div class="veil dim over" data-do="cancel"><div class="dlg signin" data-stop>${body}</div></div>`;
}

/* ---------- drawing and what the buttons do ---------- */
var OVER = { models: 1, claude: 1, codex: 1, "codex-page": 1, key: 1, "signed-in": 1, picker: 1 };
function render() {
  var s = view.scene;
  app.innerHTML = (view.list ? side() : "") + `<div class="main">${middle()}${view.panel ? panel() : ""}</div>` + (OVER[s] && view.open ? settingsModal() : "") + (view.dlg ? signIn() : "");
  strip.innerHTML = "<b>Mock-up</b>" + SCENES.map((x) => x ? `<button class="${x[0] === s ? "on" : ""}" data-do="scene:${x[0]}">${x[1]}</button>` : "<i></i>").join("") +
    '<span class="sp"></span><button data-do="theme">Light / dark</button>' + `<div class="note"><b>${NOTES[s][0]}</b>${NOTES[s][1]}</div>`;
  if (location.hash !== "#" + s) history.replaceState(null, "", "#" + s);
  mountOrbs();
}
/* A scene from the strip, or from the address: set up so that it shows what it is named for. */
function show(scene) {
  view.scene = scene; view.list = view.panel = view.open = true; view.sec = "models"; view.dlg = null; view.more = false;
  view.signed = {};
  if (scene === "claude") view.dlg = { p: "anthropic", way: "sub" };
  if (scene === "codex") view.dlg = { p: "codex", way: "sub", step: "code" };
  if (scene === "codex-page") view.dlg = { p: "codex", way: "sub", step: "page" };
  if (scene === "key") view.dlg = { p: "anthropic", way: "key" };
  if (scene === "signed-in" || scene === "picker") view.signed = { anthropic: { way: "sub", by: "me" }, codex: { way: "sub", by: "maya" } };
  if (scene === "lapsed") view.open = false;
  render();
}
function toast(words) {
  var t = document.createElement("div"); t.className = "toast"; t.style.zIndex = 50; t.textContent = words; app.appendChild(t);
  setTimeout(function () { t.remove(); }, 2400);
}
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-do],[data-stop]");
  if (!el || !el.dataset.do) return;
  var d = el.dataset.do.split(":"), a = d[0], v = d.slice(1).join(":");
  e.stopPropagation();
  if (a === "toast") return toast(v);
  if (a === "scene") return show(v);
  if (a === "close") { view.open = false; view.dlg = null; view.scene = "lapsed"; view.signed = {}; }
  else if (a === "sec") view.sec = v;
  else if (a === "more") view.more = !view.more;
  else if (a === "in") view.dlg = { p: d[1], way: d[2], name: d[3], step: d[1] === "codex" ? "code" : undefined };
  else if (a === "way") view.dlg.step = v;
  else if (a === "cancel") view.dlg = null;
  else if (a === "done") {
    if (prov(view.dlg.p)) view.signed[view.dlg.p] = { way: view.dlg.way, by: "me" };
    var name = (prov(view.dlg.p) || view.dlg).name; view.dlg = null; view.scene = "signed-in"; view.open = true; view.sec = "models"; render();
    return toast("Signed in to " + name);
  }
  else if (a === "out") delete view.signed[v];
  else if (a === "list") view.list = !view.list;
  else if (a === "panel") view.panel = !view.panel;
  else if (a === "theme") document.documentElement.classList.toggle("dark");
  render();
});
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  if (view.dlg) view.dlg = null; else if (OVER[view.scene]) { view.open = false; view.scene = "lapsed"; }
  render();
});
window.addEventListener("hashchange", function () { var s = location.hash.slice(1); if (NOTES[s] && s !== view.scene) show(s); });

resetChat();
var first = location.hash.slice(1);
show(NOTES[first] ? first : "models");
})();
