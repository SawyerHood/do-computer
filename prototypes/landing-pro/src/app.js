/* Landing page mock-up, the professional look: light, plain type, the product shown in small
   pictures, and the creature in three places only. Everything here is pretend except the creature
   and what it wears, which are the app's own (packages/mascot), and the pictures of the app,
   which were taken from it. Nothing signs anyone in. */
(function () {
"use strict";

var T3 = window.THREE;
var core = T3 ? AgentOrbCore(T3) : null;
var drawn = !!(core && core.Stage.get("px"));
var wardrobe = drawn ? AgentOrbWardrobe(T3, core) : null;
var PAL = core ? core.PALETTE : {};
var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var app = document.getElementById("app"), strip = document.getElementById("strip");
var LOGO = document.getElementById("logo").innerHTML;
var REPO = "github.com/SawyerHood/durable-computer";
var STATES = [["open", "Open to everyone"], ["soon", "Not open yet"]];
var open = true;

function q(sel, root) { return (root || app).querySelector(sel); }
function all(sel, root) { return Array.prototype.slice.call((root || app).querySelectorAll(sel)); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

/* Whatever is waiting when the page is drawn again is dropped. */
var gen = 0, orbs = [];
function later(fn, ms) { var g = gen; return setTimeout(function () { if (g === gen) fn(); }, ms); }
/* A picture that plays through its steps, over and over. */
function round(count, ms, show) {
  var at = 0;
  show(0);
  (function next() { later(function () { at = (at + 1) % count; show(at); next(); }, ms); })();
}
function guy(canvas, seed, color, wear, small) {
  if (!drawn) return null;
  var orb = core.createOrb(canvas, { seed: seed, color: PAL[color], dark: false, reduced: calm, notice: !small, slow: !!small });
  if (wear) wardrobe.dress(orb, wear);
  orbs.push(orb);
  canvas.addEventListener("click", function () { orb.cheer(); });
  return orb;
}

/* ---------- small pictures, as plain marks ---------- */
var ICON = {
  arrow: '<svg viewBox="0 0 16 16"><path d="M5 11 11 5M6 5h5v5"/></svg>',
  web: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 9h18"/></svg>',
  desktop: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12.5" rx="2.5"/><path d="M9 20h6M12 16.5V20"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="3"/><path d="M11 18.5h2"/></svg>',
  slack: '<svg viewBox="0 0 24 24"><path d="M9.5 3.5v17M14.5 3.5v17M3.5 9.5h17M3.5 14.5h17"/></svg>',
  note: '<svg viewBox="0 0 16 16"><path d="M9.5 3 13 6.5 6.5 13H3v-3.5Z"/></svg>',
  github: '<svg viewBox="0 0 24 24" class="fill"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.4-1.1-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.6.3-1.1.6-1.3-2.2-.3-4.600-1.100-4.600-5a3.900 3.900 0 0 1 1-2.700c-.1-.300-.4-1.300.1-2.600 0 0 .8-.3 2.700 1a9.500 9.500 0 0 1 5 0c1.900-1.300 2.700-1 2.700-1 .5 1.300.2 2.300.1 2.600a3.900 3.900 0 0 1 1 2.700c0 3.900-2.400 4.700-4.600 5 .4.300.7.900.7 1.800V21c0 .3.200.6.700.5A10 10 0 0 0 12 2Z"/></svg>'
};

/* ---------- what the page says ---------- */
var VIEWS = [["chat", "Chat"], ["library", "Library"], ["automations", "Automations"]];

/* Who it can be: the eight of the character select. Each is a job the one agent does, with what
   it is asked and what it is then seen doing: [state, kind of work, what its line says]. */
var WHO = [
  { job: "Planner", name: "Pip", seed: "Sorrel", color: "tide", about: "Trips, weeks, and what is for dinner.", ask: "Three days in Lisbon in March.",
    steps: [["working", "search", "Searching flights to Lisbon"], ["working", "file", "Writing trip-plan.md"], ["done", "", "Done. It is in your library."]] },
  { job: "Builder", name: "Biscuit", seed: "Biscuit", color: "honey", wear: { hat: "chef" }, about: "Writes the code, runs the tests, fixes what broke.", ask: "The checkout test is failing again.",
    steps: [["working", "file", "Writing src/checkout.ts"], ["working", "command", "Running pnpm test"], ["done", "", "Done. 14 passed."]] },
  { job: "Researcher", name: "Scout", seed: "Tarn", color: "moss", wear: { glasses: "goggles" }, about: "Reads the internet so you do not have to.", ask: "Which e-ink tablet should I get?",
    steps: [["working", "search", "Searching best e-ink tablets"], ["thinking", "", "Comparing nine of them"], ["working", "file", "Writing tablets.md"]] },
  { job: "Night shift", name: "Vesper", seed: "Vesper", color: "plum", wear: { hat: "nightcap" }, about: "Works to a schedule while you sleep.", ask: "Every weekday at 8, brief me on the news.",
    steps: [["asleep", "", "07:59, asleep"], ["working", "search", "08:00, reading the news"], ["done", "", "08:02, the brief is in your inbox"]] },
  { job: "Teammate", name: "Juniper", seed: "Juniper", color: "moss", wear: { hat: "headphones" }, about: "Lives in Slack. Answers when it is asked for.", ask: "@Juniper is the pricing page live?",
    steps: [["listening", "", "#launch, Maya is typing"], ["speaking", "", "#launch, replying"], ["idle", "", "It is. Live since 9:12."]] },
  { job: "Note keeper", name: "Mochi", seed: "Mochi", color: "rose", wear: { hat: "bunny", face: "blush" }, about: "Remembers what you said, and where you put it.", ask: "I am vegetarian, and I like a window seat.",
    steps: [["working", "memory", "Noting: vegetarian"], ["working", "memory", "Noting: a window seat"], ["idle", "", "Remembers"]] },
  { job: "House guest", name: "Sable", seed: "Sable", color: "clay", wear: { hat: "cowboy", neck: "bandana" }, about: "Works on your own computer, when you let it in.", ask: "Update everything on my Mac.",
    steps: [["waiting", "", "Asking before brew upgrade"], ["working", "command", "Running brew upgrade"], ["done", "", "Done"]] },
  { job: "Yours", name: "Yours", seed: "Olive", color: "tide", egg: true, about: "It comes out of an egg, and is nobody else's.",
    steps: [["egg", "", "Not hatched yet"]] }
];
/* How long the one at the top does each thing, and how long each is there before the next. */
var STEP_MS = 2600, TURN_MS = 7800;

var PLACES = [
  ["web", "Web", "Open it in any browser. Nothing to install."],
  ["desktop", "Desktop", "An app for Mac, Windows and Linux, which can also let it work on that computer."],
  ["phone", "Phone", "Add it to your home screen. It buzzes when the job is done."],
  ["slack", "Slack", "Give it a seat in your workspace. It answers when someone asks for it by name."]
];

var FAQ = [
  ["How is this different from a chatbot?", "A chatbot answers. Do Computer has a computer of its own: it runs commands, writes files and uses a browser, so what comes back is the finished thing. It keeps working after you close the tab, and tells you when it is done."],
  ["Where does it do the work?", "On its own machine in the cloud. If you install the desktop app and let it in, it can also work on your Mac or PC."],
  ["Which models does it use?", "Any model through OpenRouter, or a provider you are signed in to."],
  ["Where is my data?", "Each agent keeps its data in one SQLite file. If you host it yourself, that file is wherever you put it."],
  ["Can I run it myself?", "Yes. It is open source under the MIT license. Clone it, add a model key and start it, on a machine of your own or on your own Cloudflare account."],
  ["Can a team share one?", "Yes. Share an agent with your team or keep one to yourself. Agents in the same workspace can hand work to each other."]
];

/* ---------- the parts ---------- */
function cta(second) {
  if (!open) return '<div class="cta"><span class="btn soon"><i></i>Coming soon</span></div><p class="have">Already have access? <a href="#">Sign in</a></p>';
  return '<div class="cta"><a class="btn dark" href="#">Get started</a>' + (second || "") + "</div>";
}
function nav() {
  return '<header class="nav"><a class="brand" href="#">' + LOGO + "Do Computer</a>" +
    '<nav><a href="#does">What it does</a><a href="#places">Where it is</a><a href="#open-source">Open source</a><a href="#faq">FAQ</a></nav>' +
    '<span class="grow"></span><a class="lnk" href="#">Sign in</a>' +
    (open ? '<a class="btn dark small" href="#">Get started</a>' : '<span class="btn soon small"><i></i>Coming soon</span>') + "</header>";
}
function hero() {
  return '<section class="hero"><div class="top"><div class="pitch">' +
    '<a class="note" href="#open-source"><b>Open source</b> under the MIT license<span>' + ICON.arrow + "</span></a>" +
    "<h1>Your open source personal assistant.</h1>" +
    '<p class="sub">An assistant with a computer of its own. Ask in plain words, and it comes back with the work done.</p>' +
    cta('<a class="btn" href="#">Download for Mac</a>') + "</div>" +
    '<div class="pick"><div class="stage"><p class="bub you ask"></p><canvas class="hero-guy" data-guy="hero"></canvas><p class="doing"><i></i><span></span></p></div>' +
    '<p class="about"></p><div class="roster" role="group" aria-label="Who it can be">' +
    WHO.map(function (w, i) { return '<button data-who="' + i + '" aria-label="' + esc(w.egg ? "Yours" : w.name + ", the " + w.job.toLowerCase()) + '"><canvas data-tile="' + i + '"></canvas><span>' + (w.egg ? "Yours" : w.name) + "</span></button>"; }).join("") +
    "</div></div></div>" +
    '<div class="win"><div class="bar"><i></i><i></i><i></i><div class="tabs">' +
    VIEWS.map(function (v, i) { return '<button data-view="' + i + '">' + v[1] + "</button>"; }).join("") +
    '</div></div><img alt="" width="2040" height="1350"></div></section>';
}
/* One thing it does, said beside a picture of it on a panel of its own color. */
function feature(key, tone, title, text, picture, flip) {
  return '<article class="feature' + (flip ? " flip" : "") + '"><div class="panel ' + tone + '" data-pic="' + key + '">' + picture + "</div>" +
    "<div><h3>" + title + "</h3><p>" + text + "</p></div></article>";
}
var PIC = {
  computer:
    '<div class="ui computer"><p class="ui-top"><b>Computer</b><span class="tag"><i></i><em>Pip is working</em></span></p><p class="says"></p>' +
    '<div class="browser"><p class="browser-bar"><i></i><i></i><i></i><span>search</span></p><div class="browser-page"><p class="field"></p>' +
    ["The nine best e-ink tablets", "Paper tablets, compared", "Which one to write on"].map(function (t) { return '<p class="result"><b>' + t + "</b><i></i><i></i></p>"; }).join("") +
    '</div><span class="pointer"><svg viewBox="0 0 16 16"><path d="M2 1.5 13.5 7 8.6 8.6 7 13.500Z"/></svg><b>Pip</b></span></div>' +
    '<pre class="shell"><span><i>$</i> python compare.py reviews/</span>\n<span>  wrote library/tablets.md</span></pre></div>',
  away:
    '<div class="lock"><p class="lock-date">Friday, March 6</p><p class="lock-time"></p><div class="notes">' +
    '<p class="notif new">' + LOGO + "<span><b>Pip <em>now</em></b>The deploy is live. All 14 tests pass.</span></p>" +
    '<p class="notif">' + LOGO + "<span><b>Pip <em>12m ago</em></b>On it. I will tell you when it is out.</span></p></div></div>",
  plan:
    '<div class="ui plan"><p class="ui-label">Running</p><p class="row first"><i></i><span><b>Morning brief</b><em></em></span><time></time></p>' +
    '<p class="ui-label">Scheduled</p><p class="row"><i></i><span><b>Week plan</b><em>Mondays at 09:00</em></span><time>In 6 days</time></p>' +
    '<p class="row"><i></i><span><b>Invoices</b><em>The 1st at 10:00</em></span><time>In 3 weeks</time></p></div>',
  memory:
    '<div class="chat"><p class="bub you">Dana signs off on copy. Invoices go out on the 1st.</p>' +
    '<p class="saved" data-step="1">' + ICON.note + "Updated memory</p>" +
    '<p class="when" data-step="2">Three weeks later</p>' +
    '<p class="bub" data-step="2">Copy is with Dana for sign-off, and the invoices are queued for the 1st.</p></div>',
  team:
    '<div class="relay"><p class="team">' +
    [["Pip", "tide"], ["Scout", "moss"], ["Ledger", "honey"]].map(function (m) { return '<span><i style="background:' + (PAL[m[1]] || "#888") + '"></i>' + m[0] + "</span>"; }).join("") +
    '</p><p class="bub you">Is the pricing page right for March?</p><p class="handoff"><i></i><i></i><i></i><span></span></p></div>'
};
function does() {
  return '<section class="band" id="does"><div class="head"><h2>It does the work,<br>not just the talking.</h2>' +
    "<p>Ask in plain words. It works the job out on a real computer, and tells you when it is done.</p></div>" +
    feature("computer", "teal", "A computer of its own", "It has a machine in the cloud to do the job on. It runs commands, writes files and clicks through a real browser, and can work on your Mac or PC when you let it in.", PIC.computer) +
    feature("away", "plum", "Still at it when you leave", "Close the laptop. It keeps going, and your phone buzzes when the job is done.", PIC.away, true) +
    feature("plan", "honey", "Up before you are", "Give it a schedule. What it does on its own is a list you can read and pause.", PIC.plan) +
    '<div class="pair">' +
    '<article class="tile"><h3>It remembers</h3><p>It keeps notes on you and the work, so Tuesday starts where Monday ended.</p><div class="tile-pic" data-pic="memory">' + PIC.memory + "</div></article>" +
    '<article class="tile"><h3>One for the whole team</h3><p>Share one with your team or keep one to yourself. They hand work to each other while you get on with yours.</p><div class="tile-pic" data-pic="team">' + PIC.team + "</div></article>" +
    "</div></section>";
}
function places() {
  return '<section class="band" id="places"><div class="head"><h2>Right where you need it</h2><p>The same assistant, wherever you happen to be.</p></div><div class="places">' +
    PLACES.map(function (p) { return '<article><span class="mark">' + ICON[p[0]] + "</span><h3>" + p[1] + "</h3><p>" + p[2] + "</p></article>"; }).join("") +
    "</div></section>";
}
function oss() {
  return '<section class="band oss" id="open-source"><div><h2>Yours, all the way down</h2>' +
    "<p>Do Computer is open source under the MIT license. Read every line, change what you like, and run it yourself, with your own model keys.</p>" +
    '<div class="cta"><a class="btn" href="#">' + ICON.github + "Star on GitHub</a></div></div>" +
    '<div class="term"><p class="term-bar"><i></i><i></i><i></i><span>~/durable-computer</span></p><pre><span>$</span> git clone https://' + REPO +
    "\n<span>$</span> pnpm install && pnpm build\n<span>$</span> OPENROUTER_API_KEY=sk-or-… pnpm start\n\n<em>  Listening on http://127.0.0.1:3000</em></pre></div>" +
    '<div class="plain">' +
    "<article><h3>Your data stays yours</h3><p>One SQLite file for each agent, wherever you put it.</p></article>" +
    "<article><h3>Any model</h3><p>Through OpenRouter, or a provider you are signed in to.</p></article>" +
    "<article><h3>Or skip all that</h3><p>We run it for you, right here.</p></article>" +
    "</div></section>";
}
function hats() {
  return '<section class="band"><div class="hats"><canvas data-guy="hats"></canvas><div><h3>Also, it wears hats</h3>' +
    "<p>Work with it and it earns treats. Enough treats and a box turns up, with one of 200 things to wear inside.</p>" +
    '<div class="cta"><button class="btn" data-hat>Try one on</button></div></div></div></section>';
}
function faq() {
  return '<section class="band faq" id="faq"><h2>Questions</h2><div>' +
    FAQ.map(function (f) { return "<details><summary>" + esc(f[0]) + "</summary><p>" + esc(f[1]) + "</p></details>"; }).join("") +
    "</div></section>";
}
function end() {
  return '<section class="band"><div class="end">' + LOGO + "<h2>" + (open ? "Get yours" : "Nearly here") + "</h2>" +
    "<p>" + (open ? "It comes out of an egg, asks your name, and gets to work." : "Do Computer is not open to everyone yet. It will be soon.") + "</p>" + cta() + "</div></section>" +
    '<footer><a class="brand" href="#">' + LOGO + "Do Computer</a><span>Open source, MIT</span><span class=\"grow\"></span><a href=\"#\">GitHub</a><a href=\"#\">Download</a><a href=\"#\">Sign in</a></footer>";
}

/* ---------- what moves ---------- */
function shots() {
  var img = q(".win img"), own = false;
  function to(i) {
    img.src = SHOTS[VIEWS[i][0]];
    all("[data-view]").forEach(function (b, n) { b.classList.toggle("on", n === i); });
  }
  all("[data-view]").forEach(function (b, n) { b.addEventListener("click", function () { own = true; to(n); }); });
  to(0);
  round(VIEWS.length, 6500, function (i) { if (!own) to(i); });
}
function pictures() {
  var ERRAND = [["field", "Searching for e-ink tablets"], ["first", "Reading the reviews"], ["third", "Comparing nine of them"], ["rest", "Writing tablets.md"], ["rest", "Done. It is in your library."]];
  var c = q('[data-pic="computer"]');
  round(ERRAND.length, 2600, function (i) {
    q(".says", c).textContent = ERRAND[i][1];
    q(".field", c).textContent = "best e-ink tablets";
    q(".pointer", c).dataset.at = ERRAND[i][0];
    q(".tag", c).classList.toggle("quiet", i === 4);
    q(".tag em", c).textContent = i === 4 ? "Done" : "Pip is working";
    all(".result", c).forEach(function (r, n) { r.classList.toggle("lit", (n === 0 && i === 1) || (n === 2 && i === 2)); });
    all(".shell span", c).forEach(function (s, n) { s.classList.toggle("shown", i >= n + 2); });
  });
  var a = q('[data-pic="away"]');
  round(4, 2800, function (i) {
    q(".lock-time", a).textContent = ["6:12", "6:19", "6:24", "6:24"][i];
    q(".notif.new", a).classList.toggle("shown", i >= 2);
  });
  var p = q('[data-pic="plan"]'), MORNING = [["07:59", "Weekdays at 08:00", "In 1 min"], ["08:00", "Reading the news", "08:00"], ["08:01", "Writing brief.md", "08:01"], ["08:02", "In your inbox", "Done"]];
  round(MORNING.length, 2600, function (i) {
    q(".first em", p).textContent = MORNING[i][1];
    q(".first time", p).textContent = MORNING[i][2];
    q(".first", p).dataset.state = i === 0 ? "waiting" : i === 3 ? "done" : "running";
  });
  var m = q('[data-pic="memory"]');
  round(4, 2600, function (i) { all("[data-step]", m).forEach(function (el) { el.classList.toggle("shown", i >= +el.dataset.step); }); });
  var t = q('[data-pic="team"]'), RELAY = [[0, "Pip is asking Scout"], [1, "Scout is reading the pricing page"], [1, "Scout is looping in Ledger"], [2, "Ledger is adding up March"]];
  round(RELAY.length, 2600, function (i) {
    all(".team span", t).forEach(function (s, n) { s.classList.toggle("lit", n === RELAY[i][0]); });
    q(".handoff span", t).textContent = RELAY[i][1];
  });
}
/* Something that is said again comes up again. */
function again(el) { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; }
function creatures() {
  /* The one at the top is each of the eight in turn, until somebody chooses. */
  var hero = guy(q('[data-guy="hero"]'), WHO[0].seed, WHO[0].color);
  var ask = q(".ask"), doing = q(".doing"), about = q(".hero .about"), pick = q(".pick");
  /* The eight to choose from, small and at rest. */
  all("[data-tile]").forEach(function (cv, i) {
    var w = WHO[i], tile = guy(cv, w.seed, w.color, w.wear, true);
    if (tile && w.egg) tile.setState("egg");
  });
  var own = false, at = -1, turn = 0;
  function step(w, n, mine) {
    if (mine !== turn) return;
    var s = w.steps[n % w.steps.length];
    if (hero) hero.setState(s[0], s[1] || undefined);
    doing.className = "doing" + (s[0] === "idle" || s[0] === "asleep" || s[0] === "egg" ? " quiet" : "");
    q("span", doing).textContent = s[2];
    again(doing);
    if (w.steps.length > 1) later(function () { step(w, n + 1, mine); }, STEP_MS);
  }
  function to(i) {
    var w = WHO[i];
    at = i;
    turn++;
    all("[data-who]").forEach(function (b, n) { b.classList.toggle("on", n === i); b.setAttribute("aria-pressed", n === i); });
    about.innerHTML = "<b>" + (w.egg ? "Yours." : esc(w.name) + ", the " + esc(w.job.toLowerCase()) + ".") + "</b> " + esc(w.about);
    pick.style.setProperty("--tint", PAL[w.color] || "#888");
    ask.textContent = w.ask || "";
    ask.hidden = !w.ask;
    again(ask);
    if (hero) { hero.setSeed(w.seed); hero.setColor(PAL[w.color]); wardrobe.dress(hero, w.wear || {}); if (!w.egg) hero.cheer(); }
    step(w, 0, turn);
  }
  all("[data-who]").forEach(function (b, n) {
    b.addEventListener("click", function () { own = true; to(n); });
    /* As on the character select: a mouse over one is enough to choose it. */
    b.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse" && n !== at) { own = true; to(n); } });
  });
  to(0);
  (function next() { later(function () { if (own) return; to((at + 1) % WHO.length); next(); }, TURN_MS); })();
  var HATS = [{ hat: "party" }, { hat: "wizard" }, { hat: "crown" }, { glasses: "pixel" }, { hat: "cowboy", neck: "bandana" }, { hat: "chef" }];
  var worn = 0, dressed = guy(q('[data-guy="hats"]'), "Mochi", "honey", HATS[0]);
  q("[data-hat]").addEventListener("click", function () {
    worn = (worn + 1) % HATS.length;
    if (dressed) { wardrobe.dress(dressed, HATS[worn]); dressed.cheer(); }
  });
}

function draw() {
  gen++;
  orbs.forEach(function (o) { if (o.dispose) o.dispose(); });
  orbs = [];
  app.innerHTML = nav() + hero() + does() + places() + oss() + hats() + faq() + end();
  strip.innerHTML = "<b>Mock-up: the professional look.</b>" + STATES.map(function (s) {
    return '<a href="#' + s[0] + '"' + ((s[0] === "open") === open ? ' class="on"' : "") + ">" + s[1] + "</a>";
  }).join("");
  shots(); pictures(); creatures();
}
function route() {
  var hash = location.hash.slice(1);
  if (hash !== "open" && hash !== "soon") return;
  open = hash === "open";
  draw();
  scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
open = location.hash !== "#soon";
draw();
})();
