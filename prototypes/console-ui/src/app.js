/* ================================================================
   The prototype. Plain DOM, no framework. It uses the creature only
   through AgentOrbCore's public surface (createOrb, Orb, makeGenome,
   describeGenome, PALETTE).
   ================================================================ */
(function () {
'use strict';

var D = DATA;
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function ic(name) { return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

var params = new URLSearchParams(location.search);
var mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
var mqWide = matchMedia('(min-width: 1180px)');
var mqPhone = matchMedia('(max-width: 760px)');
function calm() { return mqReduce.matches; }

var S = {
  view: 'chat',
  theme: params.get('theme') === 'night' ? 'night' : 'day',
  listOpen: false, panelOpen: true, drawer: false, sheet: false,
  mood: { state: 'idle', variant: 'command' }, activity: null, busy: false,
  look: { seed: D.agent.seed, color: D.agent.color },
  name: D.agent.name, tagline: D.agent.tagline,
  soul: D.agent.soul, user: D.agent.user, memory: D.agent.memory, model: D.agent.model,
  messages: [], log: [], schedules: [], attached: [],
  activeChat: 0, chats: D.chats.slice(),
  hatch: { phase: 'egg', seed: '', color: 'rose', timer: 0 },
  dirty: false
};
var BLOCK = 11; // characters to a block: the 2,200-character memory is 200 blocks
function blocks(text) { return Math.ceil(text.length / BLOCK); }

/* ================================================================
   The creature: one live copy, moved to wherever it is being watched
   ================================================================ */
var AgentOrb = null;
try {
  if (window.THREE && typeof AgentOrbCore === 'function') {
    AgentOrb = AgentOrbCore(window.THREE);
    if (!AgentOrb.Stage.get('px')) AgentOrb = null;
  }
} catch (err) { AgentOrb = null; }
var PALETTE = AgentOrb ? AgentOrb.PALETTE : { clay: '#b8674a', moss: '#5f8a4e', tide: '#3f7f9c', plum: '#7d5a9a', honey: '#c9952c', slate: '#5b6672', rose: '#c0607a', ink: '#2f3a52' };
var COLOR_LABEL = { clay: 'Clay', moss: 'Moss', tide: 'Tide', plum: 'Plum', honey: 'Honey', slate: 'Slate', rose: 'Rose', ink: 'Ink' };

var Live = { canvas: null, orb: null, slot: null };
function liveInit() {
  if (!AgentOrb) return;
  var c = document.createElement('canvas');
  c.setAttribute('role', 'img'); c.className = 'live-orb';
  Live.canvas = c;
  Live.orb = AgentOrb.createOrb(c, { seed: S.look.seed, color: PALETTE[S.look.color], size: 280, dark: S.theme === 'night', reduced: calm() });
  Live.orb.paused = true;
  window.addEventListener('pointermove', function (e) { if (Live.orb && !Live.orb.paused) Live.orb.setPointer(e.clientX, e.clientY); }, { passive: true });
}
function sizeLive() {
  var s = Live.slot;
  if (!s || !Live.orb) return;
  var fixed = s.dataset.size ? +s.dataset.size : 0;
  var w = fixed || Math.round(s.clientWidth) || 280;
  Live.canvas.style.width = Live.canvas.style.height = fixed ? fixed + 'px' : '';
  Live.orb.resize(w);
  Live.orb.rect = null;
}
function mountLive(slot) {
  if (!Live.orb) return;
  if (Live.slot !== slot) {
    if (Live.slot) Live.slot.classList.remove('has-live');
    Live.slot = slot;
    if (!slot) { Live.orb.paused = true; if (Live.canvas.parentNode) Live.canvas.parentNode.removeChild(Live.canvas); return; }
    slot.appendChild(Live.canvas);
    slot.classList.add('has-live');
  }
  if (!slot) return;
  Live.orb.paused = false;
  sizeLive();
}
// Where the one moving copy belongs right now.
function placeLive() {
  var slot = null;
  if (S.view === 'hatch') slot = $('#view-hatch [data-live-slot]');
  else if (S.view === 'agent') slot = $('#view-agent [data-live-slot]');
  else if (S.view === 'chat') slot = panelShowing() ? $('#panel [data-live-slot]') : $('#agent-pill [data-live-slot]');
  mountLive(slot);
  var name = S.view === 'hatch' ? 'New agent' : S.name;
  if (Live.canvas) Live.canvas.setAttribute('aria-label', name + ', ' + moodWords().toLowerCase());
}
function panelShowing() { return mqWide.matches ? S.panelOpen : S.drawer; }

// A still picture: a creature drawn for a moment off screen and kept as an image.
function standIn(hex) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M24 9c9 0 14 7 14 15s-5 14-14 14S10 32 10 24 15 9 24 9z" fill="' + hex + '"/>' +
    '<ellipse cx="19" cy="23" rx="3" ry="4" fill="#fff"/><ellipse cx="29" cy="23" rx="3" ry="4" fill="#fff"/><circle cx="19.600" cy="23.600" r="1.700" fill="#111"/><circle cx="29.600" cy="23.600" r="1.700" fill="#111"/></svg>');
}
function snap(seed, color, opts) {
  opts = opts || {};
  if (!AgentOrb) return null;
  var c = document.createElement('canvas');
  var o = new AgentOrb.Orb(c, { seed: seed, color: PALETTE[color], size: opts.size || 96, pixelRatio: 1, dark: S.theme === 'night', notice: false });
  if (opts.egg) o.setState('egg');
  for (var i = 0; i < 50; i++) o.update(1 / 30);
  o.render();
  var out = opts.raw ? c.getContext('2d').getImageData(0, 0, c.width, c.height) : c.toDataURL();
  o.dispose();
  return out;
}
var stills = {};
function still(seed, color, egg) {
  var key = seed + '/' + color + '/' + (egg ? 'egg' : '') + '/' + S.theme;
  if (!stills[key]) stills[key] = snap(seed, color, { egg: egg }) || standIn(PALETTE[color]);
  return stills[key];
}
function refreshStills() {
  var src = still(S.look.seed, S.look.color);
  $$('img[data-still="agent"]').forEach(function (img) { img.src = src; });
  portraits = {};
}

// The creature as a 1-bit sprite, for the little LCDs: an outline, and its darkest parts filled in.
var portraits = {};
function portrait(seed, color, egg) {
  var key = seed + '/' + color + '/' + (egg ? 'egg' : '');
  if (portraits[key]) return portraits[key];
  var N = 26, M = N * 2, img = snap(seed, color, { egg: egg, size: M, raw: true });
  var bits = new Uint8Array(N * N);
  if (img) {
    var d = img.data, w = img.width, big = new Uint8Array(M * M), x, y, i;
    // the ground shadow under it is not part of it: keep only what is joined to the middle
    for (y = 0; y < M; y++) for (x = 0; x < M; x++) big[y * M + x] = d[(y * w + x) * 4 + 3] > 170 && y < M * 0.93 ? 1 : 0;
    var seen = new Uint8Array(M * M), stack = [];
    for (y = M >> 1, x = 0; x < M; x++) if (big[y * M + x]) { stack.push(y * M + x); seen[y * M + x] = 1; }
    while (stack.length) {
      i = stack.pop(); x = i % M; y = (i - x) / M;
      [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (o) {
        var nx = x + o[0], ny = y + o[1], ni = ny * M + nx;
        if (nx >= 0 && ny >= 0 && nx < M && ny < M && big[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
      });
    }
    var body = new Uint8Array(N * N), lum = new Float32Array(N * N);
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      var n = 0, l = 0;
      for (var j = 0; j < 4; j++) { var bx = x * 2 + (j & 1), by = y * 2 + (j >> 1), bi = by * M + bx; if (seen[bi]) { n++; i = (by * w + bx) * 4; l += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; } }
      body[y * N + x] = n >= 2 ? 1 : 0; lum[y * N + x] = n ? l / n : 255;
    }
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      i = y * N + x;
      if (!body[i]) continue;
      var edge = x === 0 || y === 0 || x === N - 1 || y === N - 1 || !body[i - 1] || !body[i + 1] || !body[i - N] || !body[i + N];
      bits[i] = edge || lum[i] < 62 || (lum[i] < 112 && ((x + y) & 1)) ? 1 : 0;
    }
  } else {
    for (var a = 0; a < 80; a++) { var px = Math.round(13 + 8 * Math.cos(a / 80 * 6.283)), py = Math.round(12 + 9 * Math.sin(a / 80 * 6.283)); bits[py * N + px] = 1; }
    bits[10 * N + 10] = bits[11 * N + 10] = bits[10 * N + 16] = bits[11 * N + 16] = 1;
  }
  return (portraits[key] = { w: N, h: N, bits: bits });
}

/* ================================================================
   The 1-bit readout
   ================================================================ */
var BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
var textCanvas = document.createElement('canvas'); textCanvas.width = 96; textCanvas.height = 12;
var textCtx = textCanvas.getContext('2d', { willReadFrequently: true });
var textCache = {};
function textBits(str) {
  if (textCache[str]) return textCache[str];
  textCtx.clearRect(0, 0, 96, 12);
  textCtx.font = '8px Silkscreen, monospace'; textCtx.textBaseline = 'alphabetic'; textCtx.fillStyle = '#000';
  textCtx.fillText(str, 0, 8);
  var w = Math.min(96, Math.ceil(textCtx.measureText(str).width)), d = textCtx.getImageData(0, 0, w || 1, 10).data, bits = new Uint8Array(w * 10);
  for (var i = 0; i < w * 10; i++) bits[i] = d[i * 4 + 3] > 120 ? 1 : 0;
  return (textCache[str] = { w: w, h: 10, bits: bits });
}
if (document.fonts && document.fonts.load) document.fonts.load('8px Silkscreen').then(function () { textCache = {}; });

function Lcd(canvas, w, h) {
  this.c = canvas; this.w = w; this.h = h; canvas.width = w; canvas.height = h;
  this.ctx = canvas.getContext('2d'); this.buf = new Uint8Array(w * h); this.img = this.ctx.createImageData(w, h);
}
Lcd.prototype = {
  clear: function () { this.buf.fill(0); },
  px: function (x, y, v) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.buf[y * this.w + x] = v === 0 ? 0 : 1; },
  hl: function (x, y, n) { for (var i = 0; i < n; i++) this.px(x + i, y); },
  vl: function (x, y, n) { for (var i = 0; i < n; i++) this.px(x, y + i); },
  fill: function (x, y, w, h, v) { for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) this.px(x + i, y + j, v); },
  box: function (x, y, w, h) { this.hl(x, y, w); this.hl(x, y + h - 1, w); this.vl(x, y, h); this.vl(x + w - 1, y, h); },
  line: function (x0, y0, x1, y1, t) {
    var n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; t = t || 1;
    for (var i = 0; i <= n; i++) this.fill(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), t, t);
  },
  oval: function (cx, cy, rx, ry, a0, a1) {
    a0 = a0 == null ? 0 : a0; a1 = a1 == null ? 6.2832 : a1;
    var n = Math.ceil((rx + ry) * 4);
    for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; this.px(Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a))); }
  },
  blit: function (sprite, x, y) {
    for (var j = 0; j < sprite.h; j++) for (var i = 0; i < sprite.w; i++) if (sprite.bits[j * sprite.w + i]) this.px(x + i, y + j);
  },
  text: function (str, y, x) {
    var s = textBits(str);
    this.blit(s, x == null ? Math.round((this.w - s.w) / 2) : x, y);
  },
  flush: function () {
    var bg = lcdColors.bg, ink = lcdColors.ink, d = this.img.data;
    for (var i = 0; i < this.buf.length; i++) {
      var c = this.buf[i] ? ink : bg;
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
};
function hexRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
var lcdColors = { bg: [195, 208, 179], ink: [29, 42, 51] };
function readLcdColors() { lcdColors = { bg: hexRgb(cssVar('--lcd-bg') || '#c3d0b3'), ink: hexRgb(cssVar('--lcd-ink') || '#1d2a33') }; }

// What the readout shows for each thing the agent can be doing: a pictogram and a word.
var LCD_WORD = { idle: '', listening: 'LISTEN', thinking: 'THINK', command: 'RUN', file: 'FILE', search: 'SEARCH', memory: 'MEMORY', speaking: 'TALK', waiting: 'OK?', done: 'DONE', error: 'ERROR', asleep: 'ZZZ', egg: 'EGG', hatching: 'HATCH' };
var PICTO = {
  idle: function (l) { cardFace(l); },
  listening: function (l, f) {
    l.fill(9, 8, 4, 6); l.line(13, 8, 17, 4); l.line(13, 13, 17, 17); l.vl(18, 4, 14);
    for (var i = 0; i < 3; i++) if (f % 4 > i) l.oval(19, 10.500, 5 + i * 5, 4 + i * 3, -0.9, 0.9);
  },
  thinking: function (l, f) {
    for (var i = 0; i < 3; i++) { var up = f % 4 === i ? 3 : 0; l.fill(13 + i * 9, 9 - up, 4, 4); }
    l.oval(24, 10, 20, 9); l.px(7, 19); l.px(8, 19); l.px(5, 21);
  },
  command: function (l, f) {
    l.box(8, 1, 32, 20); l.hl(8, 5, 32); l.px(10, 3); l.px(12, 3); l.px(14, 3);
    l.line(11, 9, 14, 12); l.line(14, 12, 11, 15);
    var n = (f % 6) * 3; l.hl(17, 12, n); if (f % 2) l.fill(18 + n, 9, 2, 6);
  },
  file: function (l, f) {
    l.vl(15, 1, 20); l.hl(15, 20, 18); l.vl(32, 6, 15); l.hl(15, 1, 13); l.line(27, 1, 32, 6); l.vl(27, 1, 5); l.hl(27, 6, 6);
    var n = f % 6; for (var i = 0; i < Math.min(n, 4); i++) l.hl(18, 9 + i * 3, i === 3 ? 6 : 11);
  },
  search: function (l, f) {
    var p = [[0, 0], [4, 1], [6, -1], [2, -2]][f % 4], cx = 18 + p[0], cy = 9 + p[1];
    l.oval(cx, cy, 6, 6); l.oval(cx, cy, 5, 5); l.line(cx + 4, cy + 4, cx + 9, cy + 9, 2); l.px(cx - 2, cy - 3); l.px(cx - 3, cy - 2);
    l.hl(3, 20, 42);
  },
  memory: function (l, f) {
    var k = 9 + (f * 2) % 16;
    for (var j = 0; j < 3; j++) for (var i = 0; i < 8; i++) { var x = 4 + i * 5, y = 3 + j * 6; if (j * 8 + i < k) l.fill(x, y, 4, 5); else l.box(x, y, 4, 5); }
  },
  speaking: function (l, f) {
    l.hl(9, 1, 30); l.hl(9, 15, 30); l.vl(7, 3, 11); l.vl(40, 3, 11); l.px(8, 2); l.px(39, 2); l.px(8, 14); l.px(39, 14);
    l.line(12, 16, 12, 19); l.line(13, 18, 16, 16);
    var n = f % 9; l.hl(11, 5, Math.min(26, (n + 1) * 9)); if (n > 2) l.hl(11, 8, Math.min(26, (n - 2) * 9)); if (n > 5) l.hl(11, 11, Math.min(18, (n - 5) * 9));
  },
  waiting: function (l, f) {
    l.hl(17, 1, 14); l.vl(16, 2, 10); l.vl(31, 2, 10); l.line(16, 12, 23, 20); l.line(31, 12, 24, 20);
    if (f % 2 === 0) { l.fill(23, 4, 2, 8); l.fill(23, 14, 2, 2); }
  },
  done: function (l, f) {
    l.line(14, 10, 20, 16, 3); l.line(20, 16, 33, 3, 3);
    var s = f % 2 ? [[8, 4], [39, 15]] : [[40, 5], [7, 15]];
    s.forEach(function (p) { l.hl(p[0] - 2, p[1], 5); l.vl(p[0], p[1] - 2, 5); });
  },
  error: function (l, f) { var o = f % 2; l.line(16 + o, 3, 30 + o, 17, 3); l.line(30 + o, 3, 16 + o, 17, 3); },
  asleep: function (l, f) {
    function z(x, y, s) { l.hl(x, y, s); l.hl(x, y + s - 1, s); l.line(x + s - 1, y, x, y + s - 1); }
    z(11, 10, 9); if (f % 4 > 0) z(24, 6, 6); if (f % 4 > 1) z(33, 2, 4);
  },
  egg: function (l, f) {
    var o = [0, 1, 0, -1][f % 4];
    l.oval(24 + o, 12, 7, 9, 0, 3.1416); l.oval(24 + o, 12, 7, 11, 3.1416, 6.2832);
    l.line(18 + o, 12, 21 + o, 14); l.line(21 + o, 14, 24 + o, 11); l.line(24 + o, 11, 27 + o, 14); l.line(27 + o, 14, 30 + o, 12);
  },
  hatching: function (l, f) {
    var up = f % 3;
    l.oval(24, 13, 7, 8, 0, 3.1416); l.oval(24, 11 - up, 7, 10, 3.1416, 6.2832);
    l.line(17, 12, 20, 14); l.line(20, 14, 24, 11); l.line(24, 11, 28, 14); l.line(28, 14, 31, 12);
    if (up) { l.px(13, 6); l.px(35, 5); l.px(11, 12); l.px(37, 11); }
  }
};
// At rest it is a memory card's face: the creature, and how many of its 200 blocks are used.
function cardFace(l) {
  l.blit(portrait(S.look.seed, S.look.color), -1, 3); l.text(String(blocks(S.memory)), 5, 26); l.hl(27, 15, 19); l.text('200', 17, 26);
}
var lcds = [];   // { lcd, draw(frame) }
var lcdFrame = 0;
function drawPanelLcd(l, f) {
  var key = S.mood.state === 'working' ? S.mood.variant : S.mood.state;
  l.clear();
  (PICTO[key] || PICTO.idle)(l, f);
  if (key !== 'idle') l.text(LCD_WORD[key], 22);
  l.flush();
}
function paintStats() {
  var n = blocks(S.memory);
  $('#stat-mem').textContent = n; $('#stat-mem-bar').style.width = Math.min(100, n / 2) + '%';
  $('#stat-skills').textContent = D.skills.length; $('#stat-autos').textContent = S.schedules.length;
}
function tickLcds() {
  lcdFrame++;
  paintStats();
  for (var i = 0; i < lcds.length; i++) if (lcds[i].lcd.c.isConnected) lcds[i].draw(lcds[i].lcd, lcdFrame);
  lcds = lcds.filter(function (e) { return e.lcd.c.isConnected; });
}
function addLcd(canvas, w, h, draw) { lcds = lcds.filter(function (x) { return x.lcd.c !== canvas; }); var e = { lcd: new Lcd(canvas, w, h), draw: draw }; lcds.push(e); draw(e.lcd, lcdFrame); return e; }
function portraitLcd(canvas, seed, color, egg) {
  return addLcd(canvas, 24, 24, function (l) { l.clear(); var p = portrait(seed(), color(), egg && egg()); l.blit(p, -1, 0); l.flush(); });
}

/* ================================================================
   The dithered sky behind the creature
   ================================================================ */
function paintSky(canvas) {
  var host = canvas.parentNode, w = Math.max(8, Math.round(host.clientWidth / 3)), h = Math.max(8, Math.round(host.clientHeight / 3));
  if (!host.clientWidth) return;
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  var top = hexRgb(cssVar('--sky-top')), low = hexRgb(cssVar('--sky-low')), L = 6;
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var v = Math.pow(y / (h - 1), 0.85) * 0.7;
    var dx = (x - w / 2) / (w * 0.46), dy = (y - h * 0.56) / (h * 0.52);
    v = clamp(v + Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)) * 0.62, 0, 1);
    var q = v * (L - 1), lo = Math.floor(q), idx = (lo + (q - lo > (BAYER[y & 3][x & 3] + 0.5) / 16 ? 1 : 0)) / (L - 1), i = (y * w + x) * 4;
    d[i] = top[0] + (low[0] - top[0]) * idx; d[i + 1] = top[1] + (low[1] - top[1]) * idx; d[i + 2] = top[2] + (low[2] - top[2]) * idx; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
