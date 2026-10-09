/* Background commands mock-up. ../agent-pages/src/head.js (icons, pretend people and agents, the
   creature) opens the function this file closes. */

P.down = '<path d="m6 9 6 6 6-6"/>';
P.sideL = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/>';
P.side = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M15 4.5v15"/>';
P.aside = '<path d="M3.5 5h11.5v8.5H8.5l-3 2.5v-2.5h-2z"/><path d="M18 9h2.5v8.5H19V20l-3-2.5h-4.5v-1"/>';
P.stop = '<rect x="7" y="7" width="10" height="10" rx="2"/>';
P.term = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7.500 10 2.500 2.250-2.500 2.250M12.500 15H16"/>';
P.warn = '<circle cx="12" cy="12" r="9"/><path d="M12 7.500v5.500M12 16.200v.3"/>';

var app = document.getElementById("app"), strip = document.getElementById("strip");
var SCENES = [
  ["running", "1 · Running in the background"], ["list", "2 · The list"], ["output", "3 · What it is printing"], null,
  ["finished", "4 · Finished"], ["failed", "5 · Failed"], null,
  ["slow", "6 · A slow command"], ["moved", "7 · Moved by itself"], null,
  ["phone", "8 · On a phone"]
];
var NOTES = {
  running: ["A command left running.", "Pip started the build in the background and ended its turn. The command is in the chat where Pip started it, in Pip's panel as sub-agents are, and counted above the message box. Pip is waiting, not working."],
  list: ["The commands that are running.", "From the count above the message box, which is there whether or not the panel is. The panel has the same rows. Stop is here, and not on the message box: that one stops a turn."],
  output: ["One command opened.", "It unfolds where it is in the chat, as a sub-agent's report does: the end of what it has printed, added to while it runs. From the panel or the list, a row leads here."],
  finished: ["A command finished.", "Word of it comes into the chat as word from a sub-agent does, and Pip answers it without being asked. Open “What it printed” for the end of the output."],
  failed: ["A command failed.", "The same, with how it ended. What went wrong is the end of what it printed."],
  slow: ["A command Pip is waiting on.", "Nothing new here: the one line says what Pip is doing, as today, and the button on the message box stops it. At 60 seconds it moves to the background by itself: see the next scene."],
  moved: ["Moved to the background by itself.", "The command was still going after a minute. It was not stopped and not started again: it turns up in the chat as a background command, and Pip carries on."],
  phone: ["On a phone.", "The chat only, to begin with: no panel and no list. A command is opened in the chat, and that is where it is stopped."]
};
var view = { scene: "running", list: true, panel: true, pop: false, open: {}, stopped: {} };
var KEYS = ["pip", "ledger", "scout"];

