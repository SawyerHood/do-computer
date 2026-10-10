/* Landing page mock-up: four ways it could look. Everything here is pretend except the creatures,
   what they wear and the sky, which are the app's own (packages/mascot), and the pictures of the
   app, which were taken from it. Nothing signs anyone in. */
(function () {
"use strict";

var T3 = window.THREE;
var core = T3 ? AgentOrbCore(T3) : null;
var drawn = !!(core && core.Stage.get("px"));
var wardrobe = drawn ? AgentOrbWardrobe(T3, core) : null;
var skies = drawn ? AgentOrbSky(T3) : null;
var PAL = core ? core.PALETTE : {};
var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var app = document.getElementById("app"), strip = document.getElementById("strip");
var LOGO = document.getElementById("logo").innerHTML;
var REPO = "github.com/SawyerHood/durable-computer";

var LOOKS = [["c", "Character select"], ["a", "Earlier: sky island"], ["b", "Earlier: the app first"], ["d", "Earlier: daylight"]];
var LIGHT = { b: true, d: true };
var STATES = [["open", "Open to everyone"], ["soon", "Not open yet"], ["login", "Sign-in while it is shut"]];
var ABOUT = {
  a: "The first run's sky at dusk. “Hatch yours” goes on in the same sky.",
  b: "Light, as the app is by day. The headline is the pitch, and the app itself is the picture.",
  c: "The one chosen. A console's character select: eight to choose from, each a job it can do, the last an egg.",
  d: "A, in daylight and centred, with the app's window under the island and a light page."
};
var NOTES = {
  open: ["DC_SIGNUP=open.", "The buttons lead to /welcome and /login."],
  soon: ["DC_SIGNUP=invite, the default.", "Nowhere to sign up: “Coming soon”, and one small link for whoever has an account."],
  login: ["/login while sign-up is shut.", "Today's page without “Create an account”. An invitation's link still works."]
};
/* The pixel faces the character select can be set in, to compare. Not part of the design. */
var FONTS = [["jersey", "Jersey 25"], ["dot", "DotGothic16"], ["vt", "VT323"], ["pixelify", "Before: Pixelify"]];
var view = { look: "c", scene: "open", mode: "open", font: "jersey" };

function q(sel, root) { return (root || app).querySelector(sel); }
function all(sel, root) { return Array.prototype.slice.call((root || app).querySelectorAll(sel)); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
var DICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8.500 8.500h.01M15.500 8.500h.01M12 12h.01M8.500 15.500h.01M15.500 15.500h.01" stroke-width="2.6"/></svg>';
var GH = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

/* Whatever was asked for later is dropped when another look is shown. */
var gen = 0;
function later(fn, ms) { var g = gen; return setTimeout(function () { if (g === gen) fn(); }, ms); }

/* ---------- who is on the page ---------- */
var HERO = { name: "Pip", seed: "Sorrel", color: "#3f7f9c" };
var CROWD = [
  ["Biscuit", "honey", 104, { hat: "chef" }],
  ["Wren", "plum", 122, { hat: "wizard" }],
  ["Tarn", "tide", 96, { glasses: "shades" }],
  ["Mochi", "rose", 132, { hat: "bunny", face: "blush" }],
  ["Juniper", "moss", 110, { hat: "propeller" }],
  ["Sable", "clay", 126, { hat: "cowboy", neck: "bandana" }],
  ["Nori", "tide", 100, { hat: "headphones" }],
  ["Pebble", "slate", 118, { hat: "tophat", glasses: "monocle" }],
  ["Quill", "plum", 104, { neck: "cape", glasses: "hero" }]
];
/* The roster of the character select: who, and the job each stands for. Eight, the last an egg:
   two full rows of four, on a phone as on a desk. */
var ROSTER = [
  { name: "Pip", seed: "Sorrel", color: "tide", job: "The planner", about: "Trips, weeks, and what is for dinner.", steps: [["working", "search", "Searching <code>flights to Lisbon</code>"], ["working", "file", "Writing <code>trip-plan.md</code>"], ["done", "", "Done. It is in your library."]] },
  { name: "Biscuit", seed: "Biscuit", color: "honey", wear: { hat: "chef" }, job: "The builder", about: "Writes the code, runs the tests, fixes what broke.", steps: [["working", "file", "Writing <code>src/checkout.ts</code>"], ["working", "command", "Running <code>pnpm test</code>"], ["done", "", "Done · 14 passed"]] },
  { name: "Scout", seed: "Tarn", color: "moss", wear: { glasses: "goggles" }, job: "The researcher", about: "Reads the internet so you do not have to.", steps: [["working", "search", "Searching <code>best e-ink tablets</code>"], ["thinking", "", "Comparing nine of them"], ["working", "file", "Writing <code>tablets.md</code>"]] },
  { name: "Vesper", seed: "Vesper", color: "plum", wear: { hat: "nightcap" }, job: "The night shift", about: "Works to a schedule while you sleep.", steps: [["asleep", "", "07:59 · asleep"], ["working", "search", "08:00 · reading the news"], ["done", "", "08:02 · brief is in your inbox"]] },
  { name: "Juniper", seed: "Juniper", color: "moss", wear: { hat: "headphones" }, job: "The teammate", about: "Lives in Slack. Answers when it is asked for.", steps: [["listening", "", "#launch · Maya is typing"], ["speaking", "", "#launch · replying"], ["idle", "", "#launch"]] },
  { name: "Mochi", seed: "Mochi", color: "rose", wear: { hat: "bunny", face: "blush" }, job: "The note keeper", about: "Remembers what you said, and where you put it.", steps: [["working", "memory", "Noting <code>vegetarian</code>"], ["working", "memory", "Noting <code>likes a window seat</code>"], ["idle", "", "Remembers"]] },
  { name: "Sable", seed: "Sable", color: "clay", wear: { hat: "cowboy", neck: "bandana" }, job: "The house guest", about: "Works on your own computer, when you let it in.", steps: [["waiting", "", "Asking before <code>brew upgrade</code>"], ["working", "command", "Running <code>brew upgrade</code>"], ["done", "", "Done"]] },
  { name: "Yours", egg: true, seed: "Olive", color: "tide", job: "Not hatched yet", about: "It comes out of an egg, and is nobody else's.", steps: [["egg", "", "Waiting for you"]] }
];
var NAMES = ["Pip", "Mochi", "Juniper", "Biscuit", "Tarn", "Wren", "Sorrel", "Nori", "Pebble", "Dumpling", "Fig", "Olive", "Momo", "Tofu", "Bean", "Noodle"];
var RAR = [["Common", "#9aa3ad"], ["Uncommon", "#4fbf67"], ["Rare", "#4a9bff"], ["Epic", "#b266ff"], ["Legendary", "#ffb92e"]];
var BOXES = [
  ["wizard", "hat", "Wizard hat", 2], ["pixel", "glasses", "Pixel shades", 2], ["cape", "neck", "Cape", 2], ["crown", "hat", "Crown", 3],
  ["party", "hat", "Party hat", 0], ["bubblegum", "face", "Bubblegum", 2], ["wings", "neck", "Little wings", 3], ["galaxy", "hat", "Pocket galaxy", 4],
  ["stars", "glasses", "Star shades", 2], ["duck", "hat", "Rubber duck", 2], ["chain", "neck", "Gold chain", 2], ["ufo", "hat", "Visitor", 4]
];
/* The pictures of the app, and what each is a picture of. */
var VIEWS = [
  ["chat", "Chat", "A real conversation: a trip planned, a document written, a reminder set for Mondays."],
  ["library", "Library", "What it writes is yours: documents and pages you can read, edit and share."],
  ["automations", "Automations", "Everything it does on a schedule, in one list you can pause."]
];
/* Who sits on the window: how far along its top, how large, and which of the crowd. */
var PERCH = [[5, 92, 0], [19, 112, 3], [37, 88, 4], [69, 104, 5], [84, 96, 7]];
var LINKS = [["app-shots", "The app"], ["does", "What it does"], ["open-source", "Open source"], ["hats", "Hats"]];

/* ---------- the creatures ---------- */
var orbs = [], undo = [];
function guy(canvas, seed, color, more) {
  var options = { seed: seed, color: color, dark: true, reduced: calm };
  for (var k in more || {}) options[k] = more[k];
  var orb = core.createOrb(canvas, options);
  orbs.push(orb);
  return orb;
}
/* A hand moved across one strokes it, and a press makes it hop. */
function touchable(el, orb) {
  el.addEventListener("pointermove", function (e) {
    var r = el.getBoundingClientRect();
    orb.pet(clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1), 0.07);
  });
  el.addEventListener("click", function () { orb.cheer(); });
}
function say(line, state, text) {
  line.className = "st" + (state === "idle" || state === "asleep" || state === "egg" ? " idle" : "");
  line.innerHTML = "<i></i><span>" + text + "</span>";
}
/* What one is shown doing, over and over: [state, kind of work, what its line says, for how long]. */
function play(orb, line, steps) {
  var i = 0;
  (function next() {
    var s = steps[i++ % steps.length];
    orb.setState(s[0], s[1] || undefined);
    if (line) say(line, s[0], s[2]);
    later(next, s[3]);
  })();
}

/* ---------- parts every look is made of ---------- */
function have() { return '<p class="have">Already have access? <a class="lnk" href="#login">Sign in</a></p>'; }
function nav() {
  return '<header class="nav">' +
    '<a class="brand" href="#top">' + LOGO + "Do Computer</a>" +
    '<nav class="links">' + LINKS.map(function (l) { return '<a href="#' + l[0] + '">' + l[1] + "</a>"; }).join("") + "</nav>" +
    '<span class="sp"></span>' +
    '<div class="acts"><a class="gh" data-say="github">' + GH + '<span>GitHub</span></a><a class="open-only" href="#login">Sign in</a><a class="btn primary sm open-only" data-say="hatch">Get started</a></div>' +
  "</header>";
}
function buttons(second) {
  return '<div class="cta open-only">' +
      '<a class="btn primary lg" data-say="hatch">Hatch yours' + ARROW + "</a>" +
      (second === "github" ? '<a class="btn ghost lg" data-say="github">' + GH + "Star on GitHub</a>" : '<a class="btn ghost lg" href="#login">Sign in</a>') +
    "</div>" +
    '<div class="cta closed soon-only">' +
      '<div class="soon-card"><canvas data-egg></canvas><div><b>Coming soon</b><span>Not open to everyone just yet.</span></div></div>' +
      have() +
    "</div>";
}
function crowdRow() {
  return '<div class="crowd">' + CROWD.map(function (c, i) {
    return '<figure style="--s:' + c[2] + 'px"><canvas data-crowd="' + i + '"></canvas><figcaption>' + c[0] + "</figcaption></figure>";
  }).join("") + '</div><div class="ledge"></div>';
}
/* The app in a window, with a phone beside it, and some of them sitting on top. */
function windowed(theme, perched) {
  return '<div class="shotwrap" data-theme="' + theme + '">' +
    (perched ? '<div class="perch">' + PERCH.map(function (p, i) {
      return '<canvas data-perch="' + i + '" style="--s:' + p[1] + "px;left:" + p[0] + '%"></canvas>';
    }).join("") + "</div>" : "") +
    '<div class="win"><div class="bar"><i></i><i></i><i></i><div class="tabs">' + VIEWS.map(function (v, i) {
      return '<button data-view="' + v[0] + '"' + (i ? "" : ' class="on"') + ">" + v[1] + "</button>";
    }).join("") + '</div><span class="url">do.computer</span></div><img data-shot alt="Do Computer: ' + VIEWS[0][1] + '" src="' + SHOTS["chat-" + theme] + '"></div>' +
    '<div class="phone"><img data-pshot alt="Do Computer on a phone: ' + VIEWS[0][1] + '" src="' + SHOTS["phone-chat-" + theme] + '"></div>' +
    '<p class="cap" data-cap>' + VIEWS[0][2] + "</p>" +
  "</div>";
}
function shotsBand(theme) {
  return '<section class="band" id="app-shots"><div class="wrap">' +
    '<div class="head mid"><p class="eyebrow">The app</p><h2>Here is Pip, at work.</h2>' +
    "<p>You talk to it in a chat. What it makes lands in a library. What it does on its own is a list you can pause.</p></div>" +
    windowed(theme) +
  "</div></section>";
}
function card(key, title, text, glow, extra, count) {
  var canvases = "";
  for (var i = 0; i < (count || 1); i++) canvases += '<canvas data-card="' + key + '"' + (count ? ' class="s"' : "") + "></canvas>";
  return '<article class="card"><div class="screen" style="--g:' + glow + '">' + (extra || "") + canvases + '<div class="st" data-line="' + key + '"></div></div><h3>' + title + "</h3><p>" + text + "</p></article>";
}
function doesBand() {
  return '<section class="band" id="does"><div class="wrap">' +
    '<div class="head mid"><p class="eyebrow">What it does</p><h2>It does the work,<br>not just the talking.</h2>' +
    "<p>Ask in plain words. It works the job out on a real computer, and tells you when it is done.</p></div>" +
    '<div class="cards">' +
      card("computer", "A computer of its own", "It runs commands, writes files and clicks through a browser on its own machine in the cloud. Share your Mac or PC and it can work there too.", "#1d4a5a") +
      card("away", "Still at it when you leave", "Close the laptop. It keeps going, and your phone buzzes when the job is done.", "#3a2f6a") +
      card("memory", "It remembers", "It keeps notes on you and the work, so Tuesday starts where Monday ended.", "#5a3350") +
      card("clock", "Up before you are", "Give it a schedule. The morning brief is written before the coffee is.", "#6a4a30") +
      card("where", "Wherever you are", "In a browser, as an app on your desktop, on your phone, and in Slack when someone asks for it by name.", "#1f5a46",
        '<div class="chips"><span class="chip">Web</span><span class="chip">Desktop</span><span class="chip">Phone</span><span class="chip">Slack</span></div>') +
      card("team", "One for the whole team", "Share one with your team or keep one to yourself. They hand work to each other while you get on with yours.", "#24507a", "", 3) +
    "</div>" +
  "</div></section>";
}
function growBand() {
  return '<section class="band" id="guys"><div class="wrap grow">' +
    '<div class="pad"><span class="who" data-who></span><span class="hint">pet me</span><canvas data-grow></canvas></div>' +
    "<div>" +
      '<p class="eyebrow">No two alike</p>' +
      "<h2>Type a name. See who turns up.</h2>" +
      '<p class="lead">Every assistant is grown from a seed: its shape, its eyes, whether it has a tail. The same seed always grows the same one, and yours is yours.</p>' +
      '<div class="namerow"><input class="field" data-name maxlength="24" spellcheck="false" autocomplete="off" placeholder="A name"><button class="dice" data-dice aria-label="Another name">' + DICE + "</button></div>" +
      '<div class="sws">' + Object.keys(PAL).map(function (k) { return '<button class="sw" data-color="' + k + '" style="--c:' + PAL[k] + '" aria-label="' + k + '"></button>'; }).join("") + "</div>" +
      '<dl class="traits" data-traits></dl>' +
      '<div class="cta open-only"><a class="btn primary" data-say="hatch">Hatch one of your own' + ARROW + "</a></div>" +
    "</div>" +
  "</div></section>";
}
/* That it is open source, said with the three lines that run it. */
function ossBand() {
  return '<section class="band" id="open-source"><div class="wrap oss">' +
    "<div>" +
      '<p class="eyebrow">Open source</p>' +
      "<h2>Yours, all the way down.</h2>" +
      '<p class="lead">Do Computer is open source under the MIT license. Read every line, change what you like, and run it yourself: on a box in the cupboard or on your own Cloudflare account, with your own model keys.</p>' +
      '<ul class="ticks"><li><b>Your data stays yours.</b> One SQLite file for each agent, wherever you put it.</li><li><b>Any model.</b> Through OpenRouter, or a provider you are signed in to.</li><li><b>Or skip all that.</b> We run it for you at do.computer.</li></ul>' +
      '<div class="cta"><a class="btn ghost" data-say="github">' + GH + "Star on GitHub</a></div>" +
    "</div>" +
    '<div class="term"><canvas data-term></canvas><div class="bar"><i></i><i></i><i></i><span>~/durable-computer</span></div>' +
      "<pre><span>$</span> git clone https://" + REPO + "\n<span>$</span> pnpm install &amp;&amp; pnpm build\n<span>$</span> OPENROUTER_API_KEY=sk-or-… pnpm start\n\n<em>  Listening on http://127.0.0.1:3000</em>\n<em>  Open it, and say hello to your agent.</em> <b></b></pre>" +
    "</div>" +
  "</div></section>";
}
function wearBand() {
  return '<section class="band" id="hats"><div class="wrap wear">' +
    '<div class="pad"><canvas data-wear></canvas><span class="got" data-got></span></div>' +
    "<div>" +
      '<p class="eyebrow">Also, hats</p>' +
      "<h2>Feed it. Dress it up.</h2>" +
      '<p class="lead">Work with it and it earns treats. Enough treats and a box turns up, with one of 200 things to wear inside. Some are much rarer than others.</p>' +
      '<div class="rar">' + RAR.map(function (r) { return '<span style="--c:' + r[1] + '"><i></i>' + r[0] + "</span>"; }).join("") + "</div>" +
      '<div class="cta"><button class="btn ghost" data-box>Open a box</button></div>' +
    "</div>" +
  "</div></section>";
}
function endBand() {
  return '<section class="end">' +
    "<canvas data-end></canvas>" +
    '<h2 data-endline>Yours has not hatched yet.</h2>' +
    '<p class="lead open-only">It comes down out of the sky, asks your name, and gets to work.</p>' +
    '<p class="lead soon-only">Soon. The eggs are nearly ready.</p>' +
    '<div class="cta open-only"><a class="btn primary lg" data-say="hatch">Hatch yours' + ARROW + "</a></div>" +
    '<div class="cta closed soon-only"><span class="pill"><i></i>Coming soon</span>' + have() + "</div>" +
  "</section>" +
  '<footer class="wrap foot"><a class="brand" href="#top">' + LOGO + 'Do Computer</a><span>Open source, MIT</span><span class="sp"></span><a data-say="github">GitHub</a><a href="#login">Sign in</a></footer>';
}
function skyHero(more, copy) {
  return '<section class="hero ' + more + '" id="top">' +
    '<div class="sky-wrap"><canvas class="sky"></canvas><div class="hero-guy"><canvas></canvas><div class="saying"></div></div></div>' +
    '<div class="hero-copy">' + copy + "</div>" +
  "</section>";
}

/* ---------- the four looks ---------- */
var PAGES = {
  a: function () {
    return nav() +
      skyHero("",
        '<p class="eyebrow">Your open source personal assistant</p>' +
        "<h1>Hatch a little guy.<br>Give it a <em>computer</em>.</h1>" +
        '<p class="sub">Do Computer is an AI assistant with a name, a face and a memory, and a machine of its own to work on. It keeps going after you close the tab.</p>' +
        buttons()) +
      crowdRow() + shotsBand("dark") + doesBand() + growBand() + ossBand() + wearBand() + endBand();
  },
  b: function () {
    return nav() +
      '<section class="hero-b" id="top"><div class="wrap">' +
        '<a class="pill" data-say="github">' + GH + "Open source · MIT</a>" +
        "<h1>Your open source<br><em>personal assistant</em>.</h1>" +
        '<p class="sub">Do Computer is a little guy with a name, a memory and a computer of its own. Tell it what you need. It gets on with it, even after you close the tab.</p>' +
        buttons("github") +
        '<div id="app-shots">' + windowed("light", true) + "</div>" +
      "</div></section>" +
      doesBand() + growBand() + ossBand() + wearBand() + endBand();
  },
  c: function () {
    return '<section class="sel" id="top">' +
        '<header class="sel-top"><a class="brand" href="#top">' + LOGO + 'Do Computer</a><span class="sp"></span><a class="gh" data-say="github">' + GH + '<span>GitHub</span></a><a class="open-only" href="#login">Sign in</a></header>' +
        '<div class="sel-main">' +
          '<div class="sel-stage"><div class="beam"></div><canvas data-big></canvas><canvas data-bigegg hidden></canvas>' +
            '<div class="plate"><b data-pname></b><span data-pjob></span></div>' +
            '<div class="st" data-pline></div>' +
          "</div>" +
          '<div class="sel-side">' +
            '<p class="eyebrow">Open source · MIT</p>' +
            "<h1>Your open source<br>personal assistant.</h1>" +
            '<p class="sub" data-pabout></p>' +
            '<p class="choose"><i>▶</i>Choose yours</p>' +
            '<div class="roster">' + ROSTER.map(function (r, i) {
              return '<button data-pick="' + i + '" aria-label="' + r.name + ", " + r.job + '"><canvas data-tile="' + i + '"></canvas><span>' + (r.egg ? "???" : r.name) + "</span></button>";
            }).join("") + "</div>" +
            '<div class="cta open-only"><a class="btn primary lg start" data-say="hatch"><i>▶</i>Press start</a><p class="fine">Any of them can do all of it. Yours comes in an egg.</p></div>' +
            '<div class="cta closed soon-only"><span class="insert">Coming soon</span>' + have() + "</div>" +
          "</div>" +
        "</div>" +
        '<a class="more" href="#app-shots">▼ What is this?</a>' +
      "</section>" +
      shotsBand("dark") + doesBand() + ossBand() + wearBand() + endBand();
  },
  d: function () {
    return nav() +
      skyHero("hero-d",
        '<p class="eyebrow">Your open source personal assistant</p>' +
        "<h1>A little guy who does your computer stuff.</h1>" +
        '<p class="sub">It has a name, a memory and a machine of its own. Ask it for something, and go and do something else.</p>' +
        buttons("github")) +
      '<section class="under-d"><div class="wrap" id="app-shots">' + windowed("light", true) + "</div></section>" +
      doesBand() + growBand() + ossBand() + wearBand() + endBand();
  }
};

/* ---------- the sky, with one of them on its island ---------- */
var sky = null;
function skyStage(dawn, big) {
  var wrap = q(".sky-wrap"), holder = q(".hero-guy"), saying = q(".saying");
  sky = skies.create(q("canvas.sky"), { reduced: calm });
  if (!sky) return;
  var here = sky, g = gen;
  var orb = guy(q("canvas", holder), HERO.seed, HERO.color, { size: 300 });
  touchable(holder, orb);
  here.land();
  here.dawn(dawn, true);
  var W = 0, H = 0, sizedFor = 0, side = 0, last = 0, seen = true;
  if (window.IntersectionObserver) new IntersectionObserver(function (e) { seen = e[0].isIntersecting; }).observe(wrap);
  requestAnimationFrame(function frame(now) {
    if (g !== gen) return;
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (!seen || document.hidden) return;
    var w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    if (w !== W || h !== H) { W = w; H = h; sizedFor = 0; here.resize(w, h); }
    here.step(dt);
    here.render();
    var place = here.egg(), stance = orb.stance();
    // Its picture is laid over the sky's, where the sky says the island's top is.
    if (Math.abs(place.heading - sizedFor) > 0.004) {
      sizedFor = place.heading;
      side = clamp(Math.round(place.heading * h / stance.egg * big / skies.PIXEL) * skies.PIXEL, 90, 640);
      holder.style.width = holder.style.height = side + "px";
      orb.resize(side);
    }
    orb.shadow = place.shadow;
    holder.style.transform = "translate(" + Math.round(place.x - side / 2) + "px," + Math.round(place.y - side * stance.ground) + "px)";
  });

  // A job from start to finish, said over its head.
  var steps = [
    ["idle", "", "", 2200],
    ["listening", "", "Listening", 1800],
    ["thinking", "", "Thinking", 2200],
    ["working", "search", "Searching <code>flights to Lisbon</code>", 3000],
    ["working", "file", "Writing <code>trip-plan.md</code>", 2800],
    ["working", "command", "Running <code>pnpm test</code>", 2800],
    ["working", "memory", "Noting <code>likes a window seat</code>", 2600],
    ["done", "", "Done. Want to see?", 2600]
  ];
  var i = 0;
  (function next() {
    var s = steps[i++ % steps.length];
    orb.setState(s[0], s[1] || undefined);
    saying.classList.toggle("on", s[2] !== "");
    if (s[2]) saying.innerHTML = "<b>" + HERO.name + "</b><span>" + s[2] + "</span>";
    later(next, s[3]);
  })();
}

function crowd() {
  all("[data-crowd]").forEach(function (cv) {
    var c = CROWD[Number(cv.dataset.crowd)];
    var orb = guy(cv, c[0], PAL[c[1]], { size: c[2] });
    wardrobe.dress(orb, c[3]);
    touchable(cv.parentNode, orb);
  });
}

/* The window: its tabs change the picture, and it turns them over by itself until one is pressed. */
function shots() {
  all(".shotwrap").forEach(function (wrap) {
    var theme = wrap.dataset.theme, img = q("[data-shot]", wrap), small = q("[data-pshot]", wrap), cap = q("[data-cap]", wrap), at = 0, own = false;
    function to(i) {
      at = i;
      var v = VIEWS[i];
      img.src = SHOTS[v[0] + "-" + theme];
      img.alt = "Do Computer: " + v[1];
      // On a phone the window is not shown, and the phone beside it is the picture.
      small.src = SHOTS["phone-" + v[0] + "-" + theme];
      small.alt = "Do Computer on a phone: " + v[1];
      cap.textContent = v[2];
      all("[data-view]", wrap).forEach(function (b, n) { b.classList.toggle("on", n === i); });
    }
    all("[data-view]", wrap).forEach(function (b, n) { b.addEventListener("click", function () { own = true; to(n); }); });
    (function turn() { later(function () { if (own) return; to((at + 1) % VIEWS.length); turn(); }, 6500); })();
    if (!drawn) return;
    all("[data-perch]", wrap).forEach(function (cv) {
      var p = PERCH[Number(cv.dataset.perch)], c = CROWD[p[2]];
      var orb = guy(cv, c[0], PAL[c[1]], { size: p[1] });
      wardrobe.dress(orb, c[3]);
      touchable(cv, orb);
    });
  });
}

function grow() {
  var cv = q("[data-grow]"), field = q("[data-name]"), who = q("[data-who]"), traits = q("[data-traits]");
  var look = { name: "Mochi", color: "rose" };
  var orb = guy(cv, look.name, PAL[look.color]);
  touchable(cv, orb);
  var SHOW = ["body", "eyes", "on top", "tail", "markings", "blink"];
  function paint() {
    who.textContent = look.name || "nobody yet";
    var rows = core.describeGenome(orb.g, true).filter(function (r) { return SHOW.indexOf(r[0]) >= 0; });
    traits.innerHTML = rows.map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("");
    all("[data-color]").forEach(function (b) { b.classList.toggle("on", b.dataset.color === look.color); });
  }
  function named(name, typed) {
    look.name = name;
    if (!typed) field.value = name;
    orb.setSeed(name.trim() || "agent");
    if (!typed) orb.cheer();
    paint();
  }
  field.addEventListener("input", function () { named(field.value, true); orb.feed("key"); });
  q("[data-dice]").addEventListener("click", function () {
    var next;
    do { next = NAMES[Math.floor(Math.random() * NAMES.length)]; } while (next === look.name);
    named(next);
  });
  all("[data-color]").forEach(function (b) {
    b.addEventListener("click", function () { look.color = b.dataset.color; orb.setColor(PAL[look.color]); orb.cheer(); paint(); });
  });
  named(look.name);
}

function cards() {
  function one(key, seed, color, outfit, steps) {
    var cv = q('[data-card="' + key + '"]');
    var orb = guy(cv, seed, PAL[color], { size: 132, slow: true });
    if (outfit) wardrobe.dress(orb, outfit);
    touchable(cv, orb);
    play(orb, q('[data-line="' + key + '"]'), steps);
  }
  one("computer", "Tarn", "tide", null, [
    ["thinking", "", "Thinking", 2000],
    ["working", "command", "Running <code>git status</code>", 2600],
    ["working", "file", "Writing <code>src/checkout.ts</code>", 2600],
    ["working", "command", "Running <code>pnpm test</code>", 2600],
    ["done", "", "Done · 14 passed", 2400]
  ]);
  one("away", "Vesper", "plum", { hat: "nightcap" }, [
    ["working", "command", "You left 12 min ago · <code>deploy</code>", 3400],
    ["working", "search", "You left 19 min ago · checking the page", 3000],
    ["done", "", "Done · told your phone", 3000]
  ]);
  one("memory", "Pilar", "rose", { glasses: "reading" }, [
    ["working", "memory", "Noting <code>invoices go out on the 1st</code>", 3200],
    ["idle", "", "Remembers", 1800],
    ["working", "memory", "Noting <code>Maya signs off on copy</code>", 3200],
    ["idle", "", "Remembers", 1800]
  ]);
  one("clock", "Wren", "honey", null, [
    ["asleep", "", "07:59 · asleep", 3400],
    ["working", "search", "08:00 · reading the news", 2600],
    ["working", "file", "08:01 · writing <code>brief.md</code>", 2600],
    ["done", "", "08:02 · in your inbox", 2600]
  ]);
  one("where", "Juniper", "moss", { hat: "headphones" }, [
    ["listening", "", "#launch · Maya is typing", 2600],
    ["speaking", "", "#launch · replying", 3000],
    ["idle", "", "#launch", 2200]
  ]);
  var team = [["Juniper", "moss", { hat: "sprout" }], ["Wren", "honey", { glasses: "browline" }], ["Tarn", "tide", { neck: "necktie" }]];
  var lines = [
    ["Pip → Scout · can you check the pricing page?", ["speaking", "idle", "listening"]],
    ["Scout · reading the pricing page", ["idle", "idle", "working"]],
    ["Scout → Ledger · the March numbers, please", ["idle", "listening", "speaking"]],
    ["Ledger · adding up March", ["idle", "working", "idle"]]
  ];
  var members = all('[data-card="team"]').map(function (cv, i) {
    var orb = guy(cv, team[i][0], PAL[team[i][1]], { size: 96, slow: true });
    wardrobe.dress(orb, team[i][2]);
    touchable(cv, orb);
    return orb;
  });
  var line = q('[data-line="team"]'), at = 0;
  (function next() {
    var l = lines[at++ % lines.length];
    line.innerHTML = "<i></i><span>" + l[0] + "</span>";
    members.forEach(function (orb, i) { orb.setState(l[1][i], l[1][i] === "working" ? "search" : undefined); });
    later(next, 3200);
  })();
}

/* One of them on the terminal that runs it. */
function oss() {
  var cv = q("[data-term]");
  var orb = guy(cv, "Biscuit", PAL.honey, { size: 104 });
  wardrobe.dress(orb, { hat: "chef" });
  touchable(cv, orb);
  play(orb, null, [["working", "command", "", 5200], ["done", "", "", 2400], ["idle", "", "", 2600]]);
}

/* A box, opened on the creature's own stage as it is in the app. */
function wear() {
  var cv = q("[data-wear]"), got = q("[data-got]"), button = q("[data-box]");
  var orb = guy(cv, "Mochi", PAL.honey);
  var outfit = { hat: "party" }, at = 0, busy = false;
  wardrobe.dress(orb, outfit);
  touchable(cv, orb);
  button.addEventListener("click", function () {
    if (busy) return;
    busy = true;
    button.disabled = true;
    got.classList.remove("on");
    var item = BOXES[at++ % BOXES.length], rarity = RAR[item[3]];
    var gift = wardrobe.unwrap(orb, {
      onShown: function () {
        got.style.setProperty("--c", rarity[1]);
        got.innerHTML = "<b>" + rarity[0] + "</b>" + esc(item[2]);
        got.classList.add("on");
        later(function () {
          gift.dispose();
          outfit[item[1]] = item[0];
          wardrobe.dress(orb, outfit);
          orb.cheer();
          busy = false;
          button.disabled = false;
          button.textContent = "Open another";
        }, 1700);
      }
    });
    undo.push(function () { gift.dispose(); });
    gift.shake();
    later(function () { gift.open({ id: item[0], tiers: RAR.slice(0, item[3] + 1).map(function (r) { return r[1]; }) }); }, 700);
  });
}

/* The egg at the end: pressed three times while the door is open, it hatches. Shut, it only rocks. */
var end = null;
function ending() {
  var cv = q("[data-end]"), line = q("[data-endline]");
  var orb = guy(cv, "Fig", PAL.tide, { size: 210, notice: false });
  var cracks = 0;
  end = function () { cracks = 0; orb.notice = false; orb.setState("egg"); orb.crack(0); line.textContent = "Yours has not hatched yet."; };
  end();
  cv.addEventListener("click", function () {
    if (orb.getState() !== "egg" || view.mode !== "open") return orb.cheer();
    cracks++;
    if (cracks < 3) return orb.crack(cracks / 3);
    orb.hatch({ onDone: function () { orb.notice = true; orb.cheer(); line.textContent = "There you are."; } });
  });
  all("[data-egg]").forEach(function (small) {
    var tiny = guy(small, "Fig", PAL.tide, { size: 44, notice: false });
    tiny.setState("egg");
    small.parentNode.addEventListener("click", function () { tiny.cheer(); });
  });
}

/* The character select: one of them large, the rest to choose from. */
function select() {
  var big = q("[data-big]"), eggCv = q("[data-bigegg]"), line = q("[data-pline]");
  var orb = guy(big, ROSTER[0].seed, PAL[ROSTER[0].color]);
  var egg = guy(eggCv, "Olive", PAL.tide, { notice: false });
  egg.setState("egg");
  touchable(big, orb);
  touchable(eggCv, egg);
  ROSTER.forEach(function (r, i) {
    var tile = guy(q('[data-tile="' + i + '"]'), r.seed, PAL[r.color], { size: 64, slow: true, notice: false });
    if (r.egg) tile.setState("egg");
    else if (r.wear) wardrobe.dress(tile, r.wear);
  });
  var at = -1, own = false, turn = 0;
  function pick(i, mine) {
    if (mine) own = true;
    if (i === at) return;
    at = i;
    var r = ROSTER[i], my = ++turn, n = 0;
    all("[data-pick]").forEach(function (b, k) { b.classList.toggle("on", k === i); });
    q("[data-pname]").textContent = r.egg ? "???" : r.name;
    q("[data-pjob]").textContent = r.job;
    q("[data-pabout]").innerHTML = "<b>" + esc(r.job) + ".</b> " + esc(r.about);
    big.hidden = !!r.egg;
    eggCv.hidden = !r.egg;
    if (r.egg) { egg.cheer(); say(line, "egg", r.steps[0][2]); return; }
    orb.setSeed(r.seed);
    orb.setColor(PAL[r.color]);
    wardrobe.dress(orb, r.wear || null);
    orb.cheer();
    (function next() {
      if (my !== turn) return;
      var s = r.steps[n++ % r.steps.length];
      orb.setState(s[0], s[1] || undefined);
      say(line, s[0], s[2]);
      later(next, 2600);
    })();
  }
  all("[data-pick]").forEach(function (b, k) {
    b.addEventListener("click", function () { pick(k, true); });
    b.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") pick(k, true); });
  });
  pick(0);
  // It goes round them by itself until someone chooses.
  (function round() { later(function () { if (own) return; pick((at + 1) % ROSTER.length); round(); }, 7800); })();
}

/* ---------- what a button would do in the app ---------- */
var SAY = {
  hatch: "In the app this goes to /welcome: the egg comes down out of the sky, asks who you are, and hatches.",
  github: "This goes to " + REPO + ". That repository is private today, so it has to be made public first."
};
var toastEl = document.createElement("div"), toastT = 0;
toastEl.className = "toast";
document.body.appendChild(toastEl);
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(function () { toastEl.classList.remove("on"); }, 4600);
}

function login() {
  var el = document.createElement("div");
  el.className = "login";
  el.innerHTML =
    '<a class="back" href="#' + view.mode + '">← Do Computer</a>' +
    '<div class="box">' +
      '<div><h1>Welcome back</h1><p class="mut" style="margin-top:6px">Sign in to pick up where you and your agent left off.</p></div>' +
      '<div class="b o">Continue with GitHub</div><div class="or">or</div>' +
      '<label>Email<span class="in"></span></label><label>Password<span class="in"></span></label>' +
      '<div class="b p">Sign in</div>' +
      (view.mode === "open"
        ? '<p class="mut">New here? <u>Create an account</u></p>'
        : '<p class="new"><b>Do Computer is not open to everyone yet.</b> If a team invited you, use the link in your invitation.</p>') +
    "</div>";
  return el;
}

/* ---------- which look, and which state of it ---------- */
function build() {
  gen++;
  undo.forEach(function (fn) { try { fn(); } catch (e) { /* already gone */ } });
  undo = [];
  orbs.forEach(function (o) { o.dispose(); });
  orbs = [];
  if (sky) { sky.dispose(); sky = null; }
  end = null;
  app.innerHTML = PAGES[view.look]();
  shots();
  if (!drawn) return;
  if (q(".sky-wrap")) skyStage(view.look === "d" ? 3 : 2, 0.9);
  if (q("[data-crowd]")) crowd();
  if (q("[data-big]")) select();
  if (q("[data-grow]")) grow();
  cards(); oss(); wear(); ending();
}
function paint() {
  document.body.className = "v-" + view.look + " " + view.mode + (LIGHT[view.look] ? " light" : "") + " f-" + view.font;
  if (end) end();
  var old = document.querySelector(".login");
  if (old) old.remove();
  var signing = view.scene === "login";
  if (signing) document.body.appendChild(login());
  var note = signing && view.mode === "open" ? ["/login while sign-up is open.", "As it is today."] : NOTES[view.scene];
  strip.innerHTML = "<b>Mock-up</b>" +
    LOOKS.map(function (l) { return '<button class="' + (l[0] === view.look ? "on" : "") + '" data-look="' + l[0] + '">' + l[1] + "</button>"; }).join("") + "<i></i>" +
    STATES.map(function (s) { return '<button class="' + (s[0] === view.scene ? "on" : "") + '" data-scene="' + s[0] + '">' + s[1] + "</button>"; }).join("") +
    (view.look === "c" ? "<i></i><b>Font</b>" + FONTS.map(function (f) { return '<button class="' + (f[0] === view.font ? "on" : "") + '" data-font="' + f[0] + '">' + f[1] + "</button>"; }).join("") : "") +
    '<span class="note"><b>' + (signing ? note[0] : ABOUT[view.look]) + "</b>" + (signing ? note[1] : note[0] + " " + note[1]) + "</span>";
  try { history.replaceState(null, "", "#" + view.look + "-" + view.scene); } catch (e) { /* a frame without an address of its own */ }
}
/* Scenes and the page's own links are followed here and not by the browser, so that the page
   works the same inside a frame, where an address of a part of it may not. */
function go(name, fromPage) {
  if (NOTES[name]) {
    if (name === "login" && view.scene !== "login" && !fromPage) view.mode = "soon";
    view.scene = name;
    if (name !== "login") view.mode = name;
    paint();
    if (name !== "login") window.scrollTo(0, 0);
    return;
  }
  if (view.scene === "login") { view.scene = view.mode; paint(); }
  var to = document.getElementById(name);
  if (to) to.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
}
strip.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.scene) return go(b.dataset.scene);
  if (b.dataset.font) { view.font = b.dataset.font; return paint(); }
  view.look = b.dataset.look;
  if (view.scene === "login") view.scene = view.mode;
  build();
  paint();
  window.scrollTo(0, 0);
});
document.addEventListener("click", function (e) {
  var a = e.target.closest('a[href^="#"]');
  if (a) { e.preventDefault(); return go(a.getAttribute("href").slice(1), true); }
  var s = e.target.closest("[data-say]");
  if (s) toast(SAY[s.dataset.say]);
});
// Every one of them looks at the pointer.
window.addEventListener("pointermove", function (e) {
  for (var i = 0; i < orbs.length; i++) if (orbs[i].notice) orbs[i].setPointer(e.clientX, e.clientY);
}, { passive: true });

var face = /[?&]font=(\w+)/.exec(location.search);
if (face && FONTS.some(function (f) { return f[0] === face[1]; })) view.font = face[1];
var asked = /^#([abcd])(?:-(open|soon|login))?$/.exec(location.hash);
if (asked) {
  view.look = asked[1];
  view.scene = asked[2] || "open";
  view.mode = view.scene === "login" ? "soon" : view.scene;
}
build();
paint();
if (!drawn) toast("The characters need WebGL, which this browser does not have.");
})();