function paintSkies() { $$('.stage-sky').forEach(paintSky); }
function stageHtml(slot, extra) {
  return '<canvas class="stage-sky" aria-hidden="true"></canvas>' +
    '<div class="stage-floor" aria-hidden="true"><div class="disc-side"></div><div class="disc"><div class="disc-face"></div></div></div>' +
    '<div class="stage-rings" aria-hidden="true"><i></i><i></i><i></i></div>' +
    '<div class="stage-slot" data-live-slot="' + slot + '"><img data-still="' + slot + '" alt=""></div>' + (extra || '');
}

/* ================================================================
   Words for what it is doing
   ================================================================ */
function moodWords() {
  if (S.view === 'hatch') return S.hatch.phase === 'out' ? 'Ready' : S.hatch.phase === 'hatching' ? 'Hatching' : 'About to hatch';
  switch (S.mood.state) {
    case 'listening': return 'Listening';
    case 'thinking': return 'Thinking';
    case 'working': return 'Working';
    case 'speaking': return 'Answering';
    case 'waiting': return 'Waiting for your OK';
    case 'done': return 'Done';
    case 'error': return 'Something went wrong';
    case 'asleep': return 'Resting';
    default: return 'Ready';
  }
}
var doneTimer = 0;
function setMood(state, variant) {
  var was = S.mood.state;
  S.mood = { state: state, variant: variant || S.mood.variant };
  if (Live.orb && S.view !== 'hatch') Live.orb.setState(state, variant);
  if (state === 'done' && was !== 'done') {
    $$('.stage').forEach(function (s) { s.classList.remove('is-done'); void s.offsetWidth; s.classList.add('is-done'); });
    clearTimeout(doneTimer);
    doneTimer = setTimeout(function () { if (S.mood.state === 'done') setMood('idle'); }, 1700);
  }
  paintNow();
  tickLcds();
}
function setActivity(text, kind) {
  S.activity = text;
  var line = $('#status-line');
  if (line) {
    line.hidden = !text;
    line.className = 'status-line' + (kind ? ' kind-' + kind : '');
    $('.txt', line).textContent = text ? text + '…' : '';
    if (text) stickToEnd();
  }
  paintNow();
}
function paintNow() {
  var words = S.activity || moodWords();
  var now = $('#now-text'); if (now) now.textContent = words;
  var pill = $('#pill-status'); if (pill) pill.textContent = words;
  if (Live.canvas) Live.canvas.setAttribute('aria-label', (S.view === 'hatch' ? 'New agent' : S.name) + ', ' + words.toLowerCase());
}

/* ================================================================
   The transcript
   ================================================================ */
var thread = $('#thread'), scroller = $('#scroller');
function nearEnd() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90; }
var pinned = true;
scroller.addEventListener('scroll', function () { pinned = nearEnd(); }, { passive: true });
// A chat rests at its newest message, whatever the window around it does.
if (window.ResizeObserver) new ResizeObserver(function () { if (pinned) scroller.scrollTop = scroller.scrollHeight; }).observe(scroller);
function stickToEnd(force) { if (pinned || force) { pinned = true; scroller.scrollTop = scroller.scrollHeight; } }
function fileCard(f) {
  return '<button type="button" class="filecard" data-file="' + esc(f.name) + '" aria-label="Download ' + esc(f.name) + '"><span class="ficon ' + f.ext + '" aria-hidden="true">' + f.ext + '</span>' +
    '<span><b>' + esc(f.name) + '</b><small>' + f.size + '</small></span>' + ic('down') + '</button>';
}
function messageEl(m) {
  if (m.role === 'user') return el('<div class="msg user"><span class="sr">You said:</span><div class="bubble">' + esc(m.text) + '</div></div>');
  var node = el('<div class="msg agent"><div class="who"><span>' + esc(S.name) + '</span><time>' + (m.at || '') + '</time></div></div>');
  (m.parts || []).forEach(function (p) {
    if (p.html) node.appendChild(el('<div class="bubble prose">' + p.html + '</div>'));
    else if (p.file) node.appendChild(el(fileCard(p.file)));
    else if (p.marker) node.appendChild(el('<div class="marker">' + esc(p.marker) + '</div>'));
  });
  return node;
}
function renderThread() {
  thread.innerHTML = '';
  S.messages.forEach(function (m) { thread.appendChild(messageEl(m)); });
  thread.appendChild(el('<div class="status-line" id="status-line" role="status" aria-live="polite" hidden><span class="loader" aria-hidden="true"><i></i><i></i><i></i></span><span class="txt"></span></div>'));
  stickToEnd(true);
}
function addMessage(m, animate) {
  S.messages.push(m);
  var node = messageEl(m);
  if (animate) node.classList.add('pop-in');
  thread.insertBefore(node, $('#status-line'));
  stickToEnd(true);
  return node;
}

