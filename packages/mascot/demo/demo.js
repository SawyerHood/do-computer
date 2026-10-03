/* ================================================================
   DEMO PAGE
   Uses the core only through AgentOrb (createOrb and the Orb methods
   listed at the top of the core); nothing above depends on this part.
   ================================================================ */
(function () {
'use strict';
var AgentOrb = window.THREE ? AgentOrbCore(window.THREE) : null;
function $(id) { return document.getElementById(id); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

function boot(saved) {
  if (!AgentOrb || !AgentOrb.Stage.get('px')) {
    var wrap = document.querySelector('.orb-wrap');
    wrap.innerHTML = '<p class="fallback">The orb needs WebGL, which is not available in this browser.</p>';
    return;
  }

  var PALETTE = AgentOrb.PALETTE, STATES = AgentOrb.STATES, VARIANTS = AgentOrb.VARIANTS;
  var mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  function isDark() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--orb-dark')) > 0.5; }

  var view = { seed: 'Juniper', color: 'moss', state: 'idle', variant: 'command', auto: true, style: 'retro', reduced: mqMotion.matches, dark: isDark() };

  // the centrepiece and its small copies share seed, colour, state and events
  var main = AgentOrb.createOrb($('orb-main'), { seed: view.seed, color: PALETTE[view.color], dark: view.dark, reduced: view.reduced, style: view.style });
  var linked = [main];
  [['orb-24', 24], ['orb-32', 32], ['orb-48', 48], ['orb-96', 96], ['orb-list', 32]].forEach(function (d) {
    linked.push(AgentOrb.createOrb($(d[0]), { seed: view.seed, color: PALETTE[view.color], size: d[1], dark: view.dark, reduced: view.reduced, style: view.style }));
  });
  var others = [];
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i]); }

  // ---------- agent strips ----------
  var GALLERY_A = [['Marlow', 'clay'], ['Juniper', 'moss'], ['Tarn', 'tide'], ['Vesper', 'plum'], ['Wren', 'honey'], ['Sable', 'slate'], ['Pilar', 'rose'], ['Quill', 'ink']];
  var GALLERY_B = [['agt_3f9a', 'tide'], ['agt_81c2', 'tide'], ['agt_d04e', 'tide'], ['agt_6b77', 'tide'], ['agt_e5a0', 'tide'], ['agt_27bd', 'tide']];
  function strip(host, list) {
    list.forEach(function (d) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'agent-card'; btn.id = 'agent-' + d[0].toLowerCase();
      btn.setAttribute('aria-label', 'Load ' + d[0] + ', ' + d[1]);
      var cv = document.createElement('canvas'); cv.width = 88; cv.height = 88;
      var nm = document.createElement('span'); nm.className = 'n'; nm.textContent = d[0];
      var cl = document.createElement('span'); cl.className = 'c'; cl.textContent = d[1];
      btn.appendChild(cv); btn.appendChild(nm); btn.appendChild(cl);
      btn.addEventListener('click', function () { setSeed(d[0]); setColor(d[1]); $('orb-main').scrollIntoView({ block: 'nearest', behavior: view.reduced ? 'auto' : 'smooth' }); });
      host.appendChild(btn);
      others.push(AgentOrb.createOrb(cv, { seed: d[0], color: PALETTE[d[1]], dark: view.dark, reduced: view.reduced, style: view.style, slow: true }));
    });
  }
  strip($('gallery-a'), GALLERY_A);
  strip($('gallery-b'), GALLERY_B);

  // ---------- controls ----------
  var STATE_LABEL = { idle: 'Idle', listening: 'Listening', thinking: 'Thinking', working: 'Working', speaking: 'Speaking', waiting: 'Waiting', done: 'Done', error: 'Error', asleep: 'Asleep' };
  var VARIANT_LABEL = { command: 'Running a command', file: 'Reading or writing a file', search: 'Searching the web', memory: 'Updating its memory' };
  var STYLE_LABEL = { retro: 'Console mascot', glass: 'Glass orb' };
  var MANUAL_STATUS = {
    egg: ['Waiting to hatch'], hatching: ['Hatching'], idle: ['Idle'], listening: ['Listening'], thinking: ['Thinking'], speaking: ['Answering'], waiting: ['Needs your approval:', 'rm -rf build/'],
    done: ['Done'], error: ['Command failed:', 'exit code 1'], asleep: ['Asleep'],
    command: ['Running:', 'git status'], file: ['Reading', 'notes.txt'], search: ['Searching the web:', 'node lts'], memory: ['Updating its memory']
  };
  var stateBtns = {}, workBtns = {}, colorBtns = {}, styleBtns = {};
  STATES.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.id = 'state-' + s; b.textContent = STATE_LABEL[s]; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { manual(s, view.variant); });
    $('state-buttons').appendChild(b); stateBtns[s] = b;
  });
  VARIANTS.forEach(function (v) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.id = 'work-' + v; b.textContent = VARIANT_LABEL[v]; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { manual('working', v); });
    $('work-buttons').appendChild(b); workBtns[v] = b;
  });
  Object.keys(PALETTE).forEach(function (name) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.id = 'color-' + name; b.style.setProperty('--sw', PALETTE[name]);
    b.setAttribute('aria-label', 'Color: ' + name); b.title = name; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { setColor(name); });
    $('color-buttons').appendChild(b); colorBtns[name] = b;
  });
  Object.keys(STYLE_LABEL).forEach(function (name) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.id = 'style-' + name; b.textContent = STYLE_LABEL[name]; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { setStyle(name); });
    $('style-buttons').appendChild(b); styleBtns[name] = b;
  });

  function paintControls() {
    STATES.forEach(function (s) { stateBtns[s].setAttribute('aria-pressed', String(view.state === s)); });
    VARIANTS.forEach(function (v) { workBtns[v].setAttribute('aria-pressed', String(view.state === 'working' && view.variant === v)); });
    Object.keys(PALETTE).forEach(function (c) { colorBtns[c].setAttribute('aria-pressed', String(view.color === c)); });
    Object.keys(STYLE_LABEL).forEach(function (c) { styleBtns[c].setAttribute('aria-pressed', String(view.style === c)); });
    $('color-name').textContent = view.color;
    var at = $('autoplay-toggle');
    at.setAttribute('aria-pressed', String(view.auto));
    at.textContent = view.auto ? 'Stop the conversation' : 'Autoplay a conversation';
    $('autoplay-note').textContent = view.auto ? 'Playing a sample conversation on a loop.' : 'Paused. Pick any state below.';
    $('egg-btn').setAttribute('aria-pressed', String(view.state === 'egg'));
    $('hatch-btn').textContent = view.state === 'hatching' ? 'Skip the hatch' : 'Hatch from an egg';
    var mascot = view.style === 'retro';
    $('hatch-btn').disabled = !mascot; $('egg-btn').disabled = !mascot;
    $('hatch-note').hidden = mascot;
  }
  function paintTraits() {
    var dl = $('traits'); dl.textContent = '';
    AgentOrb.describeGenome(main.g, view.style === 'retro').forEach(function (row) {
      var dt = document.createElement('dt'); dt.textContent = row[0];
      var dd = document.createElement('dd'); dd.textContent = row[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
  }
  function setStatus(parts) {
    var el = $('status-line'); el.textContent = '';
    if (!parts || !parts.length) { $('list-state').textContent = 'Idle'; return; }
    el.appendChild(document.createTextNode(parts[0]));
    if (parts[1]) { el.appendChild(document.createTextNode(' ')); var c = document.createElement('code'); c.textContent = parts[1]; el.appendChild(c); }
    $('list-state').textContent = parts[0].replace(/:$/, '') + (parts[1] ? ': ' + parts[1] : '');
  }
  function setOrbState(state, variant) {
    view.state = state; if (variant) view.variant = variant;
    each(linked, function (o) { o.setState(state, view.variant); });
    $('orb-main').setAttribute('aria-label', view.seed + ', ' + (state === 'working' ? VARIANT_LABEL[view.variant].toLowerCase() : STATE_LABEL[state].toLowerCase()));
    paintControls();
  }
  function setSeed(seed) {
    seed = String(seed || '').trim() || 'agent';
    view.seed = seed;
    each(linked, function (o) { o.setSeed(seed); });
    if ($('seed-input').value.trim() !== seed) $('seed-input').value = seed;
    $('agent-name').textContent = seed; $('bot-who').textContent = seed; $('list-name').textContent = seed;
    paintTraits();
  }
  function setColor(name) {
    if (!PALETTE[name]) return;
    view.color = name;
    each(linked, function (o) { o.setColor(PALETTE[name]); });
    paintControls();
  }
  function setStyle(name) {
    if (!STYLE_LABEL[name]) return;
    view.style = name;
    if (name !== 'retro' && (view.state === 'egg' || view.state === 'hatching')) { view.state = 'idle'; setStatus(MANUAL_STATUS.idle); }
    each(linked.concat(others), function (o) { o.setStyle(name); });
    paintControls(); paintTraits();
  }
  function setReduced(on) {
    view.reduced = !!on; $('opt-motion').checked = view.reduced;
    each(linked.concat(others), function (o) { o.reduced = view.reduced; });
  }
  function setTheme() {
    var d = isDark(); view.dark = d;
    each(linked.concat(others), function (o) { o.setTheme(d); });
  }
  main.onAuto = function (state) { if (!view.auto) { view.state = state; paintControls(); setStatus(MANUAL_STATUS[state]); } };

  // ---------- first run: the egg and the hatch ----------
  function showEgg() {
    if (view.auto) autoplay(false); else run.id++;
    clearTalk();
    view.state = 'egg';
    each(linked, function (o) { o.setState('egg'); });
    setStatus(MANUAL_STATUS.egg); paintControls();
  }
  function hatch() {
    if (view.state === 'hatching') { each(linked, function (o) { o.skipHatch(); }); return; }
    if (view.auto) autoplay(false); else run.id++;
    clearTalk();
    view.state = 'hatching';
    each(linked, function (o) { o.hatch(o === main ? { onDone: function () { view.state = 'idle'; setStatus(MANUAL_STATUS.idle); paintControls(); } } : null); });
    setStatus(MANUAL_STATUS.hatching); paintControls();
  }

  // ---------- transcript: typing and streaming ----------
  var run = { id: 0 };
  function sleep(ms, id) { return new Promise(function (res) { setTimeout(function () { res(id === run.id); }, ms); }); }
  function showYou(text, caret) { $('line-you').hidden = false; $('you-text').textContent = text; $('you-text').classList.toggle('caret', !!caret); }
  function showBot(text, caret) { $('line-bot').hidden = false; $('bot-text').textContent = text; $('bot-text').classList.toggle('caret', !!caret); }
  function clearTalk() { $('line-you').hidden = true; $('line-bot').hidden = true; $('approve-row').hidden = true; $('you-text').textContent = ''; $('bot-text').textContent = ''; }
  function typeText(text, id) {
    var i = 0;
    return (function next() {
      if (id !== run.id) return Promise.resolve(false);
      if (i > text.length) return Promise.resolve(true);
      showYou(text.slice(0, i), true);
      if (i > 0) each(linked, function (o) { o.feed('key'); });
      var ch = text.charAt(i - 1); i++;
      return sleep(ch === ' ' ? 110 + Math.random() * 90 : 45 + Math.random() * 70, id).then(next);
    })();
  }
  function streamText(text, id) {
    var parts = text.match(/\S+\s*/g) || [], i = 0, out = '';
    return (function next() {
      if (id !== run.id) return Promise.resolve(false);
      if (i >= parts.length) { showBot(out, false); return Promise.resolve(true); }
      var part = parts[i++]; out += part; showBot(out, true);
      each(linked, function (o) { o.feed('token', clamp(part.length / 8, 0.3, 1)); });
      var pause = /[.?!]\s*$/.test(part) ? 330 + Math.random() * 160 : /[,;:]\s*$/.test(part) ? 190 + Math.random() * 80 : 0;
      return sleep(48 + Math.random() * 62 + part.length * 5 + pause, id).then(next);
    })();
  }

  // ---------- the sample conversation ----------
  var approval = null;
  var SCRIPT = [
    { state: 'idle', dur: 2600, clear: true },
    { type: 'What changed in the repo this week?' },
    { state: 'thinking', status: ['Thinking'], dur: 2800 },
    { state: 'working', variant: 'command', status: ['Running:', 'git log --since=1.week --oneline'], dur: 3600 },
    { state: 'working', variant: 'file', status: ['Reading', 'CHANGELOG.md'], dur: 3400 },
    { stream: 'Twelve commits since Monday. Most of them rework the sync queue, and two fix the login redirect. The changelog does not mention the queue yet.' },
    { state: 'done', status: ['Done'], dur: 1650 },
    { state: 'idle', dur: 2800 },
    { type: 'Is Node 22 still an LTS line? Put it in my notes.', clear: true },
    { state: 'thinking', status: ['Thinking'], dur: 2400 },
    { state: 'working', variant: 'search', status: ['Searching the web:', 'node lts'], dur: 3800 },
    { state: 'working', variant: 'file', status: ['Writing', 'notes.txt'], dur: 3000 },
    { state: 'working', variant: 'memory', status: ['Updating its memory'], dur: 3600 },
    { stream: 'Yes, Node 22 is still supported, in maintenance until April 2027. I wrote that to notes.txt and I will remember that you track LTS releases.' },
    { state: 'done', status: ['Done'], dur: 1650 },
    { state: 'idle', dur: 2600 },
    { type: 'Clear out the old build folder.', clear: true },
    { state: 'thinking', status: ['Thinking'], dur: 2000 },
    { approve: 'rm -rf build/', dur: 6500,
      denied: [{ stream: 'Okay. I left build/ alone.' }, { state: 'idle', dur: 2600 }] },
    { state: 'working', variant: 'command', status: ['Running:', 'rm -rf build/'], dur: 2400 },
    { state: 'error', status: ['Command failed:', 'rm: build/cache: Permission denied'], dur: 3600 },
    { stream: 'That did not go through. build/cache belongs to root, so I left the folder as it was. Run it with sudo if you want it gone.' },
    { state: 'idle', dur: 3200 },
    { state: 'asleep', status: ['Asleep'], dur: 6500, clear: true },
    { state: 'idle', dur: 1400 }
  ];
  function playStep(step, id) {
    if (step.clear) clearTalk();
    if (step.type) {
      setOrbState('listening'); setStatus(['Listening']);
      return typeText(step.type, id).then(function (ok) { if (!ok) return false; showYou(step.type, false); return sleep(450, id); });
    }
    if (step.stream) {
      setOrbState('speaking'); setStatus(['Answering']);
      return streamText(step.stream, id).then(function (ok) { return ok ? sleep(350, id) : false; });
    }
    if (step.approve) {
      setOrbState('waiting'); setStatus(['Needs your approval:', step.approve]);
      $('approve-row').hidden = false;
      return new Promise(function (res) {
        var timer = setTimeout(function () { finish('approve'); }, step.dur);
        function finish(answer) {
          clearTimeout(timer); approval = null; $('approve-row').hidden = true;
          if (id !== run.id) return res(false);
          if (answer === 'deny') return playList(step.denied, id).then(function (ok) { res(ok ? 'restart' : false); });
          res(true);
        }
        approval = finish;
      });
    }
    setOrbState(step.state, step.variant); setStatus(step.status || []);
    return sleep(step.dur, id);
  }
  function playList(list, id) {
    var i = 0;
    return (function next(ok) {
      if (ok === false || id !== run.id) return Promise.resolve(false);
      if (ok === 'restart') return Promise.resolve('restart');
      if (i >= list.length) return Promise.resolve(true);
      return playStep(list[i++], id).then(next);
    })(true);
  }
  function autoplay(on) {
    run.id++; approval = null;
    view.auto = !!on;
    var id = run.id;
    if (on) {
      (function loop() { playList(SCRIPT, id).then(function (ok) { if (ok !== false && id === run.id) loop(); }); })();
    }
    paintControls();
  }
  function manual(state, variant) {
    if (view.auto) autoplay(false); else run.id++;
    var id = run.id;
    clearTalk();
    setOrbState(state, variant);
    setStatus(MANUAL_STATUS[state === 'working' ? view.variant : state]);
    if (state === 'waiting') {
      $('approve-row').hidden = false;
      approval = function (answer) { approval = null; $('approve-row').hidden = true; manual(answer === 'deny' ? 'idle' : 'working', 'command'); };
    }
    if (state === 'speaking') {
      (function again() {
        streamText('Twelve commits since Monday. Most of them rework the sync queue, and two fix the login redirect. The changelog does not mention the queue yet.', id)
          .then(function (ok) { return ok ? sleep(900, id) : false; })
          .then(function (ok) { if (ok && id === run.id) again(); });
      })();
    }
    if (state === 'listening') {
      (function again() {
        typeText('What changed in the repo this week?', id)
          .then(function (ok) { return ok ? sleep(1400, id) : false; })
          .then(function (ok) { if (ok && id === run.id) again(); });
      })();
    }
  }

  // ---------- wiring ----------
  $('autoplay-toggle').addEventListener('click', function () {
    if (view.auto) { autoplay(false); clearTalk(); setOrbState('idle'); setStatus(MANUAL_STATUS.idle); }
    else { clearTalk(); autoplay(true); }
  });
  $('hatch-btn').addEventListener('click', hatch);
  $('egg-btn').addEventListener('click', showEgg);
  $('approve-btn').addEventListener('click', function () { if (approval) approval('approve'); });
  $('deny-btn').addEventListener('click', function () { if (approval) approval('deny'); });
  $('seed-input').addEventListener('input', function (e) { setSeed(e.target.value); });
  var NAMES = ['Juniper', 'Marlow', 'Tarn', 'Odile', 'Wren', 'Sable', 'Pilar', 'Atlas', 'Bramble', 'Cass', 'Dov', 'Esme', 'Fitch', 'Greta', 'Hollis', 'Ines', 'Jory', 'Kestrel', 'Linden', 'Mika', 'Nell', 'Oswin', 'Perrin', 'Quill', 'Rue', 'Soren', 'Tamsin', 'Una', 'Vesper', 'Wilder', 'Yarrow', 'Zev'];
  $('seed-new').addEventListener('click', function () {
    // A fresh label for the demo; the orb itself is derived only from the text of the seed.
    var name = NAMES[Math.floor(Math.random() * NAMES.length)];
    var next = Math.random() < 0.5 ? name : 'agt_' + Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    if (next === view.seed) next = name + '-2';
    setSeed(next);
  });
  $('opt-pointer').addEventListener('change', function (e) { each(linked.concat(others), function (o) { o.notice = e.target.checked; }); });
  $('opt-motion').addEventListener('change', function (e) { setReduced(e.target.checked); });
  $('opt-status').addEventListener('change', function (e) {
    $('status-line').classList.toggle('is-hidden', e.target.checked);
    $('talk').classList.toggle('is-hidden', e.target.checked);
  });
  $('opt-motion').checked = view.reduced;
  function onMq(mq, fn) { if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn); }
  onMq(mqMotion, function (e) { setReduced(e.matches); });
  onMq(mqDark, setTheme);
  new MutationObserver(setTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });

  var everyone = linked.concat(others);
  window.addEventListener('pointermove', function (e) { each(everyone, function (o) { o.setPointer(e.clientX, e.clientY); }); }, { passive: true });

  function stats() {
    var all = linked.concat(others), calls = 0, shown = 0;
    each(all, function (o) { if (o.visible) { shown++; calls += o.drawCalls; } });
    return { orbs: all.length, visible: shown, drawCalls: calls, mainDrawCalls: main.drawCalls, mainTris: main.tris, mainRes: main.px, fps: Math.round(AgentOrb.Runner.fps), contexts: AgentOrb.Stage.count(), style: view.style };
  }
  setInterval(function () {
    if (document.hidden) return;
    var s = stats();
    $('stats').textContent = s.orbs + ' orbs, ' + s.contexts + ' WebGL context · ' + s.drawCalls + ' draw calls for the ' + s.visible + ' in view · the large one: ' +
      s.mainDrawCalls + ' draw calls, ' + s.mainTris + ' triangles, ' + s.mainRes + ' × ' + s.mainRes + ' px · ' + s.fps + ' fps';
  }, 1000);

  if (saved && saved.style && STYLE_LABEL[saved.style] && saved.style !== view.style) setStyle(saved.style);
  paintTraits(); paintControls();
  autoplay(true);

  // Hook for testing and for poking at it from the console.
  window.orbDemo = {
    states: STATES.slice(), variants: VARIANTS.slice(), palette: PALETTE,
    setState: function (state, variant) { if (state === 'egg') showEgg(); else manual(state, variant || view.variant); },
    hatch: hatch, showEgg: showEgg, core: AgentOrb,
    setSeed: setSeed, setColor: setColor, setStyle: setStyle,
    setAutoplay: function (on) { autoplay(on); if (!on) { clearTalk(); setOrbState('idle'); setStatus(MANUAL_STATUS.idle); } },
    setReducedMotion: setReduced, refreshTheme: setTheme, stats: stats,
    genome: function (seed) { return AgentOrb.makeGenome(seed == null ? view.seed : seed); },
    describe: function (seed) { return AgentOrb.describeGenome(AgentOrb.makeGenome(seed == null ? view.seed : seed), view.style === 'retro'); },
    main: main, orbs: linked.concat(others), view: view
  };

  // Keep seed, colour and look when the viewer swaps in a newer version of this page.
  if (saved && saved.seed) setSeed(saved.seed);
  if (saved && saved.color) setColor(saved.color);
  var hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) { try { hot.snapshot(function () { return { seed: view.seed, color: view.color, style: view.style }; }); } catch (err) {} }
}

function start() {
  var hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(function (data) { boot(data || {}); });
  else boot((hot && hot.data) || {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