/* ---------- the pretend commands ---------- */
var BUILD = ["> tidewater-site@ build /home/dev/tidewater-site", "> pnpm -r build", "", "packages/ui build: Done in 3.1s", "packages/content build: Done in 1.9s", "apps/api build: Total Upload: 1843.22 KiB / gzip: 412.07 KiB", "apps/api build: Done in 21.4s", "apps/web build: vite v7.1.4 building for production...", "apps/web build: transforming...", "apps/web build: ✓ 412 modules transformed.", "apps/web build: ✓ 968 modules transformed.", "apps/web build: ✓ 1482 modules transformed.", "apps/web build: rendering chunks...", "apps/web build: computing gzip size...", "apps/web build: dist/index.html                  1.21 kB │ gzip:   0.62 kB", "apps/web build: dist/assets/index-C4kq9x.css    88.40 kB │ gzip:  14.02 kB", "apps/web build: dist/assets/index-B7d2Lm.js  1,840.11 kB │ gzip: 512.36 kB", "apps/web build: (!) Some chunks are larger than 500 kB after minification.", "apps/web build: ✓ built in 3m 38s"];
var BROKE = ["> tidewater-site@ build /home/dev/tidewater-site", "> pnpm -r build", "", "packages/ui build: Done in 3.1s", "packages/content build: Done in 1.9s", "apps/api build: Done in 21.4s", "apps/web build: vite v7.1.4 building for production...", "apps/web build: transforming...", "!apps/web build: src/routes/pricing.tsx(42,18): error TS2339: Property 'yearly' does not exist on type 'Plan'.", "!apps/web build: Found 1 error in src/routes/pricing.tsx:42", "! ELIFECYCLE  Command failed with exit code 1."];
var DEV = ["> tidewater-site@ dev /home/dev/tidewater-site", "> pnpm --filter web dev", "", "  VITE v7.1.4  ready in 812 ms", "  ➜  Local:   http://localhost:5173/", "[vite] hmr update /src/routes/pricing.tsx", "[vite] hmr update /src/routes/pricing.tsx", "[vite] page reload src/content/plans.json"];
var TEST = ["> tidewater-site@ test /home/dev/tidewater-site", "> vitest run", "", " ✓ packages/content/src/plans.test.ts (14 tests) 212ms", " ✓ packages/ui/src/button.test.tsx (9 tests) 388ms", " ✓ apps/api/src/checkout.test.ts (31 tests) 9204ms", " ❯ apps/web/e2e/signup.spec.ts 3/12", " ❯ apps/web/e2e/signup.spec.ts 4/12", " ❯ apps/web/e2e/signup.spec.ts 5/12", " ❯ apps/web/e2e/signup.spec.ts 6/12", " ❯ apps/web/e2e/signup.spec.ts 7/12"];
/* `at` is how far through its lines a command is when the page opens; `secs` how long it has run. */
var CMDS = {
  build: { cmd: "pnpm build", on: "devbox", secs: 161, lines: BUILD, at: 9 },
  dev: { cmd: "pnpm dev", on: "devbox", secs: 1124, lines: DEV, at: 5 },
  test: { cmd: "pnpm test", on: "devbox", secs: 72, lines: TEST, at: 6 }
};
var tick = 0;
function clock(s) { return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s"; }
function upTo(id) { var c = CMDS[id]; return Math.min(c.at + Math.floor(tick / 3), c.lines.length - 1); }
function lastLine(id) { return CMDS[id].lines[upTo(id)].replace(/^\w+\/\w+ build: /, ""); }
function line(l) { return l[0] === "!" ? `<span class="e">${esc(l.slice(1))}</span>` : esc(l); }
function printed(lines, n) { return lines.slice(0, n + 1).slice(-12).map(line).join("\n"); }
/* How each scene stands: which commands are going, and how the build ended if it has. */
function going() {
  var s = view.scene, ids = s === "running" ? ["build"] : s === "list" || s === "output" ? ["dev", "build"] : s === "finished" || s === "failed" ? ["dev"] : s === "moved" ? ["test"] : [];
  return ids.filter((id) => !view.stopped[id]);
}
function ended(id) {
  if (view.stopped[id]) return { how: "stopped", words: "stopped" };
  if (id !== "build") return null;
  return view.scene === "finished" ? { how: "done", words: "finished in 4m 12s" } : view.scene === "failed" ? { how: "failed", words: "failed (exit 1) after 38s" } : null;
}

function spinner(size) { return `<span class="spin mut" title="Running">${ic("ring", size || 13)}</span>`; }
function term(size) { return `<span class="term" style="--s:${size}px">${ic("term", Math.round(size * 0.56))}</span>`; }
function ticking(id) { return `<span data-clock="${id}">${clock(CMDS[id].secs + tick)}</span>`; }
function stopBtn(id) { return `<button class="btn sm" data-do="stop:${id}">Stop</button>`; }

/* ---------- the sidebar and the agent's strip, as they are in the app ---------- */
function pipLine() {
  var s = view.scene, g = going();
  if (s === "slow") return { words: "Running on devbox: pnpm test", end: spinner(13) };
  if (s === "finished") return { words: "The build finished with no errors.", end: "now" };
  if (s === "failed") return { words: "The build failed 38 seconds in.", end: "now" };
  if (g.length) return { words: "Waiting on " + (g.length > 1 ? g.length + " commands" : CMDS[g[0]].cmd), end: `<span title="Waiting on something">${ic("clock", 13)}</span>` };
  return { words: "Stopped, as you asked.", end: "now" };
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
/* What a command has printed. While it runs this is added to, and it can be stopped from here. */
function output(id, lines) {
  var c = CMDS[id], live = !lines;
  var hd = live ? `<div class="hd">${spinner(13)}<span class="grow">Running on ${c.on} for ${ticking(id)} · the last lines it printed</span>${stopBtn(id)}</div>` : "";
  return `<div class="out">${hd}<pre${live ? ` data-live="${id}"` : ""}>${printed(lines || c.lines, lines ? lines.length : upTo(id))}</pre></div>`;
}
/* A command where the agent started it. `m.moved` is one that was moved there by itself. */
function started(m) {
  var id = m.cmd, c = CMDS[id], e = ended(id), open = !e && view.open[id];
  var k = e ? `${c.on} · ${e.words}` : `${c.on} · ${m.moved ? "still going after a minute, now in the background · " : view.phone ? "" : "in the background · "}${ticking(id)}`;
  var mark = !e ? spinner(14) : e.how === "failed" ? `<span class="bad">${ic("warn", 15)}</span>` : `<span class="mut">${ic(e.how === "done" ? "okc" : "stop", 15)}</span>`;
  var chip = `<button class="bgc${open ? " open" : ""}" ${e ? 'data-do="toast:What it printed is with the word that it ended, further down"' : `data-do="open:${id}"`} title="${e ? "" : "Running in the background on " + c.on + ": " + c.cmd}">${term(24)}<span class="w"><span class="cmd">${esc(c.cmd)}</span><span class="k">${k}</span></span>${mark}${e ? "" : `<span class="car">${ic("right", 14)}</span>`}</button>`;
  return `<div class="m" id="cmd-${id}">${chip}${open ? output(id) : ""}</div>`;
}
/* Word that a command ended. */
function word(m) {
  var c = CMDS[m.cmd], open = view.open[m.end];
  if (m.end === "stopped") return `<div class="word"><div class="l"><span class="mut">${ic("stop", 15)}</span><span>You stopped <b class="cmd">${esc(c.cmd)}</b> on ${c.on}</span></div></div>`;
  var bad = m.end === "failed";
  return `<div class="word"><div class="l">${bad ? `<span class="bad">${ic("warn", 16)}</span>` : `<span class="mut">${ic("okc", 16)}</span>`}<span><b class="cmd">${esc(c.cmd)}</b> ${bad ? "failed (exit 1) after 38s" : "finished in 4m 12s"} on ${c.on}</span></div>` +
    `<button class="more${open ? " open" : ""}" data-do="fold:${m.end}">${ic("right", 13)}${bad ? "What went wrong" : "What it printed"}</button>${open ? output(m.cmd, bad ? BROKE : BUILD) : ""}</div>`;
}
function message(m) {
  if (m.day) return `<div class="dayd">${m.day}</div>`;
  if (m.cmd) return m.end ? word(m) : started(m);
  if (m.tool) return `<div class="m"><div class="tool"><span class="shine">${m.tool}…</span></div></div>`;
  if (m.agent) return `<div class="m"><div class="prose">${m.html}</div></div>`;
  return `<div class="m h me"><div class="line"><div class="bub">${esc(m.text)}</div></div></div>`;
}
function talk(scene) {
  var s = scene || view.scene, list = [{ day: "Today" }];
  var devTalk = [{ by: "me", text: "Start the site on devbox so I can look at the pricing page." }, { cmd: "dev" },
    { agent: true, html: "<p>It is up on devbox at <code>localhost:5173</code>, and I have left it running in the background.</p>" }];
  var buildTalk = [{ by: "me", text: "Make a production build on devbox and tell me if anything fails." }, { cmd: "build" },
    { agent: true, html: "<p>The build is running in the background on devbox. It usually takes about four minutes. I will tell you here when it is done, and you can ask me for something else in the meantime.</p>" }];
  if (s === "slow" || s === "moved") {
    list.push({ by: "me", text: "Run the tests on devbox before we ship." });
    if (s === "slow") return list.concat({ tool: "Running on devbox: pnpm test" });
    return list.concat({ cmd: "test", moved: true }, view.stopped.test ? { cmd: "test", end: "stopped" } : [],
      { agent: true, html: "<p>The tests were still going after a minute, so I have left them running in the background on devbox. Three files have passed so far and the sign-up tests are part way through. I will tell you how they went when they finish.</p>" });
  }
  if (s !== "running") list = list.concat(devTalk);
  list = list.concat(buildTalk);
  ["dev", "build"].forEach((id) => { if (view.stopped[id]) list.push({ cmd: id, end: "stopped" }); });
  if (s === "finished") list.push({ cmd: "build", end: "done" }, { agent: true, html: "<p>The build finished with no errors, in 4m 12s. The site is in <code>apps/web/dist</code>.</p><p>One thing to know: the main script is 1.84 MB (512 kB zipped), and the build warns about anything over 500 kB. It does not stop us shipping.</p>" });
  if (s === "failed") list.push({ cmd: "build", end: "failed" }, { agent: true, html: "<p>The build failed 38 seconds in. <code>apps/web/src/routes/pricing.tsx</code>, line 42, reads <code>plan.yearly</code>, and a plan no longer has that: it was renamed to <code>yearlyPrice</code> on Tuesday.</p><p>Shall I fix that line and build again?</p>" });
  return list;
}
function job(id) {
  var c = CMDS[id];
  return `<div class="job" data-do="open:${id}" title="Show what it is printing">${term(32)}<span class="grow"><div class="t"><span class="cmd trunc">${esc(c.cmd)}</span><span class="k">${c.on} · ${ticking(id)}</span></div><div class="s trunc" data-last="${id}">${esc(lastLine(id))}</div></span>${stopBtn(id)}</div>`;
}
function composer(words, phone) {
  var g = going(), busy = view.scene === "slow" && !phone;
  var chip = g.length && !phone ? `<button class="runchip${view.pop ? " on" : ""}" data-do="pop">${spinner(13)}${g.length} running${ic("down", 12)}</button>` : "";
  var pop = chip && view.pop ? `<div class="runlist"><div class="lb">Running in the background</div>${g.map(job).join("")}</div>` : "";
  return `${pop}${chip}<div class="comp"><textarea placeholder="${words}"></textarea><div class="r"><button class="ib" title="Attach">${ic("clip", 17)}</button><span class="grow"></span>` +
    (busy ? `<button class="send halt" data-do="toast:This stops the turn, and the command it is waiting on with it" title="Stop">${ic("stop", 17)}</button>` : `<button class="send" data-do="toast:Only the commands and the navigation work in this mock-up" title="Send">${ic("up", 17)}</button>`) + "</div></div>";
}
function middle() {
  return `<div class="acol">${ahead()}<div class="chat"><div class="scroll"><div class="msgs">${talk().map(message).join("")}</div></div><div class="foot">${composer("Message Pip")}</div></div></div>`;
}
function panel() {
  var g = going(), s = view.scene;
  var run = (r) => `<div class="run">${r.going ? spinner(16) : `<span class="mut">${ic("okc", 16)}</span>`}<div class="grow"><div class="t">${esc(r.title)}</div><div class="s">${face("me", 15)}for you · ${r.at} · ${r.steps} ${r.steps === 1 ? "step" : "steps"}</div></div></div>`;
  var did = s === "slow" ? [{ title: "Running the tests on devbox", at: "2:30 PM", steps: 1, going: true }] : s === "moved" ? [{ title: "Ran the tests on devbox", at: "2:31 PM", steps: 1 }] : [{ title: "Started a build on devbox", at: "2:14 PM", steps: 1 }];
  if (s === "finished") did.unshift({ title: "Read how the build went", at: "2:18 PM", steps: 1 });
  if (s === "failed") did.unshift({ title: "Found what broke the build", at: "2:15 PM", steps: 3 });
  if (s !== "running" && s !== "slow" && s !== "moved") did.push({ title: "Started the site on devbox", at: "1:58 PM", steps: 2 });
  did.push({ title: "Gave the status page to Sawyer", at: "1:40 PM", steps: 2 });
  var doing = s === "slow" ? "Running a command" : g.length ? "Waiting on " + (g.length > 1 ? g.length + " commands" : "a command") : "Ready";
  return `<aside class="panel"><div class="top">${orb("pip", 176, { id: "main" })}<button class="pname" data-do="toast:Pip's settings, as today">Pip<span class="mut">${ic("gear", 14)}</span></button><p>${doing}</p></div>` +
    (g.length ? `<div class="sec"><h3><span>Running in the background</span></h3>${g.map(job).join("")}</div>` : "") +
    `<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>What it did here</h3>${did.map(run).join("")}</div></aside>`;
}

/* ---------- on a phone: the chat only ---------- */
function phoneScene() {
  var top = `<div class="m-top"><button class="ib">${ic("list", 18)}</button><span class="who">${orb("pip", 24, { still: true })}<b>Pip</b><span class="mut">${ic("down", 12)}</span></span><span class="grow"></span><button class="ib">${ic("gear", 17)}</button></div>` +
    `<nav class="tabs m-tabs">${["Chat", "Library", "Automations"].map((t) => `<span class="tab${t === "Chat" ? " on" : ""}">${t}</span>`).join("")}</nav>`;
  var one = (scene, open, title, words) => {
    var keep = { scene: view.scene, open: view.open };
    view.scene = scene; view.open = open; view.phone = true;
    var inner = top + `<div class="scroll"><div class="msgs">${talk().slice(scene === "running" ? 1 : 5).map(message).join("")}</div></div><div class="foot">${composer("Message Pip", true)}</div>`;
    view.scene = keep.scene; view.open = keep.open; view.phone = false;
    return `<figure class="phone-w"><div class="phone">${inner}</div><figcaption><b>${title}</b>${words}</figcaption></figure>`;
  };
  return '<div class="phones">' + one("running", {}, "Running", "The command where Pip started it, with its clock going.") +
    one("running", { build: true }, "Opened", "Touch it for the end of what it has printed. Stop is here.") +
    one("finished", {}, "Finished", "Word that it ended, then Pip's answer.") +
    one("failed", { failed: true }, "Failed", "The same, opened to show what went wrong.") + "</div>";
}

/* ---------- drawing and what the buttons do ---------- */
function render() {
  var s = view.scene;
  app.innerHTML = s === "phone" ? phoneScene() : (view.list ? side() : "") + `<div class="main">${middle()}${view.panel ? panel() : ""}</div>`;
  strip.innerHTML = "<b>Mock-up</b>" + SCENES.map((x) => x ? `<button class="${x[0] === s ? "on" : ""}" data-do="scene:${x[0]}">${x[1]}</button>` : "<i></i>").join("") +
    '<span class="sp"></span><button data-do="theme">Light / dark</button>' + `<div class="note"><b>${NOTES[s][0]}</b>${NOTES[s][1]}</div>`;
  if (location.hash !== "#" + s) history.replaceState(null, "", "#" + s);
  mountOrbs();
  act(s === "slow" ? "working" : "idle");
  document.querySelectorAll(".out pre, .scroll").forEach((p) => { p.scrollTop = p.scrollHeight; });
}
/* A scene from the strip, or from the address: set up so that it shows what it is named for. */
function show(scene) {
  view.scene = scene; view.list = true; view.stopped = {};
  view.panel = scene !== "list"; view.pop = scene === "list";
  view.open = scene === "output" ? { build: true } : scene === "failed" ? { failed: true } : {};
  render();
}
function toast(words) {
  var t = document.createElement("div"); t.className = "toast"; t.textContent = words; app.appendChild(t);
  setTimeout(function () { t.remove(); }, 2600);
}
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-do]");
  if (!el) { if (view.pop) { view.pop = false; render(); } return; }
  var d = el.dataset.do.split(":"), a = d[0], v = d.slice(1).join(":");
  e.stopPropagation();
  if (a === "toast") return toast(v);
  if (a === "scene") return show(v);
  if (a === "stop") { view.stopped[v] = true; view.open[v] = false; if (!going().length) view.pop = false; render(); return toast("Stopped. Pip is told that you stopped it."); }
  if (a === "open") { view.open[v] = el.classList.contains("job") ? true : !view.open[v]; view.pop = false; }
  else if (a === "fold") view.open[v] = !view.open[v];
  else if (a === "pop") view.pop = !view.pop;
  else if (a === "list") view.list = !view.list;
  else if (a === "panel") view.panel = !view.panel;
  else if (a === "theme") document.documentElement.classList.toggle("dark");
  render();
  if (a === "open" && view.open[v]) { var at = document.getElementById("cmd-" + v); if (at) at.scrollIntoView({ block: "nearest" }); }
});
window.addEventListener("hashchange", function () { var s = location.hash.slice(1); if (NOTES[s] && s !== view.scene) show(s); });

/* The clocks go, and a command that is running prints a line now and then. Nothing is drawn again
   for it: the words are changed where they are. */
setInterval(function () {
  tick++;
  document.querySelectorAll("[data-clock]").forEach((el) => { el.textContent = clock(CMDS[el.dataset.clock].secs + tick); });
  if (tick % 3) return;
  document.querySelectorAll("[data-last]").forEach((el) => { el.textContent = lastLine(el.dataset.last); });
  document.querySelectorAll("pre[data-live]").forEach((p) => { var id = p.dataset.live; p.innerHTML = printed(CMDS[id].lines, upTo(id)); p.scrollTop = p.scrollHeight; });
}, 1000);

resetChat();
var first = location.hash.slice(1);
show(NOTES[first] ? first : "running");
})();