/* ================================================================
   The log: one entry for each request
   ================================================================ */
function blocksHtml(steps, fresh) {
  return '<span class="blocks" aria-hidden="true">' + steps.map(function (s, i) { return '<i class="kind-' + s.kind + (fresh && i === steps.length - 1 ? ' new' : '') + '"></i>'; }).join('') + '</span>';
}
function entryEl(e, open) {
  var cls = 'entry' + (e.running ? ' is-running' : '') + (e.stopped ? ' is-stopped' : '');
  var steps = e.steps.map(function (s) {
    var out = s.going ? 'Still going.' : s.out === '' ? 'It returned nothing.' : s.out;
    return '<li class="step kind-' + s.kind + (s.going ? ' is-going' : '') + '"><details><summary><i aria-hidden="true"></i><span>' + esc(s.text) + '</span></summary><pre>' + esc(out) + '</pre></details></li>';
  }).join('');
  var n = e.steps.length;
  return el('<li><details class="' + cls + '"' + (open ? ' open' : '') + '><summary>' +
    '<span class="entry-no" aria-hidden="true">' + (e.running ? '' : e.stopped ? ic('stop') : ic('check')) + '</span>' +
    '<span><span class="entry-title">' + esc(e.title) + '</span><span class="entry-out">' + esc(e.outcome) + '</span></span>' +
    '<span class="entry-meta"><time>' + e.at + '</time>' + blocksHtml(e.steps, e.running) + '<span class="sr">' + n + (n === 1 ? ' step' : ' steps') + '</span></span>' +
    '</summary><ol class="steps" aria-label="Steps">' + (steps || '<li class="step muted">No steps yet.</li>') + '</ol></details></li>');
}
function renderLog() {
  var host = $('#log'), open = {};
  $$('details.entry', host).forEach(function (d, i) { if (d.open) open[host.children.length - 1 - i] = true; });
  host.innerHTML = '';
  if (!S.log.length) host.appendChild(el('<li class="log-empty">Nothing yet. When ' + esc(S.name) + ' runs a command, reads a file or looks something up for this chat, it is listed here, and can be opened to see what came back.</li>'));
  for (var i = S.log.length - 1; i >= 0; i--) host.appendChild(entryEl(S.log[i], open[i] || S.log[i].running));
  $('#log-count').textContent = S.log.length ? S.log.length + (S.log.length === 1 ? ' request' : ' requests') : '';
}

/* ================================================================
   Requests for the user's OK
   ================================================================ */
var approvalDone = null;
function showApproval(req, autoMs) {
  var host = $('#approvals');
  var card = el('<li class="approval"><div class="approval-head">' + ic('shield') + '<p><b>' + esc(S.name) + '</b> wants to: <b>' + esc(req.title) + '</b></p></div>' +
    '<pre>' + esc(req.detail) + '</pre><div class="approval-actions">' +
    '<button type="button" class="btn primary small auto-press" data-answer="once">Allow once</button>' +
    '<button type="button" class="btn small" data-answer="always">Always allow</button>' +
    '<button type="button" class="btn quiet small" data-answer="deny">Don’t allow</button>' +
    (autoMs ? '<span class="demo-note">The demo presses “Allow once” in a moment</span>' : '') + '</div></li>');
  host.appendChild(card);
  stickToEnd();
  return new Promise(function (resolve) {
    var settled = false;
    function finish(answer) {
      if (settled) return; settled = true; approvalDone = null;
      card.remove();
      resolve(answer);
    }
    approvalDone = finish;
    card.addEventListener('click', function (e) { var b = e.target.closest('[data-answer]'); if (b) finish(b.dataset.answer); });
    if (autoMs) {
      var bar = $('.auto-press', card);
      wait(autoMs, function (p) { bar.style.setProperty('--p', p.toFixed(3)); }).then(function (ok) { if (ok) finish('once'); else finish(null); });
    }
  });
}

/* ================================================================
   The scripted conversation
   ================================================================ */
var Demo = { token: 0, paused: false, away: false, playing: false, finished: false, rate: clamp(parseFloat(params.get('speed')) || 1, 0.25, 20) };
// Waits that the pause button and leaving the chat both hold still. Resolves false if the run was replaced.
function wait(ms, onProgress) {
  var token = Demo.token, left = ms / Demo.rate, total = left, last = performance.now();
  return new Promise(function (resolve) {
    (function tick() {
      if (token !== Demo.token) return resolve(false);
      var now = performance.now();
      if (!Demo.paused && !Demo.away) left -= now - last;
      last = now;
      if (onProgress) onProgress(clamp(1 - left / total, 0, 1));
      if (left <= 0) return resolve(true);
      setTimeout(tick, Math.min(Math.max(left, 16), onProgress ? 50 : 80));
    })();
  });
}
function paintDemo() {
  var b = $('#demo-toggle');
  var label = Demo.playing ? (Demo.paused ? 'Play' : 'Pause') : 'Play';
  b.innerHTML = ic(label === 'Pause' ? 'pause' : 'play') + '<span>' + label + '</span>';
  b.setAttribute('aria-label', label === 'Pause' ? 'Pause the demo conversation' : 'Play the demo conversation');
}
function resetChat() {
  Demo.token++;
  if (approvalDone) approvalDone(null);
  $('#approvals').innerHTML = '';
  S.messages = D.messages.map(function (m) { return m; });
  S.log = D.log.map(function (e) { return { title: e.title, outcome: e.outcome, at: e.at, steps: e.steps.slice() }; });
  S.schedules = D.schedules.map(function (s) { return Object.assign({}, s); });
  S.memory = D.agent.memory;
  S.busy = false; Demo.playing = false; Demo.finished = false; Demo.paused = false;
  draft.value = ''; fitDraft(); paintSend();
  renderThread(); renderLog(); setActivity(null); setMood('idle');
  paintDemo();
}
function setBusy(on) { S.busy = on; paintSend(); }

function streamInto(bubble, html) {
  bubble.innerHTML = html;
  var walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT), items = [], n;
  while ((n = walker.nextNode())) items.push({ node: n, text: n.nodeValue });
  $$('*', bubble).forEach(function (e) { e.hidden = true; });
  items.forEach(function (it) { it.node.nodeValue = ''; });
  var i = 0, last = null;
  function next() {
    if (i >= items.length) { if (last) last.classList.remove('caret'); return Promise.resolve(true); }
    var it = items[i++], words = it.text.match(/\S+\s*|\s+/g) || [], k = 0;
    for (var p = it.node.parentNode; p && p !== bubble; p = p.parentNode) p.hidden = false;
    if (last) last.classList.remove('caret');
    last = it.node.parentNode === bubble ? null : it.node.parentNode;
    if (last) last.classList.add('caret');
    return (function word() {
      if (k >= words.length) return next();
      var w = words[k++];
      it.node.nodeValue += w;
      if (Live.orb) Live.orb.feed('token', clamp(w.length / 8, 0.3, 1));
      stickToEnd();
      var pause = /[.?!:]\s*$/.test(w) ? 240 : /[,;]\s*$/.test(w) ? 120 : 0;
      return wait(34 + Math.random() * 40 + w.length * 4 + pause).then(function (ok) {
        if (!ok) { if (last) last.classList.remove('caret'); $$('[hidden]', bubble).forEach(function (e) { e.hidden = false; }); return false; }
        return word();
      });
    })();
  }
  return next();
}

function typeDraft(text) {
  var i = 0;
  draft.value = ''; fitDraft();
  setMood('listening');
  return (function next() {
    if (i >= text.length) return Promise.resolve(true);
    var ch = text.charAt(i++);
    draft.value = text.slice(0, i); fitDraft(); paintSend();
    if (Live.orb) Live.orb.feed('key');
    return wait(ch === ' ' ? 60 + Math.random() * 60 : 22 + Math.random() * 34).then(function (ok) { return ok ? next() : false; });
  })();
}

// One turn of the agent: the steps, the answer, and its entry in the log.
function runTurn(ask, steps, entryInfo, at) {
  var entry = { title: 'Working on it', outcome: ask.length > 70 ? ask.slice(0, 69).trimEnd() + '…' : ask, at: at, steps: [], running: true };
  var message = null, bubble = null, hasEntry = false;
  setBusy(true);
  function ensureEntry() { if (!hasEntry) { hasEntry = true; S.log.push(entry); } renderLog(); }
  function finish(stopped) {
    setBusy(false); setActivity(null);
    entry.running = false;
    entry.steps.forEach(function (s) { s.going = false; });
    if (hasEntry) {
      if (stopped) { entry.title = 'Stopped'; entry.stopped = true; }
      else { entry.title = entryInfo.title; entry.outcome = entryInfo.outcome; entry.at = entryInfo.at; }
      renderLog();
      var first = $('#log details.entry'); if (first && !stopped) { first.classList.add('saved'); first.open = false; }
    }
    if (stopped) {
      if (!message) message = addMessage({ role: 'agent', at: at, parts: [] });
      message.appendChild(el('<div class="marker">Stopped</div>'));
      setMood('idle');
    } else {
      setMood('done');
      if (hasEntry) flashBanner($('#panel-banner'), 'Done!');
    }
    stickToEnd();
  }
  var i = 0;
  function step() {
    if (i >= steps.length) { finish(false); return Promise.resolve(true); }
    var st = steps[i++];
    if (st.think) { setMood('thinking'); setActivity('Thinking'); return wait(st.think).then(after); }
    if (st.tool) {
      var rec = { kind: st.tool.kind, text: st.tool.doing, out: st.tool.out, going: true };
      entry.steps.push(rec); ensureEntry();
      setMood('working', st.tool.kind); setActivity(st.tool.doing, st.tool.kind);
      return wait(st.ms).then(function (ok) {
        if (!ok) return false;
        rec.going = false; rec.text = st.tool.did;
        if (st.schedule && !S.schedules.some(function (s) { return s.id === D.newSchedule.id; })) S.schedules.unshift(Object.assign({}, D.newSchedule));
        if (st.remember) { S.memory = D.agent.memory + D.MEMORY_ADD; tickLcds(); }
        renderLog();
        return after(true);
      });
    }
    if (st.approve) {
      setMood('waiting'); setActivity(null);
      return showApproval(st.approve, st.ms).then(function (answer) {
        if (answer === null) return false;
        if (answer === 'deny') {
          steps = [{ stream: '<p>All right. The backup is running, but I did not set up the morning check.</p>' }]; i = 0;
          entryInfo = { title: 'Restarted the backup', outcome: 'The backup is running; no check was scheduled', at: entryInfo.at };
        }
        return after(true);
      });
    }
    if (st.stream) {
      setMood('speaking'); setActivity(null);
      message = addMessage({ role: 'agent', at: at, parts: [] }, true);
      bubble = el('<div class="bubble prose"></div>');
      message.appendChild(bubble);
      S.messages[S.messages.length - 1].parts.push({ html: st.stream });
      return streamInto(bubble, st.stream).then(after);
    }
    return after(true);
  }
  function after(ok) { return ok ? step() : false; }
  Demo.stop = function () { Demo.token++; if (approvalDone) approvalDone(null); finish(true); Demo.playing = false; Demo.finished = true; paintDemo(); };
  return step();
}

function playDemo() {
  resetChat();
  Demo.playing = true; paintDemo();
  var sc = D.script;
  return wait(2600).then(function (ok) {
    if (!ok) return false;
    return typeDraft(sc.ask);
  }).then(function (ok) {
    if (!ok) return false;
    return wait(420);
  }).then(function (ok) {
    if (!ok) return false;
    draft.value = ''; fitDraft();
    sendRing();
    addMessage({ role: 'user', at: sc.at, text: sc.ask }, true);
    return runTurn(sc.ask, sc.steps.slice(), sc.entry, sc.at);
  }).then(function (ok) {
    if (ok === false) return;
    Demo.playing = false; Demo.finished = true; paintDemo();
  });
}
function userSend(text) {
  // Anything the visitor sends takes over from the script.
  Demo.token++; Demo.playing = false; Demo.finished = true; Demo.paused = false; paintDemo();
  if (approvalDone) approvalDone(null);
  if (S.busy && Demo.stop) Demo.stop();
  sendRing();
  addMessage({ role: 'user', text: text }, true);
  var clock = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  runTurn(text, [{ think: 1500 }, { stream: D.cannedReply }], { title: '', outcome: '', at: clock }, clock);
}

/* ================================================================
   The composer
   ================================================================ */
var draft = $('#draft'), sendBtn = $('#btn-send');
function fitDraft() { draft.style.height = 'auto'; draft.style.height = Math.min(draft.scrollHeight, 200) + 'px'; }
function paintSend() {
  var ready = draft.value.trim() !== '' || S.attached.length > 0;
  var stop = S.busy && !ready;
  sendBtn.className = 'send' + (stop ? ' stop' : '');
  sendBtn.innerHTML = ic(stop ? 'stop' : 'up');
  sendBtn.setAttribute('aria-label', stop ? 'Stop' : 'Send');
  sendBtn.disabled = !stop && !ready;
}
function sendRing() {
  if (calm()) return;
  var r = sendBtn.getBoundingClientRect(), ring = el('<span class="send-ring"></span>');
  ring.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;z-index:40';
  document.body.appendChild(ring);
  setTimeout(function () { ring.remove(); }, 600);
}
var listenTimer = 0;
draft.addEventListener('input', function (e) {
  fitDraft(); paintSend();
  if (!e.isTrusted) return;
  if (Demo.playing && !S.busy) { Demo.token++; Demo.playing = false; Demo.finished = true; paintDemo(); }
  if (!S.busy) {
    if (S.mood.state !== 'listening') setMood('listening');
    if (Live.orb) Live.orb.feed('key');
    clearTimeout(listenTimer);
    listenTimer = setTimeout(function () { if (S.mood.state === 'listening' && !Demo.playing) setMood('idle'); }, 1600);
  }
});
draft.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitDraft(); }
});
function submitDraft() {
  var ready = draft.value.trim() !== '' || S.attached.length > 0;
  if (!ready) { if (S.busy && Demo.stop) Demo.stop(); return; }
  var names = S.attached.join(', ');
  var text = [draft.value.trim(), names ? 'Attached: ' + names : ''].filter(Boolean).join('\n\n');
  draft.value = ''; S.attached = []; paintChips(); fitDraft(); paintSend();
  clearTimeout(listenTimer);
  userSend(text);
}
$('#composer').addEventListener('submit', function (e) { e.preventDefault(); submitDraft(); });
function paintChips() {
  var host = $('#chips');
  host.hidden = !S.attached.length;
  host.innerHTML = S.attached.map(function (n, i) { return '<li class="chip"><span>' + esc(n) + '</span><button type="button" data-i="' + i + '" aria-label="Remove ' + esc(n) + '">' + ic('x') + '</button></li>'; }).join('');
}
$('#chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; S.attached.splice(+b.dataset.i, 1); paintChips(); paintSend(); });
$('#btn-attach').addEventListener('click', function () { $('#file-pick').click(); });
$('#file-pick').addEventListener('change', function (e) {
  Array.prototype.forEach.call(e.target.files || [], function (f) { S.attached.push(f.name); });
  e.target.value = ''; paintChips(); paintSend(); draft.focus();
});
$('#btn-mic').addEventListener('click', function () {
  var on = this.getAttribute('aria-pressed') !== 'true';
  this.setAttribute('aria-pressed', String(on));
  this.setAttribute('aria-label', on ? 'Stop dictating' : 'Dictate');
  if (!S.busy) setMood(on ? 'listening' : 'idle');
  if (on) toast('Dictation is only acted out here. In the app, what you say is typed into the box.');
});
thread.addEventListener('click', function (e) { if (e.target.closest('.filecard')) toast('In the app this downloads the file. It is also kept in the Library.'); });

function flashBanner(node, text) {
  if (!node || calm()) return;
  node.textContent = text; node.classList.remove('go'); void node.offsetWidth; node.classList.add('go');
}
var toastTimer = 0;
function toast(text) {
  var t = $('#toast'); t.textContent = text; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 3600);
}

/* ================================================================
   Navigation: the rail, the chat list, the sheet, the agent switcher
   ================================================================ */
function railHtml() {
  $('#rail-pages').innerHTML = D.nav.map(function (n) {
    return '<button type="button" class="bubble-btn" data-go="' + n[0] + '" data-tip="' + n[1] + '" aria-label="' + n[1] + '">' + ic(n[2]) + '</button>';
  }).join('');
  $('#rail-end').innerHTML =
    '<button type="button" class="bubble-btn" data-go="settings" data-tip="Settings" aria-label="Settings">' + ic('sliders') + '</button>' +
    '<button type="button" class="bubble-btn" id="theme-btn" data-tip="" aria-label="">' + ic('moon') + '</button>' +
    '<button type="button" class="bubble-btn" id="signout-btn" data-tip="Sign out" aria-label="Sign out">' + ic('out') + '</button>';
}
function paintNav() {
  $$('[data-go]').forEach(function (b) {
    var on = b.dataset.go === S.view;
    if (b.classList.contains('bubble-btn') || b.classList.contains('sheet-page')) { if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  });
  var chatBtn = $('#rail-pages [data-go="chat"]');
  if (chatBtn) { var tip = S.view !== 'chat' ? 'Chats' : S.listOpen ? 'Hide chats' : 'Show chats'; chatBtn.dataset.tip = tip; chatBtn.setAttribute('aria-label', tip); }
  var next = S.theme === 'night' ? 'day' : 'night';
  $$('#theme-btn, #sheet-theme').forEach(function (b) {
    var label = 'Switch to ' + (next === 'day' ? 'light' : 'dark') + ' theme';
    if (b.id === 'theme-btn') { b.dataset.tip = label; b.innerHTML = ic(next === 'day' ? 'sun' : 'moon'); }
    b.setAttribute('aria-label', label);
  });
}
function chatsHtml(idp) {
  return '<div class="chats-top"><h2 class="tab"><span class="flag" aria-hidden="true"></span>Chats</h2>' +
    '<button type="button" class="capsule round" data-act="new-chat" aria-label="New chat" title="New chat">' + ic('pencil') + '</button></div>' +
    '<label class="search">' + ic('search') + '<span class="sr">Search chats</span><input type="search" placeholder="Search" id="' + idp + '-search"></label>' +
    '<nav class="chat-list" aria-label="Chats" id="' + idp + '-list"></nav>';
}
function paintChatList(idp) {
  var host = $('#' + idp + '-list'); if (!host) return;
  var q = ($('#' + idp + '-search').value || '').trim().toLowerCase();
  var rows = S.chats.map(function (t, i) { return { t: t, i: i }; }).filter(function (c) { return !q || c.t.toLowerCase().indexOf(q) >= 0; });
  host.innerHTML = rows.length ? rows.map(function (c) {
    return '<div class="chat-row"><button type="button" class="chat-link" data-chat="' + c.i + '"' + (c.i === S.activeChat ? ' aria-current="page"' : '') + '><i class="cursor" aria-hidden="true"></i><span>' + esc(c.t) + '</span></button>' +
      '<button type="button" class="icon-btn" data-archive="' + c.i + '" aria-label="Archive ' + esc(c.t) + '">' + ic('archive') + '</button></div>';
  }).join('') : '<p class="chat-empty">' + (q ? 'Nothing matches.' : 'No chats yet.') + '</p>';
}
function paintChats() { paintChatList('side'); paintChatList('sheet'); $('#chat-title-text').textContent = S.chats[S.activeChat] || 'New chat'; }
function chatListEvents(root) {
  root.addEventListener('input', function (e) { if (e.target.type === 'search') paintChats(); });
  root.addEventListener('click', function (e) {
    var link = e.target.closest('[data-chat]'), arch = e.target.closest('[data-archive]'), act = e.target.closest('[data-act="new-chat"]');
    if (link) {
      var i = +link.dataset.chat;
      if (i !== S.activeChat) toast('Only “' + S.chats[0] + '” has a conversation in this prototype.');
      closeSheet(); go('chat');
    } else if (arch) {
      var gone = S.chats.splice(+arch.dataset.archive, 1)[0];
      if (S.activeChat >= S.chats.length) S.activeChat = 0;
      paintChats(); toast('Archived “' + gone + '”.');
    } else if (act) { toast('In the app this starts an empty chat with ' + S.name + '.'); }
  });
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var links = $$('.chat-link', root), at = links.indexOf(document.activeElement);
    if (!links.length) return;
    e.preventDefault();
    links[clamp(at < 0 ? 0 : at + (e.key === 'ArrowDown' ? 1 : -1), 0, links.length - 1)].focus();
  });
}
function setList(open, focus) {
  S.listOpen = open;
  $('#chats').hidden = !open;
  $('#btn-chats').setAttribute('aria-expanded', String(open));
  paintNav(); paintHints();
  requestAnimationFrame(function () { sizeLive(); paintSkies(); });
  if (open && focus) { var cur = $('#side-list [aria-current]') || $('#side-search'); if (cur) cur.focus(); }
}

function sheetHtml() {
  var pages = [['agent', 'Identity', 'person'], ['library', 'Library', 'folder'], ['automations', 'Automations', 'clock'], ['skills', 'Skills', 'bolt'],
    ['connectors', 'Connectors', 'plug'], ['computers', 'Computers', 'monitor'], ['permissions', 'Permissions', 'shield'], ['settings', 'Settings', 'sliders']];
  $('#navsheet').innerHTML =
    '<div class="sheet-head"><button type="button" class="rail-agent" id="sheet-agent" aria-label="Switch agent"><img data-still="agent" alt=""></button>' +
    '<div style="min-width:0;flex:1"><p class="name" data-agent-name></p><p class="tagline" data-agent-tagline></p></div>' +
    '<button type="button" class="icon-btn" id="sheet-close" aria-label="Close">' + ic('x') + '</button></div>' +
    '<div class="sheet-card"><span class="lcd"><canvas id="sheet-lcd" role="img" aria-label="Memory card"></canvas></span><div style="min-width:0"><p class="label">Memory</p><p style="font-weight:700"><span id="sheet-blocks"></span> of 200 blocks</p><p class="muted" style="font-size:12.5px">Day ' + D.agent.day + ' · hatched ' + D.agent.hatchedOn + '</p></div></div>' +
    '<nav class="sheet-pages" aria-label="Pages">' + pages.map(function (p) { return '<button type="button" class="sheet-page" data-go="' + p[0] + '">' + ic(p[2]) + '<span>' + p[1] + '</span></button>'; }).join('') + '</nav>' +
    '<div class="sheet-chats">' + chatsHtml('sheet') + '</div>' +
    '<div class="sheet-foot"><button type="button" class="btn quiet small" id="sheet-theme">' + ic('moon') + '<span>Theme</span></button>' +
    '<button type="button" class="btn quiet small" id="sheet-about">' + ic('info') + 'Prototype</button>' +
    '<button type="button" class="btn quiet small" id="sheet-signout" style="margin-left:auto">' + ic('out') + 'Sign out</button></div>';
}
var lastFocus = null;
function openSheet() {
  lastFocus = document.activeElement;
  S.sheet = true; $('#navsheet').classList.add('on'); $('#navsheet').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on'); $('#app').inert = true;
  $('#sheet-close').focus();
}
function closeSheet() {
  if (!S.sheet) return;
  S.sheet = false; $('#navsheet').classList.remove('on'); $('#navsheet').setAttribute('aria-hidden', 'true'); $('#app').inert = false;
  $('#scrim').classList.remove('on');
  if (lastFocus && lastFocus.isConnected) lastFocus.focus();
}
function setDrawer(open) {
  if (mqWide.matches) return;
  S.drawer = open;
  $('#panel').classList.toggle('on', open);
  $('#drawer-scrim').classList.toggle('on', open);
  if (open) { lastFocus = document.activeElement; }
  placeLive();
  requestAnimationFrame(function () { paintSkies(); sizeLive(); });
  if (open) $('#btn-hide-panel').focus(); else if (lastFocus && lastFocus.isConnected) lastFocus.focus();
}
function paintPanel() {
  var beside = mqWide.matches && S.panelOpen;
  $('#view-chat').classList.toggle('no-panel', !S.panelOpen);
  $('#agent-pill').hidden = beside;
  $('#chat-title').hidden = !beside;
  var name = S.name;
  $('#agent-pill').setAttribute('aria-label', mqWide.matches ? 'Show ' + name + ' beside the chat' : 'About ' + name + ': what it is doing and what it did here');
  if (mqWide.matches) { S.drawer = false; $('#panel').classList.remove('on'); $('#drawer-scrim').classList.remove('on'); }
  placeLive();
  requestAnimationFrame(function () { paintSkies(); sizeLive(); });
}

// the agent switcher, as save slots
function agentPop(anchor) {
  var pop = $('#agent-pop');
  if (!pop.hidden) { closePops(); return; }
  pop.innerHTML = '<p class="tab"><span class="flag" aria-hidden="true"></span>Your agents</p>' +
    '<button type="button" class="pop-item" role="menuitem" data-pick="juniper"><span class="lcd"><canvas id="pop-lcd" aria-hidden="true"></canvas></span><span><b>' + esc(S.name) + '</b><small>Day ' + D.agent.day + ' · ' + blocks(S.memory) + ' of 200 blocks</small></span><i class="cursor" aria-hidden="true"></i></button>' +
    '<hr><button type="button" class="pop-item" role="menuitem" data-pick="new"><span class="egg-thumb">' + ic('plus') + '</span><span><b>New agent</b><small>Starts as an egg</small></span></button>';
  pop.hidden = false;
  portraitLcd($('#pop-lcd'), function () { return S.look.seed; }, function () { return S.look.color; });
  var r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.right + 12, innerWidth - 270) + 'px';
  pop.style.top = (mqPhone.matches ? r.bottom + 8 : r.top) + 'px';
  if (mqPhone.matches) pop.style.left = '12px';
  $('#rail-agent').setAttribute('aria-expanded', 'true');
  $('.pop-item', pop).focus();
}
function closePops() {
  $('#agent-pop').hidden = true; $('#proto-menu').hidden = true;
  $('#rail-agent').setAttribute('aria-expanded', 'false'); $('#tour-btn').setAttribute('aria-expanded', 'false');
}
$('#agent-pop').addEventListener('click', function (e) {
  var b = e.target.closest('[data-pick]'); if (!b) return;
  closePops(); closeSheet();
  go(b.dataset.pick === 'new' ? 'hatch' : 'chat');
});

/* ================================================================
   Views
   ================================================================ */
var VIEW_EL = { chat: 'view-chat', hatch: 'view-hatch', agent: 'view-agent' };
function viewEl(v) { return $('#' + (VIEW_EL[v] || 'view-page')); }
var loadTimer = 0;
function go(view, quick) {
  if (!D.pages[view] && !VIEW_EL[view]) view = 'chat';
  if (view === S.view && !quick) { if (view === 'chat' && !mqPhone.matches && S.viewReady) setList(!S.listOpen, true); return; }
  var from = S.view;
  if (from === 'hatch' && view !== 'hatch') leaveHatch();
  S.view = view; S.viewReady = true;
  closePops();
  if (S.drawer) setDrawer(false);
  $$('.view').forEach(function (v) { v.hidden = true; v.classList.remove('enter'); });
  Demo.away = view !== 'chat';
  var node = viewEl(view);
  if (view === 'agent') renderAgent();
  else if (view === 'hatch') renderHatch();
  else if (view !== 'chat') renderPage(view);
  $('#chats').hidden = !(S.listOpen && view === 'chat');
  function show() {
    node.hidden = false;
    if (!calm() && !quick) node.classList.add('enter');
    paintNav(); paintHints();
    if (view === 'chat') { paintPanel(); stickToEnd(true); if (Live.orb) Live.orb.setState(S.mood.state, S.mood.variant); }
    else { placeLive(); if (Live.orb && view === 'agent') Live.orb.setState('idle'); }
    paintSkies(); refreshNames(); paintNow(); tickLcds();
    if (view === 'hatch') enterHatch();
    document.title = (view === 'chat' ? S.chats[S.activeChat] : view === 'agent' ? 'Identity and memory' : view === 'hatch' ? 'New agent' : D.pages[view].title) + ' · durable computer';
    if (!quick && from !== view) {
      var h = view === 'chat' ? (mqPhone.matches ? null : draft) : node.querySelector('h1');
      if (h) { if (h !== draft) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }
  var hash = '#' + view;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  clearTimeout(loadTimer);
  paintNav(); paintHints();
  if (quick || calm()) { $('#loading').classList.remove('on'); show(); return; }
  // the loading moment: brief, and never in the way of the keyboard
  mountLive(null);
  $('#loading').classList.add('on');
  loadTimer = setTimeout(function () { $('#loading').classList.remove('on'); show(); }, 300);
}
function refreshNames() {
  $$('[data-agent-name]').forEach(function (n) { n.textContent = S.name; });
  $$('[data-agent-tagline]').forEach(function (n) { n.textContent = S.tagline; });
  draft.placeholder = 'Message ' + S.name;
  $('#panel').setAttribute('aria-label', 'About ' + S.name);
}
function pageShell(id, inner) {
  var p = D.pages[id];
  return '<div class="win pagewin"><div class="page">' +
    '<div class="page-top"><button type="button" class="capsule round only-phone" data-act="menu" aria-label="Menu">' + ic('list') + '</button>' +
    '<a class="back" href="#chat" data-go="chat">' + ic('left') + 'Back to chat</a></div>' +
    '<header class="page-head"><span class="page-ico" aria-hidden="true">' + ic(p.icon) + '</span><div class="page-head-text"><h1 class="page-title">' + p.title + '</h1>' +
    '<p class="page-desc">' + esc(p.desc) + '</p></div></header><div class="checker-rule" aria-hidden="true"></div>' + inner + '</div></div>';
}
function dial(hm) {
  var h = (hm[0] % 12 + hm[1] / 60) * 30, m = hm[1] * 6, ticks = '';
  for (var i = 0; i < 12; i++) { var a = i * 30 * Math.PI / 180, r0 = i % 3 ? 21 : 19; ticks += '<line class="tick" x1="' + (29 + r0 * Math.sin(a)).toFixed(1) + '" y1="' + (29 - r0 * Math.cos(a)).toFixed(1) + '" x2="' + (29 + 23 * Math.sin(a)).toFixed(1) + '" y2="' + (29 - 23 * Math.cos(a)).toFixed(1) + '"/>'; }
  return '<svg class="dial" viewBox="0 0 58 58" aria-hidden="true"><circle class="face" cx="29" cy="29" r="26.500"/>' + ticks +
    '<line class="hand" x1="29" y1="29" x2="29" y2="16" transform="rotate(' + h + ' 29 29)"/><line class="hand m" x1="29" y1="29" x2="29" y2="9.500" transform="rotate(' + m + ' 29 29)"/><circle class="hub" cx="29" cy="29" r="3"/></svg>';
}
function scheduleStatus(s) {
  if (s.running) return ['Running', 'run'];
  if (s.enabled && s.next) return ['Active', 'on'];
  return s.done ? ['Done', ''] : ['Paused', ''];
}
function renderPage(id) {
  var node = $('#view-page'), body = '';
  node.setAttribute('aria-label', D.pages[id].title);
  if (id === 'automations') {
    body = S.schedules.length ? '<ul class="cards">' + S.schedules.map(function (s) {
      var st = scheduleStatus(s);
      return '<li class="acard' + (st[0] === 'Paused' || st[0] === 'Done' ? ' is-off' : '') + '" data-id="' + s.id + '">' + dial(s.hm) + '<div>' +
        '<div class="acard-head"><h2>' + esc(s.title) + '</h2><span style="display:flex;gap:6px">' + (s.fresh ? '<span class="lamp new">New</span>' : '') + '<span class="lamp ' + st[1] + '">' + st[0] + '</span></span></div>' +
        '<p class="acard-when"><code>' + esc(s.cron) + '</code>' + (s.enabled && s.next ? ' · next ' + s.next : '') + '</p>' +
        '<p class="acard-prompt">' + esc(s.prompt) + '</p>' +
        (s.last ? '<p class="acard-last">Last run ' + s.last.when + ': ' + s.last.outcome + '. <a href="#chat" data-act="view-run">View run</a></p>' : '') +
        '<div class="acard-actions">' + (s.done ? '' : '<button type="button" class="btn small" data-act="toggle">' + ic(s.enabled ? 'pause' : 'play') + (s.enabled ? 'Pause' : 'Resume') + '</button>') +
        '<button type="button" class="btn small" data-act="run"' + (s.running ? ' disabled' : '') + '>' + ic('clock') + 'Run now</button>' +
        '<button type="button" class="btn quiet small danger push" data-act="delete" aria-label="Delete ' + esc(s.title) + '">' + ic('trash') + 'Delete</button></div></div></li>';
    }).join('') + '</ul>' : '<p class="empty">Nothing scheduled yet.</p>';
  } else if (id === 'library') {
    body = '<div class="meter"><span class="fact"><b>' + D.files.length + '</b> files</span><span class="fact"><b>552 KB</b> kept</span><span style="flex:1"></span>' +
      '<button type="button" class="btn" data-act="upload">' + ic('upload') + 'Upload</button></div>' +
      '<ul class="rows">' + D.files.map(function (f) {
        return '<li class="frow"><span class="ficon ' + f.ext + '" aria-hidden="true">' + f.ext + '</span><div class="frow-main"><p class="frow-name">' + esc(f.name) + '</p>' +
          '<p class="frow-meta">' + f.size + ' · ' + (f.source === 'agent' ? 'from your agent' : 'uploaded by you') + ' · ' + f.when + (f.chat ? ' · <a href="#chat" data-go="chat">chat</a>' : '') + '</p></div>' +
          '<button type="button" class="icon-btn" data-act="download" aria-label="Download ' + esc(f.name) + '">' + ic('down') + '</button>' +
          '<button type="button" class="icon-btn" data-act="remove" aria-label="Delete ' + esc(f.name) + '">' + ic('trash') + '</button></li>';
      }).join('') + '</ul>';
  } else if (id === 'skills') {
    body = '<form class="dashed" data-act="noop"><div class="field"><label for="skill-url">Install a skill</label><div style="display:flex;gap:8px"><input class="input" id="skill-url" placeholder="https://github.com/…" aria-label="Skill URL"><button type="button" class="btn" data-act="noop">Install</button></div>' +
      '<p class="hint">A GitHub folder containing a SKILL.md, or a direct link to one. A skill is instructions your agent follows, so install only what you trust.</p></div></form>' +
      '<ul class="rows">' + D.skills.map(function (s, i) {
        return '<li class="frow"><span class="ficon" style="--fc:' + (s.source === 'Built in' ? '#33496e' : s.source === 'Installed' ? '#6a48e0' : '#1259d6') + '" aria-hidden="true">' + ic('bolt') + '</span><div class="frow-main"><p class="frow-name mono">' + s.name + '</p>' +
          '<p class="frow-meta">' + s.source + (s.note ? ' · ' + s.note : '') + '</p></div><label class="switch"><input type="checkbox"' + (s.on ? ' checked' : '') + ' aria-label="' + s.name + ' enabled"><i aria-hidden="true"></i></label></li>';
      }).join('') + '</ul>';
  } else if (id === 'connectors') {
    body = '<ul class="rows">' + D.connectors.map(function (c) {
      return '<li class="frow"><span class="ficon" style="--fc:#0e8ea1" aria-hidden="true">' + ic('plug') + '</span><div class="frow-main"><p class="frow-name">' + c.name + '</p><p class="frow-meta">' + c.url + ' · ' + c.note + '</p></div>' +
        '<span class="lamp ' + (c.state === 'Connected' ? 'on' : 'warn') + '">' + c.state + '</span>' + (c.state === 'Connected' ? '' : '<button type="button" class="btn small primary" data-act="noop">Sign in</button>') + '</li>';
    }).join('') + '</ul>' +
      '<section class="dashed"><h2 class="section-title"><span class="flag" aria-hidden="true"></span>Add a connector</h2><div class="field"><label for="c-name">Name</label><input class="input" id="c-name" placeholder="Calendar"></div>' +
      '<div class="field"><label for="c-url">Server address</label><input class="input" id="c-url" placeholder="https://…/mcp"><p class="hint">Leave the token empty for a service you sign in to. A token is kept on the server and never shown to your agent.</p></div>' +
      '<div><button type="button" class="btn" data-act="noop">Add connector</button></div></section>';
  } else if (id === 'computers') {
    body = '<ul class="rows">' + D.computers.map(function (c) {
      return '<li class="frow"><span class="ficon" style="--fc:#33496e" aria-hidden="true">' + ic('monitor') + '</span><div class="frow-main"><p class="frow-name mono">' + c.name + '</p><p class="frow-meta">' + c.meta + '</p><p class="frow-meta">' + c.note + '</p></div>' +
        '<span class="lamp ' + (c.online ? 'on' : '') + '">' + (c.online ? 'Online' : 'Offline') + '</span></li>';
    }).join('') + '</ul>' +
      '<section class="dashed"><h2 class="section-title"><span class="flag" aria-hidden="true"></span>Connect a computer</h2><p>Run this on the computer (macOS or Linux, with Node.js 20 or newer):</p>' +
      '<div class="cmd">curl -fsSL https://durable.example/install.sh | sh</div><p>Or let the agent read files there without being able to run commands or change anything:</p>' +
      '<div class="cmd">curl -fsSL https://durable.example/install.sh | sh -s -- --read-only</div>' +
      '<p class="muted">It prints a link. Open it here to choose which agent gets access. Stopping the daemon, or removing the computer on this page, ends that access at once.</p></section>';
  } else if (id === 'permissions') {
    body = D.permissions.map(function (g, gi) {
      return '<section><h2 class="section-title" style="margin-bottom:6px"><span class="flag" aria-hidden="true"></span>' + g.title + '</h2><ul>' + g.rows.map(function (r, ri) {
        var idx = 'perm-' + gi + '-' + ri;
        return '<li class="prow"><div><span id="' + idx + '">' + r.label + '</span>' + (r.hint ? '<small>' + r.hint + '</small>' : '') + '</div><div class="seg" role="radiogroup" aria-labelledby="' + idx + '">' +
          [['allow', 'Allow'], ['ask', 'Ask first'], ['deny', 'Never']].map(function (c) { return '<button type="button" role="radio" aria-checked="' + (r.rule === c[0]) + '" data-rule="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div></li>';
      }).join('') + '</ul></section>';
    }).join('');
  } else if (id === 'settings') {
    body = '<section class="field"><h2 class="section-title"><span class="flag" aria-hidden="true"></span>Default model</h2><p class="hint">The model a new agent starts on. Agents you already have keep theirs; change one on its own page.</p>' +
      '<select class="select" aria-label="Default model">' + D.models.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select>' +
      '<p class="hint">This is the server’s default. Pick another to make it yours.</p></section>';
  }
  node.innerHTML = pageShell(id, body);
}
$('#view-page').addEventListener('click', function (e) {
  var act = e.target.closest('[data-act]'), rule = e.target.closest('[data-rule]');
  if (rule) { $$('[role="radio"]', rule.parentNode).forEach(function (b) { b.setAttribute('aria-checked', String(b === rule)); }); return; }
  if (!act) return;
  var card = e.target.closest('.acard'), s = card && S.schedules.filter(function (x) { return x.id === card.dataset.id; })[0];
  switch (act.dataset.act) {
    case 'toggle': s.enabled = !s.enabled; s.next = s.enabled ? (s.next || D.schedules.concat(D.newSchedule).filter(function (x) { return x.id === s.id; })[0].next || 'Sat, Oct 3, 6:00 PM') : null; rerender('toggle'); break;
    case 'run': s.running = true; rerender('run'); setTimeout(function () { s.running = false; s.last = { when: 'Sat, Oct 3, ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), outcome: 'had nothing to report' }; if (S.view === 'automations') rerender('run'); }, 3200); break;
    case 'delete': S.schedules.splice(S.schedules.indexOf(s), 1); rerender(); break;
    case 'view-run': e.preventDefault(); toast('In the app this opens the chat that the scheduled run wrote.'); break;
    case 'upload': toast('In the app this adds a file to the library, where your agent can reach it.'); break;
    case 'download': toast('In the app this downloads the file.'); break;
    case 'remove': e.target.closest('.frow').remove(); break;
    case 'noop': e.preventDefault(); toast('Not wired up in this prototype.'); break;
  }
  function rerender(focusAct) {
    var id = card.dataset.id, top = $('.pagewin', $('#view-page')).scrollTop;
    renderPage('automations');
    $('.pagewin', $('#view-page')).scrollTop = top;
    if (focusAct) { var b = $('#view-page .acard[data-id="' + id + '"] [data-act="' + focusAct + '"]'); if (b) b.focus(); }
  }
});

/* ---------- Identity and memory, as a character sheet ---------- */
var TABS = [['status', 'Status'], ['soul', 'Personality'], ['user', 'About you'], ['memory', 'Memory'], ['model', 'Model'], ['usage', 'Usage']];
var agentTab = 'status';
function blockMap(used, total, cls, fresh) {
  var out = '';
  for (var i = 0; i < Math.max(total, used); i++) out += '<i class="' + (i < used ? 'on' : '') + (fresh && i >= fresh[0] && i < fresh[1] ? ' fresh' : '') + '"></i>';
  return '<div class="blockmap ' + cls + (used > total ? ' over' : '') + '" aria-hidden="true">' + out + '</div>';
}
function statusPanel() {
  var mem = blocks(S.memory), you = blocks(S.user), g = AgentOrb ? AgentOrb.makeGenome(S.look.seed) : null;
  var active = S.schedules.filter(function (s) { return s.enabled && s.next; }).length;
  function pips(list) { return list.map(function (p) { return '<i style="--pc:' + p + '"></i>'; }).join(''); }
  function rep(n, c) { var a = []; for (var i = 0; i < n; i++) a.push(c); return a; }
  var skillPips = D.skills.map(function (s) { return s.source === 'Built in' ? 'var(--ink3)' : s.source === 'Installed' ? 'var(--violet)' : 'var(--azure)'; });
  var rows = [
    ['Skills', pips(skillPips), D.skills.length, '3 built in, 3 it wrote, 1 installed'],
    ['Automations', pips(S.schedules.map(function (s) { return s.enabled && s.next ? 'var(--lime)' : 'var(--ink3)'; })), S.schedules.length, active + ' active'],
    ['Connectors', pips(['var(--lime)', 'var(--sun)']), 2, '1 needs sign-in'],
    ['Computers', pips(['var(--azure)', 'var(--lime)', 'var(--ink3)']), 3, 'its own, workshop, fern'],
    ['Files', pips(rep(D.files.length, 'var(--azure)')), D.files.length, 'in the library'],
    ['Chats', pips(rep(S.chats.length, 'var(--azure)')), S.chats.length, '']
  ];
  var temper = '';
  if (g) {
    var bars = [
      ['Tempo', (g.tempo - 0.86) / 0.32, g.tempo > 1.08 ? 'quick' : g.tempo < 0.94 ? 'slow' : 'even'],
      ['Bounce', 1 - (g.bounce - 0.32) / 0.23, g.bounce < 0.4 ? 'bouncy' : g.bounce > 0.48 ? 'composed' : 'springy'],
      ['Restless', (g.restless - 0.8) / 0.55, g.restless > 1.15 ? 'fidgety' : g.restless < 0.95 ? 'still' : 'easy'],
      ['Blink', 1 - (g.blinkEvery - 2.4) / 3.2, 'every ' + g.blinkEvery.toFixed(1) + ' s']
    ];
    var look = AgentOrb.describeGenome(g, true).filter(function (r) { return ['eyes', 'body', 'on top', 'tail', 'markings', 'egg'].indexOf(r[0]) >= 0; });
    temper = '<section><div class="stat-h"><h3 class="tab"><span class="flag" aria-hidden="true"></span>Temper</h3><span class="label">Grown from its seed, not chosen</span></div><div class="bars">' +
      bars.map(function (b) { return '<div class="bar-row"><span class="pname" style="font:italic 800 15.5px/1 var(--f-display);letter-spacing:.06em;text-transform:uppercase">' + b[0] + '</span><span class="bar" role="img" aria-label="' + b[0] + ': ' + b[2] + '"><i style="--v:' + Math.round(clamp(b[1], 0.06, 1) * 100) + '%"></i></span><span class="bval">' + b[2] + '</span></div>'; }).join('') +
      '</div><div class="traits" style="margin-top:12px">' + look.map(function (r) { return '<span class="fact">' + r[0] + ' <b>' + esc(r[1]) + '</b></span>'; }).join('') + '</div></section>';
  }
  return '<section><div class="statgrid">' +
    '<div><div class="stat-h"><h3 class="tab"><span class="flag" aria-hidden="true"></span>Memory</h3><span class="label">' + BLOCK + ' characters a block</span></div>' + blockMap(mem, 200, 'mem') +
    '<p class="stat-cap"><b>' + mem + '</b> of 200 blocks · ' + S.memory.length.toLocaleString('en') + ' / 2,200 characters</p></div>' +
    '<div><div class="stat-h"><h3 class="tab"><span class="flag" aria-hidden="true"></span>About you</h3></div>' + blockMap(you, 125, 'you') +
    '<p class="stat-cap"><b>' + you + '</b> of 125 blocks · ' + S.user.length.toLocaleString('en') + ' / 1,375 characters</p></div></div></section>' +
    '<section><div class="stat-h"><h3 class="tab"><span class="flag" aria-hidden="true"></span>What it has</h3></div><div class="pips">' +
    rows.map(function (r) { return '<div class="pip-row"><span class="pname">' + r[0] + '</span><span class="pnum">' + r[2] + '</span><span class="pset" aria-hidden="true">' + r[1] + '</span><span class="pnote">' + r[3] + '</span></div>'; }).join('') + '</div></section>' + temper;
}
function countedPanel(key, title, hint, limit, rows) {
  var text = S[key], total = Math.round(limit / BLOCK);
  return '<section class="field"><label for="f-' + key + '">' + title + '</label><p class="hint">' + hint + '</p>' +
    '<textarea class="textarea mono" id="f-' + key + '" rows="' + rows + '" data-bind="' + key + '" data-limit="' + limit + '">' + esc(text) + '</textarea>' +
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap"><div id="map-' + key + '" style="flex:1;min-width:200px">' + blockMap(blocks(text), total, key === 'user' ? 'you' : 'mem') + '</div>' +
    '<p class="count' + (text.length > limit ? ' over' : '') + '" id="count-' + key + '">' + text.length.toLocaleString('en') + ' / ' + limit.toLocaleString('en') + '</p></div></section>';
}
function tabPanel(id) {
  switch (id) {
    case 'status': return statusPanel();
    case 'soul': return '<section class="field"><label for="f-soul">Personality</label><p class="hint">How the agent talks and behaves, written to it in the second person.</p><textarea class="textarea" id="f-soul" rows="12" data-bind="soul" maxlength="4000" placeholder="You are…">' + esc(S.soul) + '</textarea></section>';
    case 'user': return countedPanel('user', 'About you', 'What the agent knows about you. It reads this in every conversation, one entry per line.', D.limits.user, 9);
    case 'memory': return countedPanel('memory', 'Memory', 'The agent’s own long-term notes, also read in every conversation.', D.limits.memory, 14);
    case 'model': return '<section class="field"><label for="f-model">Model</label><p class="hint">Which model this agent thinks with. Applies from its next reply. New agents start on your default, which is under Settings.</p>' +
      '<select class="select" id="f-model" data-bind="model">' + D.models.map(function (m) { return '<option' + (m === S.model ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></section>';
    case 'usage': var u = D.usage; return '<section class="field"><span class="flabel">Usage</span><p class="hint">What this agent’s thinking has cost so far, across its chats and scheduled runs.</p>' +
      '<div class="usage"><div><span class="label">Cost</span><b>' + u.cost + '</b></div><div><span class="label">Read</span><b>' + u.read + '</b></div><div><span class="label">Written</span><b>' + u.written + '</b></div></div>' +
      '<table class="table"><caption class="sr">Usage by model</caption><thead><tr><th>Model</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead><tbody>' +
      u.rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td></tr>'; }).join('') + '</tbody></table><p class="hint">' + u.scheduled + '</p></section>';
  }
  return '';
}
function renderAgent() {
  var node = $('#view-agent');
  node.innerHTML = '<div class="win agentwin" style="height:100%;overflow:hidden"><div class="agent-grid">' +
    '<div class="agent-side"><div class="page-top"><button type="button" class="capsule round only-phone" data-act="menu" aria-label="Menu">' + ic('list') + '</button><a class="back" href="#chat" data-go="chat">' + ic('left') + 'Back to chat</a></div>' +
    '<div class="stage">' + stageHtml('agent', '<div class="stage-banner" id="agent-banner" aria-hidden="true"></div>') + '</div>' +
    '<div><h1 class="name" data-agent-name></h1><p class="tagline" style="white-space:normal;font-size:14px;margin-top:6px" data-agent-tagline></p></div>' +
    '<div class="facts"><span class="fact">Hatched <b>' + D.agent.hatchedOn + '</b></span><span class="fact">Day <b>' + D.agent.day + '</b></span><span class="fact">Seed <b class="mono" id="seed-fact"></b></span></div>' +
    '<div class="field"><span class="flabel">Look</span><p class="hint">Its shape and face were not chosen: they grew from a roll of the dice. Pick its color, or roll again for a different creature.</p>' +
    '<div class="swatches" role="group" aria-label="Color">' + Object.keys(PALETTE).map(function (c) { return '<button type="button" class="swatch" data-color="' + c + '" aria-label="' + COLOR_LABEL[c] + '" title="' + COLOR_LABEL[c] + '" aria-pressed="false"><i style="--sw:' + PALETTE[c] + '"></i></button>'; }).join('') + '</div>' +
    '<div><button type="button" class="btn small" id="roll-btn">' + ic('dice') + 'Roll a new look</button></div></div>' +
    '<div class="field"><label for="f-name">Name</label><input class="input" id="f-name" maxlength="40" placeholder="Not named yet" data-bind="name" value="' + esc(S.name) + '"></div>' +
    '<div class="field"><label for="f-tagline">Tagline</label><input class="input" id="f-tagline" maxlength="120" data-bind="tagline" value="' + esc(S.tagline) + '"></div></div>' +
    '<div class="agent-main"><div class="tabs" role="tablist" aria-label="Identity and memory">' + TABS.map(function (t) { return '<button type="button" role="tab" id="tab-' + t[0] + '" aria-controls="tabpanel" aria-selected="' + (t[0] === agentTab) + '" tabindex="' + (t[0] === agentTab ? 0 : -1) + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
    '<div class="tabs-rule"></div><div class="tabpanels"><div class="tabpanel" id="tabpanel" role="tabpanel" tabindex="0"></div></div>' +
    '<div class="savebar"><span class="muted" id="save-note" role="status"></span><button type="button" class="btn primary" id="save-btn" disabled>Save changes</button></div></div></div></div>';
  paintAgent();
}
function paintAgent() {
  var node = $('#view-agent'); if (!node.firstChild) return;
  $$('[data-color]', node).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.color === S.look.color)); });
  $('#seed-fact').textContent = S.look.seed;
  $$('[role="tab"]', node).forEach(function (t) { var on = t.dataset.tab === agentTab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
  var panel = $('#tabpanel'); panel.innerHTML = tabPanel(agentTab); panel.setAttribute('aria-labelledby', 'tab-' + agentTab);
  $('#save-btn').disabled = !S.dirty;
  var img = $('img[data-still="agent"]', node); if (img) img.src = still(S.look.seed, S.look.color);
}
function markDirty() { S.dirty = true; var b = $('#save-btn'); if (b) b.disabled = false; var n = $('#save-note'); if (n) n.textContent = ''; }
function setLook(seed, color) {
  S.look = { seed: seed, color: color };
  if (Live.orb) { Live.orb.setSeed(seed); Live.orb.setColor(PALETTE[color]); }
  refreshStills(); tickLcds();
}
$('#view-agent').addEventListener('click', function (e) {
  var sw = e.target.closest('[data-color]'), tab = e.target.closest('[data-tab]');
  if (sw) { setLook(S.look.seed, sw.dataset.color); markDirty(); paintAgent(); $('#view-agent [data-color="' + S.look.color + '"]').focus(); }
  else if (tab) { agentTab = tab.dataset.tab; paintAgent(); }
  else if (e.target.closest('#roll-btn')) {
    setLook(Math.random().toString(36).slice(2, 14), S.look.color); markDirty();
    if (Live.orb && !calm()) { Live.orb.sp.squash.v += 2.2; Live.orb.sp.lift.v += 1.6; }
    paintAgent(); $('#roll-btn').focus();
  } else if (e.target.closest('#save-btn')) {
    S.dirty = false; $('#save-btn').disabled = true; $('#save-note').textContent = 'Saved';
    if (Live.orb) Live.orb.setState('done');
    var st = $('#view-agent .stage'); st.classList.remove('is-done'); void st.offsetWidth; st.classList.add('is-done');
    flashBanner($('#agent-banner'), 'Saved!');
  }
});
$('#view-agent').addEventListener('keydown', function (e) {
  var tab = e.target.closest('[role="tab"]'); if (!tab || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
  var i = TABS.map(function (t) { return t[0]; }).indexOf(tab.dataset.tab);
  agentTab = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
  paintAgent(); $('#tab-' + agentTab).focus();
});
$('#view-agent').addEventListener('input', function (e) {
  var key = e.target.dataset.bind; if (!key) return;
  S[key] = e.target.value; markDirty();
  if (key === 'name' || key === 'tagline') { if (key === 'name' && !S.name.trim()) S.name = ''; refreshNames(); }
  if (Live.orb) Live.orb.feed('key');
  var limit = +e.target.dataset.limit;
  if (limit) {
    var c = $('#count-' + key); c.textContent = S[key].length.toLocaleString('en') + ' / ' + limit.toLocaleString('en'); c.classList.toggle('over', S[key].length > limit);
    $('#map-' + key).innerHTML = blockMap(blocks(S[key]), Math.round(limit / BLOCK), key === 'user' ? 'you' : 'mem');
  }
});

/* ---------- first run: the egg ---------- */
var GOOD_SEEDS = ['jn49pl', 'jn5ytb', 'jn6n97', 'jn549g', 'agt_d04e', 'jn1du2', 'jn2ehw', 'Pilar', 'jn3l9p', 'jn229y'];
function renderHatch() {
  $('#view-hatch').innerHTML = '<div class="win hatchwin">' +
    '<div class="slots"><div class="page-top" style="margin-bottom:2px"><button type="button" class="capsule round only-phone" data-act="menu" aria-label="Menu">' + ic('list') + '</button><h2 class="tab not-phone"><span class="flag" aria-hidden="true"></span>Your agents</h2></div>' +
    '<button type="button" class="slot" data-go="chat"><span class="lcd"><canvas id="slot-lcd-a" aria-hidden="true"></canvas></span><span><b data-agent-name></b><small>Day ' + D.agent.day + ' · ' + blocks(S.memory) + ' blocks</small></span></button>' +
    '<button type="button" class="slot" aria-current="true" id="slot-new"><span class="lcd"><canvas id="slot-lcd-b" aria-hidden="true"></canvas></span><span><b>New agent</b><small id="slot-new-note">In its egg · 0 blocks</small></span></button></div>' +
    '<div class="hatch-mid"><div class="hatch-scene">' +
    '<div class="stage" id="hatch-stage">' + stageHtml('hatch', '<div class="stage-banner" id="hatch-banner" aria-hidden="true"></div>') + '</div>' +
    '<h1 id="hatch-title">Say hello</h1><p id="hatch-copy">Your agent is brand new. It has no name yet. Start talking and work out together who it is.</p>' +
    '<div class="hatch-actions" id="hatch-actions"></div></div>' +
    '<div class="composer-wrap"><form class="composer" id="hatch-composer" autocomplete="off"><button class="icon-btn" type="button" aria-label="Attach a file" data-act="noop">' + ic('clip') + '</button>' +
    '<textarea id="hatch-draft" rows="1" aria-label="Message" placeholder="Say hello"></textarea><button class="send" type="submit" aria-label="Send" disabled>' + ic('up') + '</button></form></div></div>' +
    '<aside class="sheetcard" aria-label="The new agent"><h2 class="tab"><span class="flag" aria-hidden="true"></span>New agent</h2><dl class="kv" id="hatch-kv"></dl>' +
    '<p class="muted" style="font-size:13px">Its shape and face are not chosen: they grow from its seed. Its name, its color and who it is come later, in conversation.</p></aside></div>';
}
function paintHatch() {
  var h = S.hatch, out = h.phase === 'out', g = AgentOrb ? AgentOrb.makeGenome(h.seed) : null;
  var rows = [['Name', 'Not named yet'], ['Hatched', out ? 'Just now' : h.phase === 'hatching' ? 'Hatching…' : 'Not yet'], ['Seed', h.seed], ['Color', COLOR_LABEL[h.color]], ['Memory', '0 of 200 blocks']];
  var traits = out && g ? AgentOrb.describeGenome(g, true).filter(function (r) { return ['eyes', 'body', 'on top', 'tail', 'markings', 'temper'].indexOf(r[0]) >= 0; }) : [];
  $('#hatch-kv').innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') +
    traits.map(function (r, i) { return '<dt class="reveal" style="animation-delay:' + (i * 90) + 'ms">' + r[0] + '</dt><dd class="reveal" style="animation-delay:' + (i * 90) + 'ms">' + esc(r[1]) + '</dd>'; }).join('');
  $('#slot-new-note').textContent = out ? 'Day 1 · 0 blocks' : 'In its egg · 0 blocks';
  $('#hatch-actions').innerHTML = h.phase === 'hatching'
    ? '<button type="button" class="btn" data-act="skip" aria-label="Skip the hatching">Skip</button>'
    : h.phase === 'egg' ? '<button type="button" class="btn sun" data-act="hatch">' + ic('egg') + 'Hatch it now</button>'
    : '<button type="button" class="btn" data-act="again">' + ic('egg') + 'Hatch another egg</button><button type="button" class="btn quiet" data-go="chat">Back to ' + esc(S.name) + '</button>';
  paintNow(); tickLcds();
}
function enterHatch() {
  var h = S.hatch;
  h.seed = GOOD_SEEDS[Math.floor(Math.random() * GOOD_SEEDS.length)];
  var colors = Object.keys(PALETTE).filter(function (c) { return c !== S.look.color && c !== 'clay' && c !== h.color; });
  h.color = colors[Math.floor(Math.random() * colors.length)];
  h.phase = 'egg';
  if (Live.orb) { Live.orb.setSeed(h.seed); Live.orb.setColor(PALETTE[h.color]); Live.orb.setState('egg'); }
  else $('#view-hatch img[data-still="hatch"]').src = standIn(PALETTE[h.color]);
  portraitLcd($('#slot-lcd-a'), function () { return S.look.seed; }, function () { return S.look.color; });
  portraitLcd($('#slot-lcd-b'), function () { return S.hatch.seed; }, function () { return S.hatch.color; }, function () { return S.hatch.phase !== 'out'; });
  paintHatch();
  clearTimeout(h.timer);
  // As in the app: it sits in its egg for a moment, then hatches while its owner watches.
  h.timer = setTimeout(startHatch, 2200);
}
function startHatch() {
  var h = S.hatch;
  if (S.view !== 'hatch' || h.phase !== 'egg') return;
  clearTimeout(h.timer);
  h.phase = 'hatching'; paintHatch();
  if (!Live.orb) return hatched();
  Live.orb.reduced = calm();
  Live.orb.hatch({ onDone: hatched });
}
function hatched() {
  var h = S.hatch;
  if (S.view !== 'hatch' || h.phase === 'out') return;
  h.phase = 'out';
  portraits = {};
  paintHatch();
  flashBanner($('#hatch-banner'), 'It hatched!');
  var st = $('#hatch-stage'); st.classList.remove('is-done'); void st.offsetWidth; st.classList.add('is-done');
}
function leaveHatch() {
  clearTimeout(S.hatch.timer);
  if (Live.orb) {
    if (Live.orb.getState() === 'hatching') { Live.orb.onHatched = null; Live.orb.skipHatch(); }
    Live.orb.setSeed(S.look.seed); Live.orb.setColor(PALETTE[S.look.color]); Live.orb.setState('idle'); Live.orb.setState(S.mood.state, S.mood.variant);
  }
}
$('#view-hatch').addEventListener('click', function (e) {
  var act = e.target.closest('[data-act]'); if (!act) return;
  if (act.dataset.act === 'skip') { if (Live.orb) Live.orb.skipHatch(); else hatched(); }
  else if (act.dataset.act === 'hatch') startHatch();
  else if (act.dataset.act === 'again') { enterHatch(); var b = $('#hatch-actions button'); if (b) b.focus(); }
  else if (act.dataset.act === 'noop') toast('Not wired up in this prototype.');
});
$('#view-hatch').addEventListener('input', function (e) {
  if (e.target.id !== 'hatch-draft') return;
  e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  $('#hatch-composer .send').disabled = e.target.value.trim() === '';
  if (Live.orb && S.hatch.phase === 'out') { Live.orb.setState('listening'); Live.orb.feed('key'); clearTimeout(listenTimer); listenTimer = setTimeout(function () { if (S.view === 'hatch' && Live.orb) Live.orb.setState('idle'); }, 1600); }
});
$('#view-hatch').addEventListener('keydown', function (e) { if (e.target.id === 'hatch-draft' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#hatch-composer').requestSubmit(); } });
$('#view-hatch').addEventListener('submit', function (e) {
  e.preventDefault();
  if ($('#hatch-draft').value.trim() === '') return;
  if (S.hatch.phase !== 'out') { if (Live.orb) Live.orb.skipHatch(); }
  toast('In the app this is your first message to it. It answers, and the two of you settle on a name.');
});

/* ================================================================
   Hints, clock, theme, about, tour
   ================================================================ */
var HINTS = {
  chat: [['g', 'Enter', 'Send'], ['b', 'Shift Enter', 'New line'], ['r', 'Esc', 'Stop'], ['y', '/', 'Message box'], ['y', 'Ctrl K', 'Chats'], ['b', 'Ctrl .', 'Panel']],
  list: [['y', '↑ ↓', 'Choose a chat'], ['g', 'Enter', 'Open'], ['r', 'Esc', 'Close the list']],
  hatch: [['g', 'Enter', 'Say hello'], ['r', 'Esc', 'Back to chat']],
  agent: [['y', '← →', 'Switch tab'], ['b', 'Tab', 'Next field'], ['r', 'Esc', 'Back to chat']],
  page: [['b', 'Tab', 'Next'], ['g', 'Enter', 'Press'], ['r', 'Esc', 'Back to chat']]
};
function paintHints() {
  var key = S.view === 'chat' ? (S.listOpen ? 'list' : 'chat') : HINTS[S.view] ? S.view : 'page';
  $('#hint-list').innerHTML = HINTS[key].map(function (h) { return '<li><kbd class="key ' + h[0] + '">' + h[1] + '</kbd>' + h[2] + '</li>'; }).join('');
}
function paintClock() {
  var d = new Date();
  $('#clock').textContent = d.toLocaleDateString('en', { weekday: 'short' }).toUpperCase() + ' ' + String(d.getDate()).padStart(2, '0') + ' ' + d.toLocaleDateString('en', { month: 'short' }).toUpperCase() + '  ' + d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
}
function setTheme(theme) {
  S.theme = theme;
  document.documentElement.dataset.theme = theme;
  readLcdColors();
  if (Live.orb) Live.orb.setTheme(theme === 'night');
  stills = {};
  refreshStills(); paintSkies(); paintNav(); tickLcds();
  if (S.view === 'agent') paintAgent();
}
var TOUR = [
  ['chat', 'The chat, and the scripted conversation', function () { go('chat'); playDemo(); }],
  ['list', 'The chat list', function () { go('chat', true); if (mqPhone.matches) openSheet(); else setList(true, true); }],
  ['hatch', 'First run: an egg hatches', function () { go('hatch'); }],
  ['agent', 'Identity and memory, as a character sheet', function () { go('agent'); }],
  ['automations', 'Automations, an ordinary list page', function () { go('automations'); }],
  ['library', 'Library', function () { go('library'); }],
  ['theme', 'Switch between day and night', function () { setTheme(S.theme === 'night' ? 'day' : 'night'); }]
];
function tourButtons(cls) { return TOUR.map(function (t, i) { return '<button type="button" class="' + cls + '" role="menuitem" data-tour="' + i + '">' + (cls === 'pop-item' ? '<kbd class="key b">' + (i + 1) + '</kbd>' : '') + t[1] + '</button>'; }).join(''); }
function runTour(e) { var b = e.target.closest('[data-tour]'); if (!b) return; closePops(); closeSheet(); if ($('#about').open) $('#about').close(); TOUR[+b.dataset.tour][2](); }

/* ================================================================
   Wiring
   ================================================================ */
function boot() {
  document.documentElement.dataset.theme = S.theme;
  readLcdColors();
  railHtml(); sheetHtml();
  $('#chats').innerHTML = chatsHtml('side');
  chatListEvents($('#chats')); chatListEvents($('#navsheet'));
  $('#proto-menu').innerHTML = '<p class="tab"><span class="flag" aria-hidden="true"></span>Look around</p>' + tourButtons('pop-item');
  $('#about-tour').innerHTML = tourButtons('btn small');
  liveInit();
  refreshNames(); refreshStills();
  addLcd($('#lcd-panel'), 48, 32, drawPanelLcd);
  addLcd($('#sheet-lcd'), 48, 32, function (l) {
    l.clear(); cardFace(l); l.flush();
    $('#sheet-blocks').textContent = blocks(S.memory);
  });
  resetChat(); paintChats(); paintNav(); paintHints(); paintClock(); setInterval(paintClock, 20000);
  setInterval(tickLcds, 320);

  document.addEventListener('click', function (e) {
    var goBtn = e.target.closest('[data-go]'), menu = e.target.closest('[data-act="menu"]');
    if (goBtn) { e.preventDefault(); closeSheet(); go(goBtn.dataset.go); }
    else if (menu) openSheet();
    if (!e.target.closest('.pop') && !e.target.closest('#rail-agent') && !e.target.closest('#sheet-agent') && !e.target.closest('#tour-btn')) closePops();
  });
  $('#rail-agent').addEventListener('click', function () { agentPop(this); });
  $('#navsheet').addEventListener('click', function (e) {
    if (e.target.closest('#sheet-close')) closeSheet();
    else if (e.target.closest('#sheet-agent')) agentPop(e.target.closest('#sheet-agent'));
    else if (e.target.closest('#sheet-theme')) setTheme(S.theme === 'night' ? 'day' : 'night');
    else if (e.target.closest('#sheet-about')) { closeSheet(); $('#about').showModal(); }
    else if (e.target.closest('#sheet-signout')) toast('Signing out is not part of this prototype.');
  });
  $('#rail').addEventListener('click', function (e) {
    if (e.target.closest('#theme-btn')) setTheme(S.theme === 'night' ? 'day' : 'night');
    else if (e.target.closest('#signout-btn')) toast('Signing out is not part of this prototype.');
  });
  $('#scrim').addEventListener('click', closeSheet);
  $('#drawer-scrim').addEventListener('click', function () { setDrawer(false); });
  $('#btn-menu').addEventListener('click', openSheet);
  $('#btn-chats').addEventListener('click', function () { setList(!S.listOpen, true); });
  $('#btn-new').addEventListener('click', function () { toast('In the app this starts an empty chat with ' + S.name + '.'); });
  $('#btn-hide-panel').addEventListener('click', function () { if (mqWide.matches) { S.panelOpen = false; paintPanel(); $('#agent-pill').focus(); } else setDrawer(false); });
  $('#agent-pill').addEventListener('click', function () { if (mqWide.matches) { S.panelOpen = true; paintPanel(); $('#btn-hide-panel').focus(); } else setDrawer(true); });
  $('#btn-fresh').addEventListener('click', function () { toast('Start fresh: ' + S.name + ' stops carrying this chat’s earlier messages. Its memory is kept.'); });
  $('#demo-toggle').addEventListener('click', function () {
    if (!Demo.playing) { go('chat', true); playDemo(); return; }
    Demo.paused = !Demo.paused; paintDemo();
  });
  $('#demo-replay').addEventListener('click', function () { go('chat', true); playDemo(); });
  $('#tour-btn').addEventListener('click', function () { var m = $('#proto-menu'), open = m.hidden; closePops(); m.hidden = !open; this.setAttribute('aria-expanded', String(open)); if (open) $('.pop-item', m).focus(); });
  $('#proto-menu').addEventListener('click', runTour);
  $('#about-tour').addEventListener('click', runTour);
  $('#about-btn').addEventListener('click', function () { $('#about').showModal(); });
  $('#btn-proto-phone').addEventListener('click', function () { $('#about').showModal(); });
  $('#about-close').addEventListener('click', function () { $('#about').close(); });
  $('#about').addEventListener('click', function (e) { if (e.target === this) this.close(); });

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));
    if (e.key === 'Escape') {
      if ($('#about').open) return;
      if (!$('#agent-pop').hidden || !$('#proto-menu').hidden) { closePops(); return; }
      if (S.sheet) { closeSheet(); return; }
      if (S.drawer) { setDrawer(false); return; }
      if (S.view === 'chat' && S.busy && Demo.stop) { Demo.stop(); return; }
      if (S.view === 'chat' && S.listOpen) { setList(false); $('#btn-chats').focus(); return; }
      if (S.view !== 'chat') { go('chat'); return; }
    }
    if (!$('#proto-menu').hidden && /^[1-7]$/.test(e.key)) { e.preventDefault(); closePops(); TOUR[+e.key - 1][2](); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (S.view !== 'chat') go('chat', true);
      if (mqPhone.matches) openSheet(); else { setList(true); $('#side-search').focus(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); if (S.view === 'chat') { if (mqWide.matches) { S.panelOpen = !S.panelOpen; paintPanel(); } else setDrawer(!S.drawer); } }
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '/' && S.view === 'chat') { e.preventDefault(); draft.focus(); }
  });

  function relayout() { paintPanel(); if (!mqPhone.matches && S.sheet) closeSheet(); paintSkies(); }
  mqWide.addEventListener('change', relayout); mqPhone.addEventListener('change', relayout);
  var rz = 0; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { paintSkies(); sizeLive(); }, 120); });
  mqReduce.addEventListener('change', function () { if (Live.orb) Live.orb.reduced = calm(); });
  window.addEventListener('hashchange', function () { var v = location.hash.slice(1); if (v && v !== S.view) go(v); });

  var first = location.hash.slice(1);
  S.view = '';
  go(D.pages[first] || VIEW_EL[first] ? first : 'chat', true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { textCache = {}; tickLcds(); fitDraft(); });

  var bootEl = $('#boot'), hold = params.get('boot') === '0' || calm() ? 0 : 900;
  setTimeout(function () {
    bootEl.classList.add('off');
    if (params.get('demo') !== '0' && S.view === 'chat') playDemo();
    else if (params.get('demo') !== '0') { Demo.finished = true; paintDemo(); }
  }, hold);

  // for checking it from a script, and for poking at it from the console
  window.proto = { S: S, go: go, setTheme: setTheme, setMood: setMood, setActivity: setActivity, playDemo: playDemo, Demo: Demo, Live: Live, setList: setList, openSheet: openSheet, setDrawer: setDrawer, startHatch: startHatch, core: AgentOrb, flash: function (sel, text) { flashBanner($(sel), text); } };
}
boot();
})();
