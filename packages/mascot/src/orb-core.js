/* ================================================================
   AGENT ORB CORE
   Everything the mascot needs and nothing from the demo page: the seed
   genome, the shaders, the shared Stage, the Orb and the Runner.
   Hand it THREE (r128 core is enough):  var AgentOrb = AgentOrbCore(THREE)

   AgentOrb.makeGenome(seed)            pure: every trait the seed decides, as plain data
   AgentOrb.describeGenome(g, mascot)   pure: the same traits as [label, value] rows for people
   AgentOrb.createOrb(canvas, opts)     new Orb(canvas, opts), added to the Runner, loop started
       opts: seed, color ('#rrggbb'), size (css px; measured from the canvas if omitted),
             style ('retro' mascot | 'glass'), dark, reduced, notice (follow the pointer),
             pixelRatio, slow (draw at the lower frame rate)
   orb.setSeed(seed)   orb.setColor(hex)   orb.setStyle('retro' | 'glass')   orb.setTheme(dark)
   orb.setState(state, variant)         state: one of AgentOrb.STATES, or 'egg' for the waiting egg;
                                        variant: one of AgentOrb.VARIANTS, used by 'working'
   orb.getState()                       'egg', 'hatching' or the state name
   orb.feed('token', 0..1)              one streamed token of the answer
   orb.feed('key')                      one keystroke of the user
   orb.pet(x, amount)                   a hand on it: x from -1 (its left edge) to 1, amount 0..1 of a pat
   orb.setPointer(clientX, clientY)     point its attention there (null lets go);
                                        orb.attend(x, y, strength) is the raw, DOM-free form
   orb.offer(true | false)              a treat is held out to it: it opens its mouth for it, until told otherwise
   orb.bite()                           it takes a bite of what it was offered
   orb.cheer()                          a pleased little hop, whatever it is doing
   orb.hatch({ onDone, onOut })         play the hatch; orb.skipHatch() jumps to its end. onOut is the moment
                                        the shell breaks
   orb.crack(0..1)                      how cracked the waiting egg is: it keeps its cracks while it waits,
                                        and the hatch goes on from them
   orb.shadow = 0..1                    how much of its shadow is drawn: 0 for one that is in the air
   orb.stance()                         where it stands in its picture: { ground, egg }, see orb-core.d.ts
   orb.paused = true                    stop updating and drawing this one;
                                        Runner.stop() / Runner.start() pause and resume all of them
   orb.reduced = true                   reduced motion
   orb.resize(size)                     new css size (or re-measure the canvas)
   orb.dispose()                        remove it and free its materials
   orb.onAuto = fn(state)               called when it changes state by itself (done -> idle, hatch -> idle)
   orb.hidden = true                    draw its scene without it: for something else shown on its stage
   orb.worn                             null, or what it has on (see wardrobe.js): { tick(dt, t), fit(), dispose() },
                                        called after each update, after its size or seed changes, and when it goes

   Where the core touches the page (all guarded, nothing at load time):
     Stage.get      lets THREE.WebGLRenderer create its own canvas, unless Stage.provide(key, renderer)
                    was called first with a renderer of yours ('px' for the mascot, 'aa' for glass)
     Stage.draw     copies the orb's square into orb.canvas through a 2D context; skipped when the orb
                    has no canvas. Stage.drawAt(orb, renderer, x, y) draws into a viewport of any
                    renderer instead, with no DOM at all
     Orb.resize     reads canvas.clientWidth and devicePixelRatio, sets canvas.width / height and
                    style.imageRendering
     Runner         requestAnimationFrame; document.hidden and visibilitychange; getBoundingClientRect,
                    scroll and resize to know what is on screen and where the pointer is
   ================================================================ */
function AgentOrbCore(THREE) {
'use strict';

/* ================================================================
   Small helpers
   ================================================================ */
var TAU = Math.PI * 2;
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function smooth(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
function decay(dt, tau) { return Math.exp(-dt / tau); }

// Seeded PRNG: string hash (xmur3) feeding mulberry32. Identity never touches Math.random.
function hashStr(str) {
  var h = 1779033703 ^ str.length;
  for (var i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
function seeded(str) {
  var a = hashStr(str);
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToHsl(hex) {
  var n = parseInt(hex.slice(1), 16);
  var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
  if (mx !== mn) {
    var d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  var r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

/* ================================================================
   The app's avatar palette, states, poses and expressions
   ================================================================ */
var PALETTE = { clay: '#b8674a', moss: '#5f8a4e', tide: '#3f7f9c', plum: '#7d5a9a', honey: '#c9952c', slate: '#5b6672', rose: '#c0607a', ink: '#2f3a52' };
var STATES = ['idle', 'listening', 'thinking', 'working', 'speaking', 'waiting', 'done', 'error', 'asleep'];
var VARIANTS = ['command', 'file', 'search', 'memory'];

// Resting pose of every state. Everything the orb shows is a weighted blend of these plus
// per-state gestures, so any state can cross-fade into any other.
var POSE = {
  idle:      { hz: 0.22, breath: 0.024, scale: 1.00, lift: 0.00,  squash: 0.00,  wob: 1.00, flow: 1.0,  spin: 1.0, core: 0.55, coreSize: 1.00, halo: 0.42, rim: 0.60, glint: 0.90, sat: 1.00, bright: 1.00, mote: 1.0, lean: 0.40 },
  listening: { hz: 0.15, breath: 0.007, scale: 1.10, lift: -0.015, squash: 0.035, wob: 0.18, flow: 0.3,  spin: 0.25, core: 0.78, coreSize: 0.80, halo: 0.62, rim: 1.10, glint: 1.20, sat: 1.05, bright: 1.07, mote: 0.25, lean: 1.00 },
  thinking:  { hz: 0.30, breath: 0.012, scale: 0.965, lift: 0.035, squash: 0.025, wob: 0.80, flow: 2.3,  spin: 2.8, core: 1.00, coreSize: 0.62, halo: 0.46, rim: 0.50, glint: 0.50, sat: 1.00, bright: 0.96, mote: 1.9, lean: 0.55 },
  working:   { hz: 0.50, breath: 0.010, scale: 1.00, lift: 0.00,  squash: -0.02, wob: 0.55, flow: 1.6,  spin: 1.7, core: 0.66, coreSize: 0.90, halo: 0.50, rim: 0.62, glint: 0.80, sat: 1.05, bright: 1.02, mote: 2.3, lean: 0.55 },
  speaking:  { hz: 0.34, breath: 0.010, scale: 1.03, lift: 0.01,  squash: 0.00,  wob: 1.10, flow: 1.4,  spin: 1.2, core: 0.74, coreSize: 1.10, halo: 0.56, rim: 0.72, glint: 0.92, sat: 1.08, bright: 1.05, mote: 1.3, lean: 0.60 },
  waiting:   { hz: 0.20, breath: 0.012, scale: 1.04, lift: 0.075, squash: 0.03,  wob: 0.35, flow: 0.6,  spin: 0.5, core: 0.68, coreSize: 1.00, halo: 0.52, rim: 0.85, glint: 1.05, sat: 1.05, bright: 1.04, mote: 0.6, lean: 0.85 },
  done:      { hz: 0.25, breath: 0.020, scale: 1.03, lift: 0.02,  squash: 0.00,  wob: 0.70, flow: 0.9,  spin: 1.0, core: 0.90, coreSize: 1.20, halo: 0.72, rim: 0.80, glint: 1.10, sat: 1.10, bright: 1.10, mote: 1.2, lean: 0.30 },
  error:     { hz: 0.42, breath: 0.010, scale: 0.95, lift: -0.06, squash: -0.07, wob: 1.30, flow: 0.7,  spin: 0.4, core: 0.32, coreSize: 0.80, halo: 0.22, rim: 0.35, glint: 0.42, sat: 0.50, bright: 0.84, mote: 0.5, lean: 0.25 },
  asleep:    { hz: 0.085, breath: 0.030, scale: 0.95, lift: -0.09, squash: -0.065, wob: 0.20, flow: 0.12, spin: 0.1, core: 0.16, coreSize: 0.90, halo: 0.08, rim: 0.25, glint: 0.06, sat: 0.55, bright: 0.74, mote: 0.12, lean: 0.00 }
};
var POSE_KEYS = Object.keys(POSE.idle);

// The face each state wears. up: upper lid (1 = this orb's resting height, more = wide), low: lower lid raise,
// close: lids shut, smile: +1 bends the lids into happy arcs, -1 into sleeping ones, tilt: + focused (inner
// ends down), - worried (inner ends up), pupil: size, asym: one eye wider than the other, blink: blink rate.
// mw / mo / mc are the mouth: width, opening, curve (+ smile, - frown).
var EXPR = {
  idle:      { up: 1.00, low: 0.00, close: 0, smile: 0.00,  tilt: 0.00,  pupil: 1.00, asym: 0.00, blink: 1.0,  mw: 1.00, mo: 0.00, mc: 0.30 },
  listening: { up: 1.26, low: 0.00, close: 0, smile: 0.00,  tilt: -0.05, pupil: 1.12, asym: 0.00, blink: 0.45, mw: 0.62, mo: 0.16, mc: 0.05 },
  thinking:  { up: 0.60, low: 0.26, close: 0, smile: 0.00,  tilt: 0.08,  pupil: 0.92, asym: 0.22, blink: 0.7,  mw: 0.55, mo: 0.00, mc: -0.12 },
  working:   { up: 0.86, low: 0.14, close: 0, smile: 0.00,  tilt: 0.13,  pupil: 0.96, asym: 0.00, blink: 0.6,  mw: 0.80, mo: 0.00, mc: 0.00 },
  speaking:  { up: 1.08, low: 0.05, close: 0, smile: 0.20,  tilt: -0.03, pupil: 1.04, asym: 0.00, blink: 1.0,  mw: 0.90, mo: 0.10, mc: 0.25 },
  waiting:   { up: 1.14, low: 0.00, close: 0, smile: 0.00,  tilt: -0.16, pupil: 1.10, asym: 0.34, blink: 0.9,  mw: 0.50, mo: 0.30, mc: 0.00 },
  done:      { up: 0.62, low: 0.90, close: 0, smile: 1.00,  tilt: 0.00,  pupil: 1.00, asym: 0.00, blink: 0.0,  mw: 1.30, mo: 0.30, mc: 0.90 },
  error:     { up: 0.95, low: 0.12, close: 0, smile: -0.20, tilt: -0.46, pupil: 0.70, asym: 0.12, blink: 1.9,  mw: 0.85, mo: 0.00, mc: -0.60 },
  asleep:    { up: 0.30, low: 0.00, close: 1, smile: -1.00, tilt: 0.00,  pupil: 1.00, asym: 0.00, blink: 0.0,  mw: 0.42, mo: 0.24, mc: 0.00 }
};
var EXPR_KEYS = Object.keys(EXPR.idle);

/* ================================================================
   Genome: everything the seed decides
   ================================================================ */
function makeGenome(seed) {
  var r = seeded('orb/' + seed);
  var pool = [];
  for (var i = 0; i < 160; i++) pool.push(r());
  var at = 0;
  function n() { return pool[at++]; }
  function nr(a, b) { return a + (b - a) * n(); }
  function sign() { return n() < 0.5 ? -1 : 1; }
  // Each trait pulls a fixed number of values, so traits stay independent of one another.
  var g = { seed: seed };

  var k = n();
  g.kind = k < 0.40 ? 'liquid' : k < 0.70 ? 'faceted' : 'wispy';
  var s = [n(), n(), n(), n(), n(), n()];
  if (g.kind === 'liquid') {
    g.freq = lerp(0.6, 1.25, s[0]); g.amp = lerp(0.05, 0.11, s[1]);
    g.freq2 = g.freq * lerp(2.0, 3.0, s[2]); g.amp2 = lerp(0.0, 0.012, s[3]);
    g.flowSpd = lerp(0.10, 0.22, s[4]); g.wisp = 0; g.feather = 0; g.facet = 0; g.detail = 0;
  } else if (g.kind === 'faceted') {
    g.freq = lerp(0.7, 1.4, s[0]); g.amp = lerp(0.07, 0.14, s[1]);
    g.freq2 = 3; g.amp2 = 0;
    g.flowSpd = lerp(0.05, 0.12, s[4]); g.wisp = 0; g.feather = 0; g.facet = 1;
    g.detail = s[5] < 0.3 ? 1 : s[5] < 0.75 ? 2 : 3;
  } else {
    g.freq = lerp(1.0, 1.6, s[0]); g.amp = lerp(0.07, 0.12, s[1]);
    g.freq2 = g.freq * lerp(2.0, 2.6, s[2]); g.amp2 = lerp(0.02, 0.04, s[3]);
    g.flowSpd = lerp(0.20, 0.36, s[4]); g.wisp = 1; g.feather = lerp(0.7, 1.0, s[5]); g.facet = 0; g.detail = 0;
  }
  g.yawSpd = nr(0.10, 0.26) * sign();
  g.tilt0 = nr(-0.35, 0.35);

  // inner structure (glass) or skin markings (mascot)
  var pats = ['swirl', 'bands', 'spiral', 'cells'];
  var p1 = Math.floor(n() * 4) % 4, p2 = (p1 + 1 + Math.floor(n() * 3)) % 4;
  var mix2 = n() < 0.55 ? nr(0.15, 0.4) : (n(), 0);
  g.pattern = pats[p1]; g.pattern2 = mix2 > 0 ? pats[p2] : null;
  g.pat = [0, 0, 0, 0]; g.pat[p1] = 1 - mix2; g.pat[p2] += mix2;
  g.patScale = nr(1.2, 2.5);
  g.bands = 2 + Math.floor(n() * 6);
  g.arms = 2 + Math.floor(n() * 4);
  g.twist = nr(0.5, 2.0);
  g.contrast = nr(0.7, 1.0);
  g.axisX = nr(-0.7, 0.7); g.axisZ = nr(-0.7, 0.7);
  g.spinSpd = nr(0.10, 0.26) * sign();

  // core
  g.coreSize = nr(0.30, 0.55);
  g.coreGain = nr(0.75, 1.2);

  // colour drift around the base hue
  g.hueB = nr(14, 40) * sign();
  g.hueC = -Math.sign(g.hueB) * nr(25, 70);
  g.satK = nr(0.92, 1.18);
  g.lightK = nr(-0.04, 0.05);

  // finish
  g.glintPow = nr(16, 60);
  g.glintGain = nr(0.75, 1.2);
  g.rim = nr(0.6, 1.15);

  // company: motes, satellites, rings
  var hasM = n() < 0.7; var mc = 4 + Math.floor(n() * 14);
  g.motes = hasM ? mc : 0;
  g.moteSpd = nr(0.6, 1.3);
  var hasS = n() < 0.40; var sc = n();
  g.sats = hasS ? (sc < 0.55 ? 1 : sc < 0.85 ? 2 : 3) : 0;
  g.satTilt = [nr(-0.5, 0.5), nr(-0.6, 0.6)];
  g.satSpd = nr(0.7, 1.3);
  var hasR = n() < 0.36; var rc = n();
  g.rings = hasR ? (rc < 0.72 ? 1 : 2) : 0;
  g.ring = [
    { r: nr(1.34, 1.52), w: nr(0.035, 0.09), tx: nr(0.18, 0.42) * sign(), tz: nr(-0.5, 0.5), spd: nr(0.25, 0.6) * sign() },
    { r: nr(1.56, 1.70), w: nr(0.02, 0.05), tx: nr(0.2, 0.5) * sign(), tz: nr(-0.7, 0.7), spd: nr(0.2, 0.5) * sign() }
  ];
  g.seedVec = [n(), n(), n(), n()];

  // temperament
  g.tempo = nr(0.86, 1.18);
  g.breathHz = nr(0.85, 1.2);
  g.restless = nr(0.8, 1.35);
  g.bounce = nr(0.32, 0.55);
  g.side = sign();
  g.phase = nr(0, 100);
  g.ph = [nr(0, TAU), nr(0, TAU), nr(0, TAU), nr(0, TAU)];
  g.flowDir = (function () {
    var a = nr(0, TAU), z = nr(-0.6, 0.6), q = Math.sqrt(1 - z * z);
    return g.kind === 'wispy' ? [0.15 * Math.cos(a), -1, 0.15 * Math.sin(a)] : [q * Math.cos(a), z, q * Math.sin(a)];
  })();

  // eyes
  var er = n(), ea = n(), ez = n();
  g.eyeShape = er < 0.36 ? 'round' : er < 0.70 ? 'tall' : 'wide';
  g.eyeAspect = g.eyeShape === 'round' ? lerp(0.95, 1.12, ea) : g.eyeShape === 'tall' ? lerp(1.30, 1.62, ea) : lerp(0.70, 0.86, ea);
  g.eyeSize = g.eyeShape === 'round' ? lerp(0.170, 0.225, ez) : g.eyeShape === 'tall' ? lerp(0.145, 0.190, ez) : lerp(0.190, 0.245, ez);
  g.eyeGap = nr(0.07, 0.20);
  g.eyeY = nr(-0.02, 0.16);
  g.eyeN = nr(2.0, 3.4);
  g.eyeLid = nr(0.70, 1.05);
  if (g.eyeShape === 'wide') g.eyeLid = Math.max(g.eyeLid, 0.84);
  g.eyeTilt = nr(-0.14, 0.14);
  var ps = n(), pz = n();
  g.pupil = ps < 0.40 ? 'full' : ps < 0.75 ? 'dot' : 'iris';
  g.pupilSize = g.pupil === 'dot' ? lerp(0.50, 0.66, pz) : lerp(0.80, 0.93, pz);
  g.eyeHi2 = n() < 0.45;
  g.blinkEvery = nr(2.4, 5.6);
  g.blinkDouble = nr(0.05, 0.30);
  g.blinkSpeed = nr(0.85, 1.25);

  // mascot build
  var sh = n();
  g.shape = sh < 0.26 ? 'round' : sh < 0.46 ? 'drop' : sh < 0.66 ? 'mochi' : sh < 0.84 ? 'bean' : 'egg';
  g.shapeAmt = nr(0.6, 1.0);
  var pb = n();
  g.poly = pb < 0.30 ? 2 : pb < 0.75 ? 3 : 4;
  g.flat = n() < 0.55;
  var dz = n();
  g.dither = dz < 0.40 ? 'bayer' : dz < 0.62 ? 'checker' : dz < 0.78 ? 'lines' : 'none';
  g.tones = n() < 0.5 ? 3 : 4;
  var tp = n();
  g.top = tp < 0.22 ? 'none' : tp < 0.40 ? 'antenna' : tp < 0.54 ? 'floater' : tp < 0.72 ? 'ears' : tp < 0.86 ? 'horn' : 'tuft';
  if (g.shape === 'drop' && (g.top === 'ears' || g.top === 'horn' || g.top === 'tuft')) g.top = tp < 0.8 ? 'none' : 'floater';
  g.topSize = nr(0.75, 1.2);
  g.topLean = nr(-0.3, 0.3);
  g.tail = n() < 0.30;
  g.tailSide = sign();
  g.marks = n() < 0.72;
  g.markLight = n() < 0.5;
  g.mouthW = nr(0.8, 1.25);

  // the egg it hatches from
  g.eggTeeth = 5 + Math.floor(n() * 3);
  g.eggCrackY = nr(0.0, 0.2);
  g.eggDyed = n() < 0.3;
  return g;
}

function describeGenome(g, retro) {
  var marks = g.pattern === 'bands' ? 'stripes ×' + g.bands : g.pattern === 'spiral' ? 'whorl, ' + g.arms + ' arms' : g.pattern === 'cells' ? 'spots' : 'patches';
  var inside = g.pattern === 'bands' ? 'bands ×' + g.bands : g.pattern === 'spiral' ? 'spiral, ' + g.arms + ' arms' : g.pattern;
  if (g.pattern2) inside += ' + ' + g.pattern2;
  var surface = g.kind === 'faceted' ? 'faceted, ' + [0, 80, 180, 320][g.detail] + ' faces' : g.kind;
  var temper = g.tempo > 1.08 ? 'quick' : g.tempo < 0.94 ? 'slow' : 'even';
  temper += g.bounce < 0.4 ? ', bouncy' : g.bounce > 0.48 ? ', composed' : '';
  var rows = [
    ['eyes', g.eyeShape + (g.eyeGap < 0.11 ? ', close-set' : g.eyeGap > 0.16 ? ', wide-set' : '')],
    ['pupils', g.pupil === 'full' ? 'big' : g.pupil === 'dot' ? 'small' : 'ringed'],
    ['lids', g.eyeLid < 0.76 ? 'heavy' : g.eyeLid > 0.95 ? 'wide open' : 'relaxed'],
    ['blink', 'about every ' + g.blinkEvery.toFixed(1) + ' s']
  ];
  if (retro) {
    rows.push(['body', g.shape + ', ' + [0, 80, 180, 320, 500][g.poly] + ' faces']);
    rows.push(['shading', (g.flat ? 'flat' : 'gouraud') + ', ' + g.tones + ' tones' + (g.dither === 'none' ? '' : ', ' + g.dither + ' dither')]);
    rows.push(['on top', g.top === 'none' ? (g.shape === 'drop' ? 'tip' : 'nothing') : g.top]);
    rows.push(['tail', g.tail ? 'yes' : 'no']);
    rows.push(['markings', g.marks ? marks : 'none']);
  } else {
    rows.push(['surface', surface]);
    rows.push(['inside', inside]);
    rows.push(['core', g.coreSize > 0.46 ? 'wide' : g.coreSize < 0.37 ? 'tight' : 'medium']);
  }
  if (retro) rows.push(['egg', (g.eggDyed ? 'tinted' : 'pale') + ' shell, ' + (g.marks ? marks : 'speckles')]);
  rows.push(['hue drift', (g.hueB > 0 ? '+' : '−') + Math.abs(Math.round(g.hueB)) + '°']);
  rows.push(['rings', String(g.rings)]);
  rows.push(['satellites', String(g.sats)]);
  rows.push(['motes', String(g.motes)]);
  rows.push(['temper', temper]);
  return rows;
}

/* ================================================================
   Shaders
   ================================================================ */
var NOISE = [
  'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
  'vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}',
  'vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}',
  'vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}',
  'float snoise(vec3 v){',
  '  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);',
  '  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);',
  '  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);',
  '  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;',
  '  i=mod289(i);',
  '  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));',
  '  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;',
  '  vec4 j=p-49.0*floor(p*ns.z*ns.z);',
  '  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);',
  '  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);',
  '  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);',
  '  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));',
  '  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
  '  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);',
  '  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
  '  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;',
  '  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;',
  '  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
  '}'
].join('\n');

// Ordered dither thresholds in 0..1: 4x4 Bayer, a two-level checker, or scanlines.
var DITHER = [
  'uniform float uDk;',
  'float B2(vec2 a){ a = floor(a); return fract(a.x/2.0 + a.y*a.y*0.75); }',
  'float bayer4(vec2 p){ return B2(0.5*p)*0.25 + B2(p) + 0.03; }',
  'float dth(vec2 p){',
  '  if (uDk < 0.5) return B2(0.5*p)*0.25 + B2(p) + 0.03;',
  '  if (uDk < 1.5) { vec2 a = floor(p); return mod(a.x + a.y, 2.0)*0.5 + 0.25; }',
  '  return mod(floor(p.y), 2.0)*0.5 + 0.25;',
  '}'
].join('\n');

// Marking / interior pattern, shared by the body and the egg.
var PATTERN = [
  'uniform vec4 uPat; uniform vec4 uPatP; uniform vec2 uPatQ; uniform float uPatT;',
  'float pattern(vec3 q){',
  '  float t = uPatT; float v = 0.0;',
  '  if (uPat.x > 0.001) {',
  '    vec3 w = q*uPatP.x;',
  '    w += 0.6*sin(w.yzx*1.9 + t*0.9);',
  '    w += 0.4*sin(w.zxy*3.1 - t*0.7);',
  '    v += uPat.x * smoothstep(0.1, 0.9, 0.5 + 0.5*sin(3.4*(w.x + w.y*0.8 + w.z*0.5)));',
  '  }',
  '  if (uPat.y > 0.001) {',
  '    float lat = q.y + 0.10*sin(q.x*3.1 + t*0.6)*sin(q.z*2.7 - t*0.4);',
  '    float b = 0.5 + 0.5*sin(lat*uPatP.y*3.14159 + 0.7*uPatP.z*sin(q.x*2.0 + q.z*2.0 + t*0.3));',
  '    v += uPat.y * smoothstep(0.12, 0.88, b);',
  '  }',
  '  if (uPat.z > 0.001) {',
  '    float ang = atan(q.z, q.x); float rad = length(q.xz);',
  '    v += uPat.z * (0.5 + 0.5*sin(ang*uPatQ.x + rad*uPatP.z*4.5 - t*1.3 + q.y*2.2)*smoothstep(0.08, 0.6, rad));',
  '  }',
  '  if (uPat.w > 0.001) {',
  '    vec3 w = q*uPatP.x*1.7 + 0.5*sin(q.zxy*2.1 + t*0.5);',
  '    v += uPat.w * smoothstep(-0.25, 0.55, sin(w.x)*sin(w.y)*sin(w.z)*1.6);',
  '  }',
  '  return v;',
  '}'
].join('\n');

var BODY_VERT = [
  'attribute float aPart;',
  'uniform vec3 uFlow; uniform vec3 uFlow2; uniform vec4 uSurf; uniform float uWisp; uniform float uFace;',
  'uniform vec3 uVoice; uniform vec3 uFront;',
  'uniform vec4 uShape; uniform vec4 uBump[3]; uniform vec3 uBumpK;',
  'uniform vec4 uTop; uniform vec3 uTopDir; uniform vec3 uBend; uniform float uSnap;',
  'varying vec3 vN; varying vec3 vV; varying vec3 vObj; varying vec3 vN0; varying float vPart;',
  NOISE,
  'float disp(vec3 p){',
  '  float d = snoise(p*uSurf.x + uFlow) * uSurf.y;',
  '  if (uSurf.w > 0.0005) d += snoise(p*uSurf.z + uFlow2) * uSurf.w;',
  '  d *= mix(1.0, 0.35 + 1.1*smoothstep(-0.7, 1.0, p.y), uWisp);',
  '  if (uVoice.x > 0.0005) {',
  '    float a = acos(clamp(dot(p, uFront), -1.0, 1.0));',
  '    d += uVoice.x * sin(a*uVoice.z - uVoice.y) * smoothstep(2.4, 0.2, a);',
  '  }',
  // the face stays calmer than the rest so the eyes keep their shape
  '  d *= 1.0 - uFace*smoothstep(0.3, 0.9, p.z);',
  '  d += uBump[0].w * pow(max(dot(p, uBump[0].xyz), 0.0), uBumpK.x);',
  '  d += uBump[1].w * pow(max(dot(p, uBump[1].xyz), 0.0), uBumpK.y);',
  '  d += uBump[2].w * pow(max(dot(p, uBump[2].xyz), 0.0), uBumpK.z);',
  '  return d;',
  '}',
  'vec3 shape(vec3 p){',
  '  vec3 q = p*(1.0 + disp(p));',
  '  q.xz *= uShape.x*(1.0 - uShape.z*q.y);',
  '  q.y *= uShape.y;',
  '  float fb = -uShape.w;',
  '  q.y = fb + log(1.0 + exp((q.y - fb)*9.0))/9.0;',
  '  return q;',
  '}',
  'void main(){',
  '  vPart = aPart;',
  '  vec3 p = normalize(position);',
  '  vec3 pos; vec3 n;',
  '  if (aPart < 0.5) {',
  '    vec3 up = abs(p.y) > 0.92 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0);',
  '    vec3 t1 = normalize(cross(up, p)); vec3 t2 = cross(p, t1);',
  '    vec3 pa = normalize(p + t1*0.06); vec3 pb = normalize(p + t2*0.06);',
  '    pos = shape(p); vec3 qa = shape(pa); vec3 qb = shape(pb);',
  '    n = normalize(cross(qa - pos, qb - pos));',
  '    if (dot(n, p) < 0.0) n = -n;',
  '    vObj = p;',
  '  } else {',
  // antenna stalk (1) and its ball (2), anchored on the body and bent by a lagging spring
  '    vec3 base = shape(uTopDir);',
  '    vec3 up = normalize(uTopDir + vec3(0.0, 0.7, 0.0));',
  '    if (aPart < 1.5) {',
  '      float t = position.y;',
  '      pos = base*0.96 + up*uTop.x*t + uBend*t*t + vec3(position.x, 0.0, position.z)*uTop.y*(1.0 - 0.35*t);',
  '      n = normalize(vec3(position.x, 0.25, position.z));',
  '    } else {',
  '      pos = base*0.96 + up*uTop.x + uBend + p*uTop.z;',
  '      n = p;',
  '    }',
  '    pos *= uTop.w;',
  '    vObj = vec3(0.0, 0.0, -1.0);',
  '  }',
  '  vN = normalize(normalMatrix * n);',
  '  vN0 = normalize(normalMatrix * p);',
  '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
  '  vV = mv.xyz;',
  '  vec4 clip = projectionMatrix * mv;',
  // PS1-style vertex snap to the low-resolution pixel grid
  '  if (uSnap > 0.5) clip.xy = floor(clip.xy/clip.w*uSnap + 0.5)/uSnap*clip.w;',
  '  gl_Position = clip;',
  '}'
].join('\n');

var BODY_FRAG = [
  'uniform vec3 uCenterV; uniform float uS;',
  'uniform vec3 uDeep; uniform vec3 uShade; uniform vec3 uBase; uniform vec3 uLight; uniform vec3 uSpec; uniform vec3 uColB; uniform vec3 uColC; uniform vec3 uHot; uniform vec3 uRimCol;',
  'uniform mat3 uInner;',
  'uniform vec3 uCorePos; uniform vec3 uCore;',
  'uniform vec3 uGaze; uniform vec2 uGlint; uniform float uRim; uniform float uFacet; uniform float uFeather; uniform float uDetail; uniform float uWisp;',
  'uniform vec4 uGrade; uniform vec4 uAcc; uniform vec4 uAccP; uniform vec3 uRings[4];',
  'uniform float uRetro; uniform vec2 uTone; uniform float uLamp; uniform float uFade;',
  'uniform vec4 uEye; uniform vec4 uEyeS; uniform vec4 uLidL; uniform vec4 uLidR; uniform vec4 uPup; uniform vec4 uEyeK;',
  'uniform vec3 uEyeW; uniform vec3 uEyeD; uniform vec3 uEyeI; uniform vec3 uEyeLn;',
  'uniform vec4 uMouth; uniform vec3 uMouthK;',
  'varying vec3 vN; varying vec3 vV; varying vec3 vObj; varying vec3 vN0; varying float vPart;',
  DITHER,
  PATTERN,
  'void main(){',
  '  vec3 N = normalize(vN);',
  '  if (uFacet > 0.001) {',
  '    vec3 fn = normalize(cross(dFdx(vV), dFdy(vV)));',
  '    N = normalize(mix(N, fn, uFacet));',
  '  }',
  '  vec3 rd = normalize(vV);',
  '  float ndv = clamp(dot(N, -rd), 0.0, 1.0);',
  '  vec3 c = (vV - uCenterV) / uS;',
  '  vec3 L = normalize(vec3(-0.45, 0.65, 0.62));',
  '  vec3 fo = normalize(vObj);',
  '  float fwo = fwidth(fo.y);',
  '  float isBody = step(vPart, 0.5);',
  '  float face = smoothstep(0.4, 0.85, fo.z) * isBody;',
  '  float bay = dth(gl_FragCoord.xy);',
  '  if (uFade < 0.999 && bayer4(gl_FragCoord.xy) > uFade) discard;',
  // light shared by both looks: the reading band, rings passing through, the core
  '  float sy = clamp(c.y, -0.999, 0.999);',
  '  float lon = clamp(c.x / sqrt(1.0 - sy*sy), -1.0, 1.0);',
  '  float bx = (lon - uAccP.y) / mix(0.34, 0.2, uDetail);',
  '  float band = exp(-bx*bx) * uAcc.y;',
  '  float rl = length(c.xy);',
  '  float ring = 0.0;',
  '  for (int i = 0; i < 4; i++) { vec3 R = uRings[i]; float x = (rl - R.x)/R.z; ring += R.y*exp(-x*x); }',
  '  ring *= smoothstep(1.05, 0.9, rl);',
  '  vec3 kv = uCorePos - c; vec3 perp = kv - dot(kv, rd)*rd; float d2 = dot(perp, perp);',
  '  float cs = uCore.y*uCore.y;',
  '  float coreG = exp(-d2/cs);',
  '  vec3 col;',
  '  if (uRetro > 0.5) {',
  // mascot: a few flat tones picked by the light, dithered where they meet
  '    float nl = dot(N, L) + (coreG*uCore.x*0.30 + band*0.6 + ring*0.5)*isBody + uGrade.z*2.2;',
  '    float x = nl + (bay - 0.5)*uTone.y;',
  '    float ti = uTone.x > 3.5 ? step(-0.25, x) + step(0.22, x) + step(0.84, x) : step(-0.05, x)*2.0 + step(0.84, x);',
  '    col = ti < 0.5 ? uDeep : ti < 1.5 ? uShade : ti < 2.5 ? uBase : uLight;',
  '    if (vPart < 0.5) {',
  '      if (uPatP.w > 0.001) col = mix(col, uColB*(0.70 + 0.16*ti), step(uPatQ.y, pattern(fo)) * (1.0 - face));',
  '      if (1.0 - ndv > 0.80 - 0.12*uRim && N.y - N.x*0.5 > 0.15) col = mix(col, uRimCol, 0.45);',
  '    } else if (vPart < 1.5) {',
  '      col = uDeep;',
  '    } else {',
  '      col = (ti < 1.5 ? uColC*0.72 : ti < 2.5 ? uColC : mix(uColC, vec3(1.0), 0.5)) + uHot*uLamp;',
  '    }',
  '    if (uGlint.x > 0.3 && dot(N, uGaze) > uGlint.y) col = uSpec;',
  '  } else {',
  // glass: interior pattern seen through the surface with a little parallax
  '    float dif = smoothstep(-0.4, 1.0, dot(N, L));',
  '    dif = mix(dif, 0.5 + 0.3*dif, uWisp);',
  '    vec3 rr = refract(rd, N, 0.72);',
  '    float v = pattern(uInner * (c + rr*0.30));',
  '    if (uDetail > 0.3) v = mix(v, pattern(uInner * (c + rr*0.85) * 1.25 + 2.7), 0.38);',
  '    float pc = uPatP.w * mix(0.5, 1.0, uDetail) * (1.0 - 0.35*face);',
  '    float shade = clamp(dif + (v - 0.5)*0.30*pc, 0.0, 1.0);',
  '    col = mix(uDeep, uBase, smoothstep(0.04, 0.7, shade));',
  '    col = mix(col, uLight, smoothstep(0.72, 1.0, shade)*0.85);',
  '    col = mix(col, uColB*(0.45 + 0.7*dif), smoothstep(0.35, 0.9, v)*pc*0.6);',
  '    col = mix(col, uColC, smoothstep(0.72, 0.98, v)*pc*0.4);',
  '    col = mix(col, uDeep, smoothstep(0.35, 0.0, v)*pc*0.35);',
  '    col *= mix(0.74, 1.0, smoothstep(0.0, 0.62, ndv));',
  '    col += uLight * (band*0.55 + ring*0.42);',
  '    col += uHot * coreG * uCore.x * 0.5;',
  '    col += vec3(1.0) * exp(-d2/(cs*0.12)) * uCore.x * 0.22;',
  '  }',
  // the face: two eyes (and, on the mascot, a small mouth) painted on the skin in object space
  '  float eyeM = 0.0;',
  '  if (vPart < 0.5 && fo.z > 0.1) {',
  '    float hard = uRetro;',
  '    float fwq = fwo / uEye.w;',
  '    float es = fo.x < 0.0 ? -1.0 : 1.0;',
  '    vec2 q = vec2((fo.x - es*uEye.x)/uEye.z, (fo.y - uEye.y)/uEye.w);',
  '    float en = uEyeS.x;',
  '    float er = pow(pow(abs(q.x), en) + pow(abs(q.y), en), 1.0/en);',
  '    float aa = mix(clamp(fwq*0.8, 0.012, 0.5), 0.0001, hard);',
  '    if (er < 1.7) {',
  '      vec4 lid = es < 0.0 ? uLidL : uLidR;',
  '      float x2 = q.x*q.x;',
  '      float yu = lid.x + lid.z*x2 + lid.w*q.x*es;',
  '      float yl = lid.y + lid.z*x2*0.7 - lid.w*q.x*es*0.3;',
  '      float ym = 0.5*(yu + yl);',
  '      yu = max(yu, ym); yl = min(yl, ym);',
  '      float d = max(er - 1.0, max(q.y - yu, yl - q.y));',
  '      float open = smoothstep(aa, -aa, d);',
  '      float dif0 = smoothstep(-0.4, 1.0, dot(normalize(vN0), L));',
  '      float lsh = smoothstep(0.5, 0.0, yu - q.y);',
  '      vec3 ec = uEyeW * mix((0.80 + 0.24*dif0)*(1.0 - 0.30*lsh), 1.0 - 0.15*step(0.42, lsh), hard);',
  '      vec2 pq = (q - uPup.xy) * vec2(1.0, uPup.z);',
  '      float pr = length(pq) / uEyeS.y;',
  '      float pa = aa / uEyeS.y;',
  '      if (uEyeS.z > 0.001) ec = mix(ec, uEyeI * mix(0.75 + 0.35*dif0, 1.0, hard), smoothstep(1.0 + pa, 1.0 - pa, pr));',
  '      float pin = uEyeS.z > 0.001 ? uEyeS.z : 1.0;',
  '      ec = mix(ec, uEyeD, smoothstep(pin + pa, pin - pa, pr));',
  // highlight; while a command runs it squares off into a blinking cursor
  '      float sq = max(uPup.w, hard*0.7);',
  '      float hmin = hard*0.8*fwq/uEyeS.y;',
  '      vec2 hq = (pq/uEyeS.y - vec2(-0.30, 0.36)) / max(vec2(mix(0.27, 0.17, uPup.w), mix(0.27, 0.33, uPup.w)), vec2(hmin));',
  '      float hn = mix(2.0, 7.0, sq);',
  '      float hr = pow(pow(abs(hq.x), hn) + pow(abs(hq.y), hn), 1.0/hn);',
  '      float hl = smoothstep(1.0 + pa*2.5, 1.0 - pa*2.5, hr) * mix(1.0, uEyeK.w, uPup.w);',
  '      hl += smoothstep(0.15 + pa, 0.15 - pa, length(pq/uEyeS.y - vec2(0.30, -0.32))) * uEyeK.z * 0.7;',
  '      ec = mix(ec, vec3(1.0), clamp(hl, 0.0, 1.0) * uEyeS.w);',
  '      col = mix(col, ec, open);',
  // the lid line is always there, so a closed eye is still a clear mark
  '      float shut = 1.0 - smoothstep(0.0, 0.5, yu - yl);',
  '      float th = max(uEyeK.x * (1.0 + 0.6*smoothstep(-0.3, 0.3, q.y - ym)) * (1.0 + 0.5*shut), hard*mix(0.55, 0.95, shut)*fwq);',
  '      float line = smoothstep(th + aa, max(th - aa, 0.0), abs(d)) * max(uEyeK.y, shut) * mix(1.0, step(abs(q.x), 0.86), shut*hard);',
  '      col = mix(col, uEyeLn, line);',
  '      eyeM = max(open, line);',
  '    }',
  '    if (uMouthK.x > 0.001) {',
  '      vec2 mq = vec2((fo.x - uMouthK.y)/uMouth.y, (fo.y - uMouth.x)/uMouth.y);',
  '      float mx2 = min(mq.x*mq.x, 1.0);',
  '      float mh = max(uMouthK.z + uMouth.z*(1.0 - mx2), hard*0.55*fwo/uMouth.y);',
  '      float md = max(abs(mq.x) - 1.0, abs(mq.y + uMouth.w*(1.0 - mx2)*0.55) - mh);',
  '      float ma = mix(clamp(fwo/uMouth.y*0.8, 0.02, 0.6), 0.0001, hard);',
  '      float mm = smoothstep(ma, -ma, md) * uMouthK.x;',
  '      col = mix(col, uEyeLn, mm);',
  '      eyeM = max(eyeM, mm);',
  '    }',
  '  }',
  '  float alpha = 1.0;',
  '  if (uRetro < 0.5) {',
  '    float fres = pow(1.0 - ndv, 2.6);',
  '    col += uRimCol * fres * uRim * (1.0 - 0.6*uWisp);',
  '    float gd = max(dot(N, uGaze), 0.0);',
  '    float keep = 1.0 - 0.75*eyeM;',
  '    col += (uLight*0.5 + 0.5) * pow(gd, uGlint.y)*0.32 * uGlint.x * (1.0 - 0.5*uWisp) * keep;',
  '    col += vec3(1.0) * pow(gd, uGlint.y*6.0)*0.55 * uGlint.x * (1.0 - 0.6*uWisp) * keep;',
  '    alpha = mix(1.0, smoothstep(0.0, 0.7, ndv), uFeather);',
  '  }',
  '  float lum = dot(col, vec3(0.299, 0.587, 0.114));',
  '  vec3 grey = lum * (uGrade.w > 0.0 ? mix(vec3(1.0), vec3(1.12, 0.96, 0.87), uGrade.w) : mix(vec3(1.0), vec3(0.95, 1.0, 1.07), -uGrade.w));',
  '  col = mix(grey, col, uGrade.x) * uGrade.y;',
  '  if (uRetro > 0.5) {',
  // 15-bit colour, like the hardware
  '    col = floor(clamp(col, 0.0, 1.0)*31.0 + bay)/31.0;',
  '  } else {',
  '    col += uHot*uGrade.z;',
  '    col = col / (1.0 + max(col - 0.82, 0.0)*0.9);',
  '  }',
  '  gl_FragColor = vec4(col*alpha, alpha);',
  '}'
].join('\n');

// The egg: the same low-poly mesh pulled into an egg shape. When it breaks, every triangle becomes a shard
// that flies off around its own centre, the cap first and the cup a beat later.
var CRACK = [
  'uniform vec4 uCrk;',
  'float crackY(vec3 d){ float a = atan(d.x, d.z); return uCrk.x + uCrk.y*(abs(fract(a*uCrk.z/6.2831853 + 0.25) - 0.5)*2.0 - 0.5); }'
].join('\n');
var EGG_VERT = [
  'attribute float aPart; attribute vec3 aTri;',
  'uniform vec3 uEggS; uniform float uBurst; uniform float uSnap;',
  'varying vec3 vN; varying vec3 vV; varying vec3 vObj;',
  CRACK,
  'vec3 eggShape(vec3 p){ vec3 q = p; q.xz *= uEggS.x*(1.0 - uEggS.z*q.y); q.y *= uEggS.y; return q; }',
  'void main(){',
  '  vec3 p = normalize(position);',
  '  vec3 q = eggShape(p);',
  '  vec3 n = normalize(vec3(p.x/uEggS.x, p.y/uEggS.y + uEggS.z*0.6, p.z/uEggS.x));',
  '  if (uBurst > 0.0) {',
  '    vec3 c = normalize(aTri);',
  '    vec3 qc = eggShape(c);',
  '    float top = step(crackY(c), c.y);',
  '    float h = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719)))*43758.5453);',
  '    float go = max(uBurst*(0.75 + 0.5*h) - (1.0 - top)*0.22, 0.0);',
  '    vec3 dir = normalize(c + vec3(0.0, mix(-0.1, 0.9, top), 0.0));',
  '    vec3 off = dir*(1.5*go)*mix(0.55, 1.0, top) + vec3(0.0, -2.0*go*go, 0.0);',
  '    vec3 k = normalize(vec3(c.z, 0.35, -c.x));',
  '    float ang = go*(5.0 + 9.0*h);',
  '    vec3 v = q - qc;',
  '    v = v*cos(ang) + cross(k, v)*sin(ang) + k*dot(k, v)*(1.0 - cos(ang));',
  '    q = qc + v*(1.0 - smoothstep(0.5, 1.0, go)) + off;',
  '  }',
  '  if (aPart > 0.5) q = vec3(0.0);',
  '  vObj = p;',
  '  vN = normalize(normalMatrix * n);',
  '  vec4 mv = modelViewMatrix * vec4(q, 1.0);',
  '  vV = mv.xyz;',
  '  vec4 clip = projectionMatrix * mv;',
  '  if (uSnap > 0.5) clip.xy = floor(clip.xy/clip.w*uSnap + 0.5)/uSnap*clip.w;',
  '  gl_Position = clip;',
  '}'
].join('\n');
var EGG_FRAG = [
  'uniform vec3 uShA; uniform vec3 uShB; uniform vec3 uShC; uniform vec3 uShM; uniform vec3 uCrkCol;',
  'uniform float uBurst; uniform vec2 uTone; uniform float uFacet; uniform vec4 uGrade; uniform float uFade; uniform vec2 uEggM;',
  'varying vec3 vN; varying vec3 vV; varying vec3 vObj;',
  DITHER,
  PATTERN,
  CRACK,
  'void main(){',
  '  vec3 N = normalize(vN);',
  '  vec3 fn = normalize(cross(dFdx(vV), dFdy(vV)));',
  '  N = uBurst > 0.0 ? fn : normalize(mix(N, fn, uFacet));',
  '  vec3 L = normalize(vec3(-0.45, 0.65, 0.62));',
  '  vec3 fo = normalize(vObj);',
  '  float fw = fwidth(fo.y);',
  '  float bay = dth(gl_FragCoord.xy);',
  '  if (uFade < 0.999 && bayer4(gl_FragCoord.xy) > uFade) discard;',
  '  float x = dot(N, L) + uGrade.z*2.0 + (bay - 0.5)*uTone.y;',
  '  float ti = step(-0.1, x) + step(0.8, x);',
  '  vec3 col = ti < 0.5 ? uShA : ti < 1.5 ? uShB : uShC;',
  '  col = mix(col, uShM*(0.8 + 0.12*ti), uEggM.x * step(uEggM.y, pattern(fo)));',
  // the crack: a zigzag round the shell that opens from the front
  '  float a = atan(fo.x, fo.z);',
  '  if (uBurst <= 0.0 && abs(fo.y - crackY(fo)) < max(0.035, 0.8*fw) && abs(a) < uCrk.w*3.2) col = uCrkCol;',
  '  col = floor(clamp(col*uGrade.y, 0.0, 1.0)*31.0 + bay)/31.0;',
  '  gl_FragColor = vec4(col, 1.0);',
  '}'
].join('\n');

var HALO_VERT = 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
var HALO_FRAG = [
  'uniform vec2 uC; uniform vec2 uSc; uniform float uRoll;',
  'uniform vec3 uHaloCol; uniform vec3 uRingCol; uniform float uHalo; uniform float uDark; uniform float uRetro;',
  'uniform vec3 uRings[4]; uniform vec3 uLobe; uniform vec3 uGround; uniform float uRs;',
  'varying vec2 vP;',
  DITHER,
  'void main(){',
  '  vec2 d = vP - uC; float cr = cos(uRoll); float sr = sin(uRoll);',
  '  d = vec2(cr*d.x + sr*d.y, -sr*d.x + cr*d.y) / uSc;',
  '  float r = length(d);',
  '  float o = max(r - 0.7, 0.0);',
  '  float g = exp(-o*o*7.0)*0.82 + exp(-o*2.6)*0.18;',
  '  g *= 1.0 + uLobe.z * dot(d/(r + 0.0001), uLobe.xy);',
  '  float a = g * uHalo;',
  '  vec2 gp = (vP - vec2(uC.x, uGround.z)) / vec2(uSc.x*0.62*uGround.y, mix(0.04, 0.055, uRetro));',
  '  vec3 poolCol = mix(vec3(0.03, 0.06, 0.06), uHaloCol*0.55, uDark);',
  '  if (uRetro > 0.5) {',
  // mascot: no soft glow, just crisp pixel rings that break into dither as they fade, and a flat blob shadow
  '    float bay = dth(gl_FragCoord.xy);',
  '    float rc = length(vP - uC) / uRs;',
  '    float rg = 0.0;',
  '    for (int i = 0; i < 4; i++) { vec3 R = uRings[i]; rg = max(rg, step(abs(rc - R.x), R.z*0.42) * step(bay*0.9, R.y*1.8)); }',
  '    rg *= step(0.98, r) * step(length(vP), 0.97);',
  '    float al = rg;',
  '    vec3 col = uRingCol;',
  '    float pool = step(pow(abs(gp.x), 3.0) + pow(abs(gp.y), 3.0), 1.0) * min(uGround.x*1.1, 0.3);',
  '    gl_FragColor = vec4(col*al + poolCol*pool*(1.0 - al), al + pool*(1.0 - al));',
  '  } else {',
  '    float ring = 0.0;',
  '    float rc = length(vP - uC) / uRs;',
  '    for (int i = 0; i < 4; i++) { vec3 R = uRings[i]; float x = (rc - R.x)/R.z; ring += R.y*exp(-x*x); }',
  '    ring *= smoothstep(0.9, 1.08, r);',
  '    float win = smoothstep(1.0, 0.5, length(vP));',
  '    vec3 col = (uHaloCol*a + uRingCol*ring) * win;',
  '    float al = (a + ring) * win;',
  '    float pool = exp(-dot(gp, gp)) * uGround.x;',
  '    col += poolCol * pool; al += pool;',
  '    gl_FragColor = vec4(col, al * mix(1.0, 0.3, uDark));',
  '  }',
  '}'
].join('\n');

var POINTS_VERT = [
  'attribute vec4 aRnd; attribute float aIdx;',
  'uniform vec4 uSeed; uniform vec2 uCount; uniform vec2 uT; uniform float uPx; uniform vec3 uCenterW; uniform float uS;',
  'uniform float uInward; uniform float uPush; uniform vec2 uAl; uniform vec2 uSatTilt; uniform float uRetro;',
  'varying float vA; varying float vKind;',
  'mat2 rot(float a){ float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }',
  'void main(){',
  '  vec4 h = fract(aRnd + uSeed);',
  '  float isSat = step(aIdx, uCount.x - 0.5);',
  '  float on = step(aIdx, uCount.x + uCount.y - 0.5);',
  '  float rad = mix(1.10 + 0.52*h.x*h.x, 1.36 + 0.30*h.x, isSat);',
  '  float spd = mix(0.3 + 0.8*h.y, 0.45 + 0.3*h.y, isSat) * mix(h.z > 0.5 ? 1.0 : -1.0, 1.0, isSat);',
  '  float t = mix(uT.x, uT.y, isSat);',
  '  float ph = h.w*6.2831853 + t*spd;',
  '  float fall = fract(h.w*3.7 + uT.x*0.2);',
  '  float m = uInward*(1.0 - isSat);',
  '  rad = mix(rad, mix(1.95, 0.98, fall*fall), m) + uPush*(1.0 - isSat)*0.14*(0.4 + h.y);',
  '  vec3 o = vec3(cos(ph), 0.0, sin(ph)) * rad;',
  '  float a1 = mix((h.x - 0.5)*2.6, uSatTilt.x + (h.y - 0.5)*0.5, isSat);',
  '  float a2 = mix((h.y - 0.5)*2.2, uSatTilt.y + (h.x - 0.5)*0.4, isSat);',
  '  o.yz = rot(a1)*o.yz; o.xy = rot(a2)*o.xy;',
  '  vec4 mv = viewMatrix * vec4(uCenterW + o*uS, 1.0);',
  '  gl_Position = on > 0.5 ? projectionMatrix * mv : vec4(3.0, 3.0, 3.0, 1.0);',
  '  float size = mix(0.06 + 0.07*h.z, 0.10 + 0.07*h.z, isSat) * uS * uPx * (3.7320508 / -mv.z);',
  '  gl_PointSize = uRetro > 0.5 ? max(1.0, floor(size*mix(0.6, 1.0, isSat) + 0.5)) : max(1.5, size);',
  '  float tw = 0.6 + 0.4*sin(t*1.7*(0.5 + h.x) + h.y*40.0);',
  '  float fadeIn = mix(1.0, smoothstep(0.0, 0.18, fall)*smoothstep(1.0, 0.8, fall), m);',
  '  float occ = mix(1.0, smoothstep(0.94, 1.12, length(o.xy)), step(o.z, 0.0));',
  '  vA = on * occ * mix(uAl.x*tw*fadeIn, uAl.y, isSat);',
  '  vKind = isSat;',
  '}'
].join('\n');
var POINTS_FRAG = [
  'uniform vec3 uMoteCol; uniform vec3 uSatCol; uniform vec3 uSatHi; uniform float uDark; uniform float uRetro;',
  'varying float vA; varying float vKind;',
  'void main(){',
  '  vec2 c = gl_PointCoord*2.0 - 1.0; float d = length(c);',
  '  vec3 n = vec3(c.x, -c.y, sqrt(max(0.0, 1.0 - d*d)));',
  '  float dif = dot(n, normalize(vec3(-0.45, 0.65, 0.62)))*0.5 + 0.5;',
  '  if (uRetro > 0.5) {',
  '    if (vA < mix(0.45, 0.25, vKind) || (vKind > 0.5 && d > 1.0)) discard;',
  '    gl_FragColor = vec4(mix(uMoteCol, dif > 0.62 ? uSatHi : uSatCol, vKind), 1.0);',
  '    return;',
  '  }',
  '  if (d > 1.0 || vA < 0.004) discard;',
  '  float aM = pow(1.0 - d, 1.5);',
  '  float aS = smoothstep(1.0, 0.8, d);',
  '  vec3 sc = mix(uSatCol*0.6, uSatHi, smoothstep(0.3, 1.0, dif));',
  '  vec3 col = mix(uMoteCol, sc, vKind); float a = mix(aM, aS, vKind) * vA;',
  '  gl_FragColor = vec4(col*a, a * mix(1.0, mix(0.35, 1.0, vKind), uDark));',
  '}'
].join('\n');

var RING_VERT = [
  'attribute float aAng; attribute float aSide; attribute float aRing;',
  'uniform vec3 uRU[2]; uniform vec3 uRV[2]; uniform vec4 uRP[2]; uniform vec3 uCenterW; uniform float uS;',
  'varying float vSide; varying float vArc; varying float vAl;',
  'void main(){',
  '  vec3 U = aRing < 0.5 ? uRU[0] : uRU[1]; vec3 V = aRing < 0.5 ? uRV[0] : uRV[1]; vec4 P = aRing < 0.5 ? uRP[0] : uRP[1];',
  '  float rad = P.x + aSide*P.y*0.5;',
  '  vec3 o = (U*cos(aAng) + V*sin(aAng)) * rad;',
  '  gl_Position = projectionMatrix * viewMatrix * vec4(uCenterW + o*uS, 1.0);',
  '  vSide = aSide; vArc = aAng - P.z; vAl = P.w;',
  '}'
].join('\n');
var RING_FRAG = [
  'uniform vec3 uRingCol; uniform float uDark; uniform float uRetro;',
  'varying float vSide; varying float vArc; varying float vAl;',
  DITHER,
  'void main(){',
  '  float edge = smoothstep(0.0, 0.7, 1.0 - abs(vSide));',
  '  float comet = pow(0.5 + 0.5*cos(vArc), 5.0);',
  '  float a = edge * vAl * (0.26 + 0.74*comet);',
  '  if (uRetro > 0.5) {',
  '    if (vAl*(0.34 + 0.9*comet) < dth(gl_FragCoord.xy)) discard;',
  '    gl_FragColor = vec4(uRingCol, 1.0);',
  '    return;',
  '  }',
  '  gl_FragColor = vec4(uRingCol*a, a * mix(1.0, 0.45, uDark));',
  '}'
].join('\n');

/* ================================================================
   Shared stage: one WebGL context draws every orb, then each orb's
   2D canvas takes a copy of its square. The mascot look wants hard
   pixels, so it gets a context without antialiasing; only the look
   in use keeps a context alive.
   ================================================================ */
var Stage = {
  ctx: {}, camera: null, geos: {}, missedAt: {},
  // key: 'px' (mascot, no antialiasing) or 'aa' (glass). Creates the renderer on first use.
  get: function (key) {
    if (this.ctx[key]) return this.ctx[key];
    var r;
    try {
      r = new THREE.WebGLRenderer({ alpha: true, antialias: key === 'aa', premultipliedAlpha: true, powerPreference: 'low-power' });
    } catch (e) { return null; }
    return this.provide(key, r, true);
  },
  // Hand the stage a renderer of your own (for example one built on an expo-gl context).
  provide: function (key, renderer, own) {
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.setScissorTest(true);
    var c = { renderer: renderer, size: 0, own: !!own, gone: false };
    // The browser is let give the context back. A renderer handed to the stage is carried on
    // with, as three re-creates its state. One of the stage's own is not: see `lost`.
    var el = renderer.domElement;
    if (el && el.addEventListener) el.addEventListener('webglcontextlost', function (e) { e.preventDefault(); c.gone = true; });
    return (this.ctx[key] = c);
  },
  cam: function () {
    if (!this.camera) {
      this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 12);
      this.camera.position.set(0, 0, 3.7320508);
    }
    return this.camera;
  },
  release: function (key) {
    var c = this.ctx[key];
    if (!c) return;
    if (c.own) {
      c.renderer.dispose();
      if (c.renderer.forceContextLoss) c.renderer.forceContextLoss();
    }
    delete this.ctx[key];
  },
  // Drop the renderer of a look nobody uses any more.
  sweep: function (orbs) {
    var px = false, aa = false;
    for (var i = 0; i < orbs.length; i++) { if (orbs[i].retro) px = true; else aa = true; }
    if (!px) this.release('px');
    if (!aa) this.release('aa');
  },
  count: function () { return Object.keys(this.ctx).length; },
  // The renderer for a frame. This is asked every frame, so one that could not be made is asked
  // for again only after a while.
  frame: function (key) {
    if (this.ctx[key]) return this.ctx[key];
    var t = now();
    if (t - (this.missedAt[key] || -1e9) < 1000) return null;
    var c = this.get(key);
    if (!c) this.missedAt[key] = t;
    return c;
  },
  // Whether the browser has taken the context away, as it does when the graphics card is reset
  // or its process dies. It gives it back within a second or so, but what three then draws with
  // it is nothing at all: every call is made and the picture stays clear. So a renderer of the
  // stage's own that has lost its context once is let go of, and the next frame asks for a new
  // one, which draws.
  lost: function (key, c) {
    var gl = c.renderer.getContext ? c.renderer.getContext() : null;
    var away = !!(gl && gl.isContextLost && gl.isContextLost());
    if (c.own && (c.gone || away)) { this.release(key); return true; }
    return away;
  },
  // Icosphere body with the antenna stalk and ball appended, so the whole figure is one draw call.
  body: function (detail) {
    var key = 'b' + detail;
    if (this.geos[key]) return this.geos[key];
    var ico = new THREE.IcosahedronGeometry(1, detail).attributes.position.array;
    var ball = new THREE.IcosahedronGeometry(1, 0).attributes.position.array;
    var stalk = [], SEG = 3, i, s;
    function ringPt(a, t) { return [Math.cos(a), t, Math.sin(a)]; }
    for (s = 0; s < SEG; s++) {
      for (i = 0; i < 4; i++) {
        var a0 = i * TAU / 4, a1 = (i + 1) * TAU / 4, t0 = s / SEG, t1 = (s + 1) / SEG;
        var A = ringPt(a0, t0), B = ringPt(a1, t0), C = ringPt(a1, t1), D = ringPt(a0, t1);
        stalk.push.apply(stalk, A.concat(D, B, B, D, C));
      }
    }
    var nBody = ico.length / 3, nStalk = stalk.length / 3, nBall = ball.length / 3, total = nBody + nStalk + nBall;
    var pos = new Float32Array(total * 3), part = new Float32Array(total), tri = new Float32Array(total * 3);
    pos.set(ico, 0); pos.set(stalk, nBody * 3); pos.set(ball, (nBody + nStalk) * 3);
    // every vertex knows the centre of its own triangle, so the egg can break into shards
    for (i = 0; i < nBody * 3; i += 9) {
      for (s = 0; s < 3; s++) {
        var cv = (ico[i + s] + ico[i + 3 + s] + ico[i + 6 + s]) / 3;
        tri[i + s] = tri[i + 3 + s] = tri[i + 6 + s] = cv;
      }
    }
    for (i = nBody; i < total; i++) tri[i * 3 + 1] = -1;
    for (i = 0; i < nStalk; i++) part[nBody + i] = 1;
    for (i = 0; i < nBall; i++) part[nBody + nStalk + i] = 2;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
    geo.setAttribute('aTri', new THREE.BufferAttribute(tri, 3));
    geo.userData.body = ico;
    return (this.geos[key] = geo);
  },
  // nearest body vertex to a direction, so a horn or an ear always has a vertex at its peak
  nearest: function (detail, x, y, z) {
    var a = this.body(detail).userData.body, best = -2, bi = 0, l = Math.sqrt(x * x + y * y + z * z) || 1;
    x /= l; y /= l; z /= l;
    for (var i = 0; i < a.length; i += 3) { var d = a[i] * x + a[i + 1] * y + a[i + 2] * z; if (d > best) { best = d; bi = i; } }
    return [a[bi], a[bi + 1], a[bi + 2]];
  },
  quad: function () {
    if (!this.geos.quad) this.geos.quad = new THREE.PlaneGeometry(2, 2);
    return this.geos.quad;
  },
  points: function () {
    if (this.geos.points) return this.geos.points;
    var N = 24, r = seeded('orb/points'), pos = new Float32Array(N * 3), rnd = new Float32Array(N * 4), idx = new Float32Array(N);
    for (var i = 0; i < N; i++) { idx[i] = i; for (var j = 0; j < 4; j++) rnd[i * 4 + j] = r(); }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    geo.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    return (this.geos.points = geo);
  },
  ring: function () {
    if (this.geos.ring) return this.geos.ring;
    var SEG = 96, verts = (SEG + 1) * 2 * 2;
    var pos = new Float32Array(verts * 3), ang = new Float32Array(verts), side = new Float32Array(verts), ring = new Float32Array(verts), index = [];
    var v = 0;
    for (var k = 0; k < 2; k++) {
      var base = v;
      for (var i = 0; i <= SEG; i++) {
        for (var s = -1; s <= 1; s += 2) { ang[v] = (i / SEG) * TAU; side[v] = s; ring[v] = k; v++; }
      }
      for (var q = 0; q < SEG; q++) { var a = base + q * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aAng', new THREE.BufferAttribute(ang, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aRing', new THREE.BufferAttribute(ring, 1));
    geo.setIndex(index);
    return (this.geos.ring = geo);
  },
  // Draws the orb, and says whether it could.
  draw: function (orb) {
    var px = orb.px;
    if (px < 2) return false;
    var key = orb.retro ? 'px' : 'aa';
    var c = this.frame(key);
    // Nothing can be drawn without a context. The picture that is there stays: copying from a
    // context that is gone would wipe it.
    if (!c || this.lost(key, c)) return false;
    var r = c.renderer;
    if (px > c.size) { c.size = Math.min(2048, Math.ceil(px / 64) * 64); r.setSize(c.size, c.size, false); }
    this.drawAt(orb, r, 0, 0);
    if (!orb.ctx) return true;
    orb.ctx.clearRect(0, 0, px, px);
    orb.ctx.drawImage(r.domElement, 0, c.size - px, px, px, 0, 0, px, px);
    return true;
  },
  // Draw one orb into a square of any renderer (x, y from the bottom left, in pixels). This is the whole
  // per-orb cost, so a list of avatars can be one canvas with one of these calls per row.
  drawAt: function (orb, renderer, x, y) {
    var px = orb.px;
    renderer.setViewport(x, y, px, px);
    renderer.setScissor(x, y, px, px);
    renderer.render(orb.scene, this.cam());
    orb.drawCalls = renderer.info.render.calls;
    orb.tris = renderer.info.render.triangles;
  }
};

function Spring(x, f, z) { this.x = x; this.v = 0; this.t = x; this.f = f; this.z = z; }
Spring.prototype.step = function (dt) {
  var w = this.f * TAU, n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
  for (var i = 0; i < n; i++) {
    this.v += (-2 * this.z * w * this.v - w * w * (this.x - this.t)) * h;
    this.x += this.v * h;
  }
};

var M4 = { a: null, b: null, rot: null, e: null };

/* ================================================================
   Orb
   ================================================================ */
function Orb(canvas, opts) {
  opts = opts || {};
  if (!M4.a) { M4.a = new THREE.Matrix4(); M4.b = new THREE.Matrix4(); M4.rot = new THREE.Matrix4(); M4.e = new THREE.Euler(); }
  this.canvas = canvas || null;
  this.ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  // Whether it is owed a picture: one that could not be drawn, or one the browser wiped. A
  // canvas loses what is on it with the graphics card's process, and comes back clear.
  this.owed = false;
  var owing = this;
  if (canvas && canvas.addEventListener) canvas.addEventListener('contextrestored', function () { owing.owed = true; });
  this.fixedSize = opts.size || 0;
  this.pixelRatio = opts.pixelRatio || 0;
  this.paused = false;
  this.css = 0; this.px = 0; this.drawCalls = 0; this.tris = 0;
  this.dark = !!opts.dark;
  this.reduced = !!opts.reduced;
  this.notice = opts.notice !== false;
  this.retro = opts.style !== 'glass';
  this.state = 'idle'; this.variant = 'command';
  this.stateT = 0;
  this.onAuto = null;
  this.hidden = false;
  this.worn = null;
  this.visible = true;
  this.pending = 0;
  this.w = {}; this.wv = {}; this.p = {}; this.e = {};
  var i;
  for (i = 0; i < STATES.length; i++) this.w[STATES[i]] = STATES[i] === 'idle' ? 1 : 0;
  for (i = 0; i < VARIANTS.length; i++) this.wv[VARIANTS[i]] = VARIANTS[i] === 'command' ? 1 : 0;
  this.t = 0;
  this.sp = {
    scale: new Spring(1, 2.4, 0.6), lift: new Spring(0, 2.0, 0.5), squash: new Spring(0, 2.9, 0.4),
    gx: new Spring(0, 2.0, 0.8), gy: new Spring(0, 2.0, 0.8), ex: new Spring(0, 5.5, 0.8), ey: new Spring(0, 5.5, 0.8),
    roll: new Spring(0, 1.8, 0.65), x: new Spring(0, 1.6, 0.8), y: new Spring(0, 1.6, 0.8),
    ax: new Spring(0, 2.3, 0.22), ay: new Spring(0, 2.6, 0.25),
    born: new Spring(1, 3.0, 0.42), eggY: new Spring(0, 3.2, 0.35)
  };
  this.sec = { x: 0, y: 0 };
  // running phases and impulses
  this.breath = 0; this.tFlow = 0; this.tPat = 0; this.inner = 0; this.tMote = 0; this.tSat = 0;
  this.think = 0; this.work = 0; this.cmd = 0; this.cmdCycle = 0; this.file = 0; this.fileLine = 0;
  this.searchT = 0; this.sacT = 0; this.sac = { x: 0.6, y: 0.1 }; this.memT = 0; this.memHit = -1;
  this.waitT = 0; this.waitSide = 1;
  this.flash = 0; this.tick = 0; this.swell = 0; this.gulp = 0; this.flowBoost = 0; this.keyPulse = 0; this.nod = 0;
  this.voice = 0; this.voiceImp = 0; this.voicePhase = 0; this.lastFeed = { token: -9, key: -9 }; this.lastVoice = -9;
  this.simT = 0; this.simLeft = 0;
  this.shakeT = 9; this.shakeAmp = 0; this.velStretch = 0; this.twitchT = 2; this.stutter = 1; this.stutterT = 0;
  this.idleT = 2; this.glanceT = 0; this.glance = { x: 0, y: 0 }; this.drift = { x: 0, y: 0, t: 0 };
  this.attn = { x: 0, y: 0, k: 0, target: 0 };
  this.ptr = { x: 0, y: 0, t: -1e9 };
  // egg and hatching
  this.eggMode = 'none'; this.hatchT = 0; this.hatchDur = 5.3; this.hatchPh = 0; this.onHatched = null; this.onOut = null;
  this.born = 1; this.bornY = 0; this.joy = 0; this.petK = 0; this.petX = 0; this.eggWait = 1.5; this.eggYc = 0;
  this.eggCrack = 0; this.shadow = 1;
  // eating: how wide its mouth is held open for a treat, where that is heading, and the snap of a bite
  this.gape = 0; this.gapeTo = 0; this.chew = 0;
  this.E = { roll: 0, squash: 0, crack: 0, burst: 0, fade: 1, jolt: 0, rockT: 9, rockA: 0 };
  this.eo = { use: false, close: 0, up: 0, gx: 0, gy: 0, fade: 1 };
  this.text = { x: 0.1, y: -0.7 };
  // eyes
  this.blinkT = 2; this.blinkP = -1; this.blinkV = 0; this.blinkQ = 0;
  this.micro = { x: 0, y: 0, t: 1 }; this.gazePrev = { x: 0, y: 0 };
  this.rings = [];
  for (i = 0; i < 4; i++) this.rings.push({ on: false, t: 0, dur: 1, r0: 1, r1: 2, a: 0, w: 0.1, ease: 0 });

  this.scene = new THREE.Scene();
  this._build();
  this.setSeed(opts.seed || 'agent');
  this.setColor(opts.color || PALETTE.moss);
  this.resize();
}

Orb.prototype._build = function () {
  function v3() { return new THREE.Vector3(); }
  function v4() { return new THREE.Vector4(); }
  var rings = [v3(), v3(), v3(), v3()];
  var dk = { value: 0 }, retro = { value: 1 };
  this.uB = {
    uFlow: { value: v3() }, uFlow2: { value: v3() }, uSurf: { value: v4() }, uWisp: { value: 0 }, uFace: { value: 0.6 },
    uVoice: { value: v3() }, uFront: { value: new THREE.Vector3(0, 0, 1) },
    uShape: { value: new THREE.Vector4(1, 1, 0, 2) }, uBump: { value: [v4(), v4(), v4()] }, uBumpK: { value: new THREE.Vector3(8, 8, 8) },
    uTop: { value: v4() }, uTopDir: { value: new THREE.Vector3(0, 1, 0) }, uBend: { value: v3() }, uSnap: { value: 0 },
    uCenterV: { value: v3() }, uS: { value: 1 },
    uDeep: { value: v3() }, uShade: { value: v3() }, uBase: { value: v3() }, uLight: { value: v3() }, uSpec: { value: v3() }, uColB: { value: v3() }, uColC: { value: v3() }, uHot: { value: v3() }, uRimCol: { value: v3() },
    uInner: { value: new THREE.Matrix3() }, uPat: { value: v4() }, uPatP: { value: v4() }, uPatQ: { value: new THREE.Vector2() }, uPatT: { value: 0 },
    uCorePos: { value: v3() }, uCore: { value: v3() },
    uGaze: { value: new THREE.Vector3(0, 0, 1) }, uGlint: { value: new THREE.Vector2(1, 30) }, uRim: { value: 1 }, uFacet: { value: 0 }, uFeather: { value: 0 }, uDetail: { value: 1 },
    uGrade: { value: new THREE.Vector4(1, 1, 0, 0) },
    uAcc: { value: v4() }, uAccP: { value: v4() },
    uRings: { value: rings },
    uRetro: retro, uTone: { value: new THREE.Vector2(4, 0.3) }, uDk: dk, uLamp: { value: 0 }, uFade: { value: 1 },
    uEye: { value: new THREE.Vector4(0.3, 0.1, 0.2, 0.2) }, uEyeS: { value: new THREE.Vector4(2, 0.8, 0, 1) },
    uLidL: { value: new THREE.Vector4(1, -1.2, -0.16, 0) }, uLidR: { value: new THREE.Vector4(1, -1.2, -0.16, 0) },
    uPup: { value: new THREE.Vector4(0, 0, 1, 0) }, uEyeK: { value: new THREE.Vector4(0.1, 0.9, 0, 1) },
    uEyeW: { value: v3() }, uEyeD: { value: v3() }, uEyeI: { value: v3() }, uEyeLn: { value: v3() },
    uMouth: { value: new THREE.Vector4(-0.3, 0.1, 0, 0) }, uMouthK: { value: v3() }
  };
  this.uH = {
    uC: { value: new THREE.Vector2() }, uSc: { value: new THREE.Vector2(1, 1) }, uRoll: { value: 0 },
    uHaloCol: { value: v3() }, uRingCol: { value: v3() }, uHalo: { value: 0.5 }, uDark: { value: 0 }, uRetro: retro, uDk: dk,
    uRings: { value: rings }, uLobe: { value: v3() }, uGround: { value: new THREE.Vector3(0, 1, -0.88) }, uRs: { value: 1 }
  };
  this.uP = {
    uSeed: { value: v4() }, uCount: { value: new THREE.Vector2() }, uT: { value: new THREE.Vector2() }, uPx: { value: 100 },
    uCenterW: { value: v3() }, uS: { value: 1 }, uInward: { value: 0 }, uPush: { value: 0 }, uAl: { value: new THREE.Vector2(1, 1) }, uSatTilt: { value: new THREE.Vector2() },
    uMoteCol: { value: v3() }, uSatCol: { value: v3() }, uSatHi: { value: v3() }, uDark: { value: 0 }, uRetro: retro
  };
  this.uR = {
    uRU: { value: [v3(), v3()] }, uRV: { value: [v3(), v3()] }, uRP: { value: [v4(), v4()] },
    uCenterW: this.uP.uCenterW, uS: this.uP.uS, uRingCol: { value: v3() }, uDark: { value: 0 }, uRetro: retro, uDk: dk
  };
  this.uE = {
    uEggS: { value: new THREE.Vector3(0.84, 1.02, 0.16) }, uCrk: { value: new THREE.Vector4(0.1, 0.2, 6, 0) }, uBurst: { value: 0 }, uSnap: this.uB.uSnap,
    uShA: { value: v3() }, uShB: { value: v3() }, uShC: { value: v3() }, uShM: { value: v3() }, uCrkCol: { value: v3() },
    uTone: this.uB.uTone, uDk: dk, uFacet: { value: 0 }, uGrade: { value: new THREE.Vector4(1, 1, 0, 0) }, uFade: { value: 1 }, uEggM: { value: new THREE.Vector2(1, 0.6) },
    uPat: { value: v4() }, uPatP: { value: v4() }, uPatQ: { value: new THREE.Vector2() }, uPatT: { value: 0 }
  };
  var blend = { transparent: true, premultipliedAlpha: true };
  this.halo = new THREE.Mesh(Stage.quad(), new THREE.ShaderMaterial(Object.assign({ uniforms: this.uH, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, depthTest: false, depthWrite: false }, blend)));
  this.halo.renderOrder = 0; this.halo.frustumCulled = false;
  this.body = new THREE.Mesh(Stage.body(3), new THREE.ShaderMaterial(Object.assign({ uniforms: this.uB, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, extensions: { derivatives: true } }, blend)));
  this.body.renderOrder = 1; this.body.matrixAutoUpdate = false; this.body.frustumCulled = false;
  this.ring = new THREE.Mesh(Stage.ring(), new THREE.ShaderMaterial(Object.assign({ uniforms: this.uR, vertexShader: RING_VERT, fragmentShader: RING_FRAG, depthWrite: false, side: THREE.DoubleSide }, blend)));
  this.ring.renderOrder = 2; this.ring.frustumCulled = false;
  this.points = new THREE.Points(Stage.points(), new THREE.ShaderMaterial(Object.assign({ uniforms: this.uP, vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG, depthTest: false, depthWrite: false }, blend)));
  this.points.renderOrder = 3; this.points.frustumCulled = false;
  this.eggMesh = new THREE.Mesh(Stage.body(3), new THREE.ShaderMaterial({ uniforms: this.uE, vertexShader: EGG_VERT, fragmentShader: EGG_FRAG, extensions: { derivatives: true }, side: THREE.DoubleSide }));
  this.eggMesh.renderOrder = 1; this.eggMesh.matrixAutoUpdate = false; this.eggMesh.frustumCulled = false; this.eggMesh.visible = false;
  this.scene.add(this.halo, this.body, this.eggMesh, this.ring, this.points);
};

Orb.prototype.setSeed = function (seed) {
  this.seed = String(seed);
  var g = this.g = makeGenome(this.seed);
  this.rnd = seeded('orb/behaviour/' + this.seed);
  this.t = g.phase;
  this.breath = g.ph[0];
  this.idleT = 1.5 + this.rnd() * 3;
  this.blinkT = 0.8 + this.rnd() * g.blinkEvery;
  this.uP.uSeed.value.set(g.seedVec[0], g.seedVec[1], g.seedVec[2], g.seedVec[3]);
  this.uP.uSatTilt.value.set(g.satTilt[0], g.satTilt[1]);
  this._lod();
  if (this.color) this._colors();
};

Orb.prototype.setColor = function (hex) { this.color = hex; this._colors(); };
Orb.prototype.setTheme = function (dark) { this.dark = !!dark; this._colors(); };
Orb.prototype.setStyle = function (style) {
  var retro = style !== 'glass';
  if (retro === this.retro) return;
  this.retro = retro;
  if (!retro && this.eggMode !== 'none') this._endEgg(false);
  this.px = 0;
  this.resize();
  this._colors();
  Stage.sweep(Runner.orbs);
};

Orb.prototype._colors = function () {
  var g = this.g, c = hexToHsl(this.color), h = c[0], s = c[1] * g.satK, l = c[2] + g.lightK, d = this.dark, R = this.retro;
  function set(u, rgb) { u.value.set(rgb[0], rgb[1], rgb[2]); }
  var b = this.uB;
  var rs = clamp(s * 1.25 + 0.10, 0, 1), rl = clamp(l * 1.10 + 0.02, 0.30, 0.62);
  // the egg: a pale shell marked in the blob's colour, or a tinted shell with pale marks
  var ue = this.uE, shl = lerp(rl, 0.86, 0.55);
  set(ue.uShB, g.eggDyed ? hsl(h, rs * 0.75, shl) : hsl(h + g.hueB * 0.3, clamp(s * 0.5 + 0.12, 0, 0.5), 0.88));
  set(ue.uShA, g.eggDyed ? hsl(h + g.hueB * 0.6, rs * 0.8, shl * 0.74) : hsl(h + g.hueB * 0.6, clamp(s * 0.5 + 0.15, 0, 0.55), 0.68));
  set(ue.uShC, g.eggDyed ? hsl(h, rs * 0.5, 0.94) : hsl(h, 0.25, 0.97));
  set(ue.uShM, g.eggDyed ? hsl(h, 0.3, 0.95) : hsl(h, rs, rl));
  set(ue.uCrkCol, hsl(h + g.hueB * 0.6, clamp(s * 0.9 + 0.1, 0, 1), 0.14));
  if (R) {
    // mascot ramp: brighter, cleaner, a hue step between tones
    set(b.uBase, hsl(h, rs, rl));
    set(b.uDeep, hsl(h + g.hueB * 0.7, rs * 1.05 + 0.05, rl * 0.52));
    set(b.uShade, g.tones > 3 ? hsl(h + g.hueB * 0.35, rs * 1.02, rl * 0.77) : hsl(h, rs, rl));
    set(b.uLight, hsl(h - g.hueB * 0.4, rs * 0.95, lerp(rl, 0.90, 0.46)));
    set(b.uSpec, hsl(h - g.hueB * 0.4, 0.55, 0.95));
    set(b.uColB, g.markLight ? hsl(h + g.hueC * 0.5, rs * 0.85, lerp(rl, 0.92, 0.55)) : hsl(h + g.hueB * 1.5, rs * 1.05, rl * 0.74));
    set(b.uColC, hsl(h + g.hueC, clamp(rs + 0.15, 0, 1), 0.60));
    set(b.uHot, hsl(h + g.hueC, rs, 0.80));
    set(b.uRimCol, hsl(h - g.hueB * 0.4, rs * 0.9, lerp(rl, 0.92, 0.6)));
    this.lum = rl;
  } else {
    set(b.uBase, hsl(h, s * 1.1 + 0.03, l));
    set(b.uDeep, hsl(h + g.hueB * 0.55, s * 1.25 + 0.08, Math.max(l * 0.40, 0.13)));
    set(b.uShade, hsl(h, s * 1.1 + 0.03, l));
    set(b.uLight, hsl(h - g.hueB * 0.35, s * 1.05 + 0.10, lerp(l, 0.86, 0.42)));
    set(b.uSpec, [1, 1, 1]);
    set(b.uColB, hsl(h + g.hueB, s * 1.2 + 0.08, clamp(l * 1.06, 0.22, 0.68)));
    set(b.uColC, hsl(h + g.hueC, s * 1.1 + 0.16, lerp(l, 0.82, 0.55)));
    set(b.uHot, hsl(h + g.hueB * 0.4, s + 0.32, 0.76));
    set(b.uRimCol, hsl(h - g.hueB * 0.4, s + 0.2, 0.80));
    this.lum = l;
  }
  // eyes: pale whites, a near-black pupil in the orb's own hue, and a lid line that flips to light on dark skin
  this.darkBody = this.lum < 0.34;
  set(b.uEyeW, hsl(h - g.hueB * 0.3, Math.min(s * 0.5, 0.3), R ? 0.96 : 0.93));
  set(b.uEyeD, hsl(h + g.hueB * 0.6, clamp(s * 0.9 + 0.1, 0, 1), R ? 0.10 : 0.085));
  // iris: a neighbouring hue, steered away from red so ringed eyes never look sore
  var ih = (((h + g.hueC) % 360) + 360) % 360;
  if (ih > 338 || ih < 28) ih = h - g.hueC;
  set(b.uEyeI, hsl(ih, clamp(s * 1.1 + 0.25, 0, 1), R ? 0.50 : 0.42));
  set(b.uEyeLn, this.darkBody ? hsl(h, Math.min(s * 0.6, 0.4), 0.88) : hsl(h + g.hueB * 0.6, clamp(s * 0.9 + 0.1, 0, 1), R ? 0.11 : 0.15));

  var glow = hsl(h + g.hueB * 0.3, s * 1.3 + 0.16, clamp(l * 1.2 + 0.14, 0.46, 0.68));
  var tint = hsl(h, s * 1.25 + 0.10, clamp(l * 0.95, 0.30, 0.52));
  set(this.uH.uHaloCol, d ? glow : tint);
  set(this.uH.uRingCol, d ? hsl(h, s + 0.2, 0.78) : hsl(h, s * 1.2 + 0.1, clamp(l * 0.9, 0.28, 0.5)));
  set(this.uP.uMoteCol, d ? hsl(h + g.hueC * 0.4, s + 0.25, 0.80) : hsl(h + g.hueC * 0.3, s * 1.2 + 0.1, clamp(l * 0.9, 0.28, 0.5)));
  set(this.uP.uSatCol, hsl(h + g.hueC * 0.6, s * 1.1 + 0.08, clamp(l * 1.05, 0.3, 0.62)));
  set(this.uP.uSatHi, hsl(h + g.hueC * 0.6, s + 0.1, 0.86));
  set(this.uR.uRingCol, d ? hsl(h + g.hueC * 0.5, s + 0.2, 0.78) : hsl(h + g.hueC * 0.4, s * 1.2 + 0.1, clamp(l * 0.92, 0.3, 0.52)));
  this.uH.uDark.value = this.uP.uDark.value = this.uR.uDark.value = d ? 1 : 0;
};

// Everything that depends on size, look and seed together.
Orb.prototype._lod = function () {
  var g = this.g, css = this.css || 96, px = this.px || css, R = this.retro, b = this.uB, i;
  if (!g) return;
  // how much fine detail this size can carry
  this.detail = R ? smooth(24, 110, px) : smooth(36, 150, css);
  this.extras = R ? smooth(30, 60, px) : smooth(44, 92, css);
  this.exag = 1 + 0.7 * (1 - smooth(36, 150, css));
  this.eyeScale = R ? lerp(1.32, 1.12, smooth(24, 64, px)) : lerp(1.38, 1.0, this.detail);
  var fill = R ? lerp(0.74, 0.60, smooth(40, 120, css)) : lerp(0.74, 0.56, smooth(40, 120, css));
  var top = 0;
  b.uRetro.value = R ? 1 : 0;
  b.uPat.value.set(g.pat[0], g.pat[1], g.pat[2], g.pat[3]);
  for (i = 0; i < 3; i++) b.uBump.value[i].set(0, 1, 0, 0);
  b.uTop.value.set(0, 0, 0, 0);
  if (R) {
    var det = css < 40 ? Math.min(g.poly, 2) : css < 100 ? Math.min(g.poly, 3) : g.poly;
    this.body.geometry = Stage.body(det);
    var amt = g.shapeAmt, sh = g.shape;
    if (sh === 'drop') b.uShape.value.set(0.98, 0.96, 0.16 * amt, 2);
    else if (sh === 'mochi') b.uShape.value.set(1.08, 0.86, 0.10, 0.70 - 0.10 * amt);
    else if (sh === 'bean') b.uShape.value.set(0.90, 1.0 + 0.16 * amt, 0.04, 2);
    else if (sh === 'egg') b.uShape.value.set(0.98, 1.05, 0.18 * amt, 2);
    else b.uShape.value.set(1, 1, 0, 2);
    top = (b.uShape.value.y - 1) * 0.8;
    var bump = b.uBump.value, K = b.uBumpK.value, ts = g.topSize, v;
    K.set(8, 8, 8);
    if (sh === 'drop') { bump[0].set(0, 1, 0, 0.40 * amt); K.x = 7; top += 0.36 * amt; }
    if (g.top === 'ears') {
      v = Stage.nearest(det, -0.55, 0.80, 0.12); bump[0].set(v[0], v[1], v[2], 0.34 * ts);
      v = Stage.nearest(det, 0.55, 0.80, 0.12); bump[1].set(v[0], v[1], v[2], 0.34 * ts);
      K.x = K.y = 13; top += 0.16 * ts;
    } else if (g.top === 'horn') {
      v = Stage.nearest(det, g.topLean * 0.5, 0.90, 0.40); bump[0].set(v[0], v[1], v[2], 0.38 * ts); K.x = 24; top += 0.24 * ts;
    } else if (g.top === 'tuft') {
      v = Stage.nearest(det, g.topLean * 0.4, 1, 0.05); bump[0].set(v[0], v[1], v[2], 0.50 * ts); K.x = 46; top += 0.46 * ts;
    } else if ((g.top === 'antenna' || g.top === 'floater') && css >= 40) {
      var ant = g.top === 'antenna';
      b.uTop.value.set(ant ? 0.44 * ts : 0.40 * ts, ant ? 0.04 : 0, ant ? 0.13 * ts : 0.16 * ts, 1);
      b.uTopDir.value.set(g.topLean * 0.5, 1, 0.05).normalize();
      top += (ant ? 0.44 + 0.2 : 0.40 + 0.26) * ts;
    }
    if (g.tail) { v = Stage.nearest(det, g.tailSide * 0.62, -0.42, -0.62); bump[2].set(v[0], v[1], v[2], 0.42); K.z = 20; }
    b.uSurf.value.set(g.freq * 0.8, g.amp * 0.55, g.freq2, 0);
    b.uWisp.value = 0; b.uFeather.value = 0;
    b.uFacet.value = g.flat ? 1 : 0;
    b.uFace.value = 0.75;
    b.uTone.value.set(g.tones, g.dither === 'none' || px < 36 ? 0 : lerp(0.14, 0.32, this.detail));
    b.uDk.value = g.dither === 'checker' ? 1 : g.dither === 'lines' ? 2 : 0;
    b.uPatP.value.set(g.patScale, g.bands, g.twist, g.marks && px >= 36 ? 1 : 0);
    b.uPatQ.value.set(g.arms, 0.6);
    b.uPatT.value = g.phase;
    b.uInner.value.identity();
    b.uSnap.value = px * 0.5 * (css < 64 ? 2 : 1);
  } else {
    this.body.geometry = Stage.body(g.kind === 'faceted' ? g.detail : css >= 220 ? 16 : css >= 72 ? 9 : 5);
    b.uShape.value.set(1, 1, 0, 2);
    b.uWisp.value = g.wisp;
    b.uFacet.value = g.facet * lerp(0.55, 1, this.detail);
    b.uFeather.value = g.feather * lerp(0.6, 1, this.detail);
    b.uFace.value = g.kind === 'faceted' ? 0.4 : 0.65;
    b.uPatP.value.set(g.patScale, g.bands, g.twist, g.contrast);
    b.uPatQ.value.set(g.arms, 0);
    b.uSnap.value = 0;
    b.uDk.value = 0;
  }
  // leave room above the head for whatever grows there
  this.fill = Math.min(fill, 0.95 / (1 + top * 0.8));
  this.rest = -top * 0.34 * this.fill;
  this.showRing = g.rings > 0 && this.extras > 0.02;
  this.showPoints = (g.motes + g.sats) > 0 && this.extras > 0.02;
  // the egg wears the same mesh, markings and dither as the blob inside it
  var ue = this.uE, sh2 = g.shape;
  this.eggMesh.geometry = this.body.geometry;
  if (sh2 === 'mochi') ue.uEggS.value.set(0.92, 0.94, 0.14);
  else if (sh2 === 'bean') ue.uEggS.value.set(0.76, 1.16, 0.12);
  else if (sh2 === 'round') ue.uEggS.value.set(0.84, 1.02, 0.16);
  else ue.uEggS.value.set(0.80, 1.10, 0.24);
  ue.uCrk.value.set(g.eggCrackY, 0.2, g.eggTeeth, this.E.crack);
  ue.uFacet.value = g.flat ? 1 : 0;
  ue.uPatT.value = g.phase;
  ue.uPatQ.value.set(g.arms, 0);
  if (g.marks) { ue.uPat.value.set(g.pat[0], g.pat[1], g.pat[2], g.pat[3]); ue.uPatP.value.set(g.patScale, g.bands, g.twist, 1); ue.uEggM.value.set(px >= 28 ? 1 : 0, 0.6); }
  else { ue.uPat.value.set(0, 0, 0, 1); ue.uPatP.value.set(3.4, 3, 1, 1); ue.uEggM.value.set(px >= 28 ? 1 : 0, 0.82); }
  b.uDetail.value = this.detail;
  this.uP.uPx.value = px * 0.5;
  // what it wears was fitted to the body it had
  if (this.worn) this.worn.fit();
};

Orb.prototype.resize = function (size) {
  if (size) this.fixedSize = size;
  var css = this.fixedSize || (this.canvas && this.canvas.clientWidth) || 96;
  var dpr = Math.min(this.pixelRatio || (typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
  var dev = Math.max(2, Math.round(css * dpr)), px = dev;
  if (this.retro) {
    // a low internal resolution, scaled up by a whole number of device pixels
    var want = css <= 48 ? css : 48 + (css - 48) * 0.24;
    px = Math.max(8, Math.round(dev / Math.max(1, Math.round(dev / want))));
  }
  if (px === this.px && css === this.css) return;
  this.css = css; this.px = px;
  if (this.canvas) {
    if (this.canvas.width !== px) { this.canvas.width = px; this.canvas.height = px; }
    if (this.canvas.style) this.canvas.style.imageRendering = this.retro ? 'pixelated' : '';
  }
  this._lod();
};

Orb.prototype.setState = function (state, variant) {
  if (state === 'egg') {
    // the waiting egg (mascot look); the glass look has no egg and just idles
    if (this.retro) { this.eggMode = 'egg'; this.born = 0; this.eggWait = 1.2; var E = this.E; E.crack = this.eggCrack; E.burst = 0; E.fade = 1; E.roll = 0; E.squash = 0; E.rockT = 9; }
    this._calm();
    return;
  }
  if (STATES.indexOf(state) < 0) return;
  if (this.eggMode !== 'none') this._endEgg(false);
  if (variant && VARIANTS.indexOf(variant) >= 0) this.variant = variant;
  if (state === this.state) return;
  var prev = this.state, ms = this.reduced ? 0.2 : 1, hop = this.retro ? 1.35 : 1;
  this.state = state; this.stateT = 0;
  if (prev === 'asleep') { this.sp.squash.v += 1.6 * ms; this.sp.lift.v += 0.6 * ms * hop; this.flowBoost = 1.2; this.blink(); }
  if (state === 'listening') { this.sp.squash.v += 0.9 * ms; this.sp.lift.v += 0.5 * ms * (hop - 0.6); }
  if (state === 'thinking' && this.rnd() < 0.6) this.blink();
  if (state === 'done') {
    this.sp.lift.v += 1.7 * ms * hop; this.sp.squash.v += 1.8 * ms; this.flash = 1; this.nod = 1;
    this.spawnRing({ r0: 0.9, r1: 2.3, dur: 0.9, a: 0.7, w: 0.16, ease: 1 });
  }
  if (state === 'error') { this.shakeT = 0; this.shakeAmp = 1; this.twitchT = 1.6; this.sp.squash.v -= 1.4 * ms; }
  if (state === 'waiting') { this.waitT = 0.82; }
  if (state === 'working') { this.cmd = 0; this.file = 0; this.searchT = 0.75; this.memT = 0; }
  if (state === 'speaking') { this.simLeft = 0; this.simT = 0.05; }
};

// Back to a plain idle with nothing blending in from an earlier state.
Orb.prototype._calm = function () {
  this.state = 'idle'; this.stateT = 0;
  for (var i = 0; i < STATES.length; i++) this.w[STATES[i]] = STATES[i] === 'idle' ? 1 : 0;
  this.flash = 0; this.swell = 0; this.gulp = 0; this.tick = 0; this.gapeTo = 0; this.chew = 0;
};
Orb.prototype._endEgg = function (tell) {
  var was = this.eggMode;
  this.eggMode = 'none'; this.born = 1; this.bornY = 0; this.sp.born.x = 1; this.sp.born.v = 0; this.sp.born.t = 1;
  this.E.burst = 0; this.E.crack = 0; this.E.fade = 1; this.eggCrack = 0;
  if (tell && was === 'hatch') {
    var out = this.onOut; this.onOut = null;
    if (out) out();
    var fn = this.onHatched; this.onHatched = null;
    if (fn) fn();
    if (this.onAuto) this.onAuto('idle');
  }
};
// Play the hatch (mascot look). It is one short timeline, hatchT seconds out of hatchDur, so skipHatch()
// can jump to its end at any moment. onDone is called once, whether it played through or was skipped.
Orb.prototype.hatch = function (opts) {
  opts = opts || {};
  this.onHatched = opts.onDone || null;
  this.onOut = opts.onOut || null;
  this._calm();
  this.eggMode = 'hatch';
  if (!this.retro) { this._endEgg(true); return; }
  this.hatchT = 0; this.hatchPh = 0; this.hatchDur = this.reduced ? 0.9 : 5.3;
  this.born = 0; this.bornY = 0;
  var E = this.E; E.crack = 0; E.burst = 0; E.fade = 1; E.roll = 0; E.squash = 0; E.jolt = 0;
  // an egg that was cracked while it waited goes on from there, and not from a whole shell
  if (!this.reduced && this.eggCrack >= 0.3) { this.hatchT = this.eggCrack >= 0.6 ? 1.6 : 1.2; E.crack = this.eggCrack >= 0.6 ? 0.67 : 0.34; }
  for (var i = 0; i < 4; i++) this.rings[i].on = false;
};
// How cracked the waiting egg is, from 0 (whole) to 1. It keeps its cracks while it waits, and jolts as it gets one.
Orb.prototype.crack = function (amount) {
  var was = this.eggCrack;
  this.eggCrack = clamp(amount, 0, 1);
  if (this.eggMode !== 'egg' || this.eggCrack <= was || this.reduced) return;
  var E = this.E;
  E.jolt = 1; E.rockT = 0; E.rockA = this.rnd() < 0.5 ? -0.2 : 0.2; this.sp.eggY.v += 0.7;
};
// Where it stands in its own picture, for a host that puts it on something: the ground under it, measured
// down from the top, and how tall its egg is, both as parts of the picture's side.
Orb.prototype.stance = function () {
  return { ground: (1 - this.uH.uGround.value.z) / 2, egg: this.fill * 0.92 * this.uE.uEggS.value.y };
};
Orb.prototype.skipHatch = function () { if (this.eggMode === 'hatch') this._endEgg(true); };
// 'egg', 'hatching' or the current state name
Orb.prototype.getState = function () { return this.eggMode === 'egg' ? 'egg' : this.eggMode === 'hatch' ? 'hatching' : this.state; };

// The egg's share of a frame: the resting wobbles, or the hatch timeline.
Orb.prototype._egg = function (dt, hop) {
  var sp = this.sp, rnd = this.rnd, E = this.E, o = this.eo;
  E.jolt *= decay(dt, 0.12);
  this.bornY *= decay(dt, 0.2);
  if (this.eggMode === 'egg') {
    // waiting: every few seconds it rocks, sometimes with a little hop
    this.born = 0; E.crack = this.eggCrack; E.burst = 0; E.fade = 1; E.squash = 0;
    E.rockT += dt;
    this.eggWait -= dt;
    if (this.eggWait <= 0 && !this.reduced) {
      this.eggWait = 2.2 + rnd() * 3.2; E.rockT = 0; E.rockA = (0.10 + 0.10 * rnd()) * (rnd() < 0.5 ? -1 : 1);
      if (rnd() < 0.35) sp.eggY.v += 0.9;
    }
    E.roll = E.rockA * Math.sin(E.rockT * TAU * 3.0) * Math.exp(-E.rockT * 2.6);
  } else {
    var prev = this.hatchT, t = (this.hatchT += dt);
    var at = function (x) { return prev < x && t >= x; };
    if (this.reduced) {
      // reduced motion: the egg dissolves into the blob
      var f = clamp(t / this.hatchDur, 0, 1);
      E.fade = 1 - f; o.fade = f; this.born = 1; E.roll = 0; E.squash = 0; E.crack = 0; E.burst = 0;
    } else {
      E.fade = 1;
      // beat 1 (0 to 1.5 s): the wobbles build
      var grow = clamp(t / 1.5, 0, 1);
      this.hatchPh += dt * TAU * lerp(2.4, 4.6, grow);
      var rock = (0.04 + 0.20 * grow * grow) * (1 - 0.6 * smooth(1.45, 1.6, t));
      E.roll = (rock * Math.sin(this.hatchPh) + E.jolt * 0.16 * Math.sin(t * 60)) * (1 - smooth(2.5, 2.65, t));
      if (at(0.7) || at(1.2)) sp.eggY.v += 0.9;
      // beat 2 (1.5 to 2.5 s): cracks, in three snaps
      if (at(1.5)) { E.crack = 0.34; E.jolt = 1; sp.eggY.v += 0.6; }
      if (at(1.95)) { E.crack = 0.67; E.jolt = 1; sp.eggY.v += 0.6; }
      if (at(2.4)) { E.crack = 1; E.jolt = 1; sp.eggY.v += 0.8; }
      // beat 3 (2.55 to 2.9 s): it gathers itself
      E.squash = t < 2.9 ? -0.2 * smooth(2.55, 2.85, t) : 0;
      // beat 4 (2.9 s): it breaks: shards, a ring, and the blob hops out with its eyes shut
      if (at(2.9)) {
        var out = this.onOut; this.onOut = null;
        if (out) out();
        this.flash = 1; this.bornY = this.eggYc - this.rest;
        sp.born.x = 0.45; sp.born.v = 3; sp.born.t = 1; sp.lift.v += 2.4 * hop; sp.squash.v += 2.2;
        this.spawnRing({ r0: 0.8, r1: 2.4, dur: 0.8, a: 0.75, w: 0.16, ease: 1 });
      }
      E.burst = t >= 2.9 ? (t - 2.9) / 0.95 : 0;
      this.born = t >= 2.9 ? 1 : 0;
      if (t >= 2.9) {
        // beats 5 to 8: eyes open (3.65 s), a blink, a look left, right and up, then a pleased little hop (5.0 s)
        o.use = true; o.gx = 0; o.gy = 0;
        o.close = t < 3.65 ? 1 : 0;
        if (at(3.95)) this.blink();
        o.up = t > 3.65 && t < 5.0 ? 0.22 : 0;
        if (t > 4.0 && t < 4.35) { o.gx = -0.85; o.gy = 0.1; }
        else if (t > 4.35 && t < 4.7) { o.gx = 0.85; o.gy = 0.15; }
        else if (t > 4.7 && t < 5.0) { o.gx = 0.1; o.gy = 0.75; }
        if (at(5.0)) { this.joy = 1; sp.lift.v += 1.0 * hop; sp.squash.v += 1.2; }
      }
    }
    if (t >= this.hatchDur) this._endEgg(true);
  }
  sp.born.step(dt); sp.eggY.step(dt);
};

// Outside events: 'token' while an answer streams, 'key' while the user types.
Orb.prototype.feed = function (kind, amount) {
  amount = amount == null ? 1 : amount;
  this.lastFeed[kind] = this.t;
  if (kind === 'token') this._voice(0.5 + 0.5 * amount);
  else if (kind === 'key') { this.keyPulse = 1; this.sp.squash.v -= 0.22 * (this.reduced ? 0.2 : 1); }
};
Orb.prototype._voice = function (amount) {
  // the first word after a pause gets a little bounce
  if (this.t - this.lastVoice > 0.3 && !this.reduced) { this.sp.lift.v += this.retro ? 0.55 : 0.25; this.sp.squash.v += this.retro ? 0.8 : 0.4; }
  this.lastVoice = this.t;
  this.voiceImp = Math.min(1.15, this.voiceImp * 0.55 + amount);
};
Orb.prototype.blink = function () { if (this.blinkP < 0) this.blinkP = 0; };

// A hand on it: x is where across it, -1 at its left edge to 1 at its right; amount is how much of a stroke,
// 1 for a whole pat. It shuts its eyes, smiles and leans into the hand, the more so the longer the stroking
// goes on, and comes out of it by itself once left alone. An egg only rocks.
Orb.prototype.pet = function (x, amount) {
  if (this.eggMode === 'hatch') return;
  x = clamp(x || 0, -1, 1);
  if (this.eggMode === 'egg') {
    if (!this.reduced && this.E.rockT > 0.45) { this.E.rockT = 0; this.E.rockA = x < 0 ? 0.13 : -0.13; this.eggWait = Math.max(this.eggWait, 1.5); }
    return;
  }
  // the first touch presses it down a little
  if (this.petK < 0.12) this.sp.squash.v -= 1.3 * (this.reduced ? 0.2 : 1);
  this.petK = Math.min(1, this.petK + (amount == null ? 0.3 : amount));
  this.petX = x;
};

// A treat is held out to it, or taken away again: its mouth opens for it and stays open. An egg has no mouth.
Orb.prototype.offer = function (on) { this.gapeTo = on && this.eggMode === 'none' ? 1 : 0; };
// It takes a bite: the mouth snaps wide and shut, and the whole of it bobs with the effort.
Orb.prototype.bite = function () {
  if (this.eggMode !== 'none') return;
  this.gapeTo = 0; this.chew = 1;
  if (!this.reduced) this.sp.squash.v -= 1.1;
};
// A pleased little hop with its eyes shut, whatever else it is doing.
Orb.prototype.cheer = function () {
  // an egg can only hop where it stands, and rock
  if (this.eggMode === 'egg' && !this.reduced) { this.sp.eggY.v += 0.9; this.E.rockT = 0; this.E.rockA = this.rnd() < 0.5 ? -0.16 : 0.16; }
  if (this.eggMode !== 'none') return;
  this.joy = 1;
  if (!this.reduced) { this.sp.lift.v += this.retro ? 1.35 : 1; this.sp.squash.v += 1.2; }
};

// Point its attention at a place on screen (client coordinates); it lets go by itself after a moment. null lets go now.
Orb.prototype.setPointer = function (x, y) {
  if (x == null) { this.ptr.t = -1e9; this.attn.target = 0; return; }
  this.ptr.x = x; this.ptr.y = y; this.ptr.t = now();
};
// Where the orb's attention is pulled, in orb-relative units (-1..1, y up). strength 0..1.
Orb.prototype.attend = function (x, y, strength) { this.attn.x = x; this.attn.y = y; this.attn.target = strength; };

Orb.prototype.spawnRing = function (o) {
  var slot = null, i;
  for (i = 0; i < 4; i++) if (!this.rings[i].on) { slot = this.rings[i]; break; }
  if (!slot) { slot = this.rings[0]; for (i = 1; i < 4; i++) if (this.rings[i].t / this.rings[i].dur > slot.t / slot.dur) slot = this.rings[i]; }
  slot.on = true; slot.t = 0; slot.dur = o.dur; slot.r0 = o.r0; slot.r1 = o.r1; slot.a = o.a; slot.w = o.w; slot.ease = o.ease || 0;
};

Orb.prototype.update = function (dt) {
  var g = this.g, w = this.w, wv = this.wv, p = this.p, e = this.e, sp = this.sp, rnd = this.rnd, R = this.retro;
  var ms = this.reduced ? 0.2 : 1;        // spatial motion scale
  var ts = this.reduced ? 0.4 : 1;        // tempo scale for busy gestures
  var hop = R ? 1.35 : 1;                 // the mascot jumps a little higher
  var i, s, key, a;
  this.t += dt; this.stateT += dt;
  var t = this.t;

  // --- egg and hatching ---
  var eo = this.eo;
  eo.use = false; eo.close = 0; eo.up = 0; eo.fade = 1;
  if (this.eggMode !== 'none') this._egg(dt, hop);

  // --- state weights ---
  var k = 1 - decay(dt, this.state === 'error' ? 0.16 : R ? 0.21 : 0.27), sum = 0;
  for (i = 0; i < STATES.length; i++) { s = STATES[i]; w[s] += ((s === this.state ? 1 : 0) - w[s]) * k; sum += w[s]; }
  for (i = 0; i < STATES.length; i++) w[STATES[i]] /= sum;
  var kv = 1 - decay(dt, 0.25);
  for (i = 0; i < VARIANTS.length; i++) { s = VARIANTS[i]; wv[s] += ((s === this.variant ? 1 : 0) - wv[s]) * kv; }
  for (i = 0; i < POSE_KEYS.length; i++) {
    key = POSE_KEYS[i]; a = 0;
    for (s = 0; s < STATES.length; s++) a += w[STATES[s]] * POSE[STATES[s]][key];
    p[key] = a;
  }
  for (i = 0; i < EXPR_KEYS.length; i++) {
    key = EXPR_KEYS[i]; a = 0;
    for (s = 0; s < STATES.length; s++) a += w[STATES[s]] * EXPR[STATES[s]][key];
    e[key] = a;
  }
  var aCmd = w.working * wv.command, aFile = w.working * wv.file, aSearch = w.working * wv.search, aMem = w.working * wv.memory;

  if (this.state === 'done' && this.stateT > 1.7) { this.setState('idle'); if (this.onAuto) this.onAuto('idle'); }

  // --- impulses decay ---
  this.flash *= decay(dt, 0.42); this.tick *= decay(dt, this.reduced ? 0.24 : 0.10); this.swell *= decay(dt, 0.55); this.gulp *= decay(dt, 0.30);
  this.flowBoost *= decay(dt, 1.1); this.keyPulse *= decay(dt, 0.13); this.nod *= decay(dt, 0.22); this.joy *= decay(dt, 0.45); this.petK *= decay(dt, 0.6);
  this.chew *= decay(dt, 0.1); this.gape += (this.gapeTo - this.gape) * (1 - decay(dt, 0.07));
  var agape = Math.max(this.gape, this.chew);
  var pet = smooth(0.08, 0.6, this.petK);

  // --- breathing ---
  this.breath += dt * TAU * p.hz * g.breathHz;
  var br = Math.sin(this.breath + 0.4 * Math.sin(this.breath));

  // --- idle behaviours: glance, settle, drift, a passing thought, a stretch, a hop ---
  if (w.idle > 0.75) {
    this.idleT -= dt;
    if (this.idleT <= 0) {
      this.idleT = (3.0 + rnd() * 4.5) / g.restless;
      var pick = rnd();
      if (pick < 0.34) {
        var ga = rnd() * TAU; this.glance.x = Math.cos(ga) * (0.5 + 0.4 * rnd()) + 0.2 * g.side; this.glance.y = Math.sin(ga) * 0.45; this.glanceT = 0.8 + rnd() * 1.1;
      } else if (pick < 0.52) {
        sp.squash.v -= 1.5 * ms; sp.lift.v -= 0.35 * ms;
      } else if (pick < 0.66) {
        this.drift.x = (rnd() - 0.5) * 0.16; this.drift.y = (rnd() - 0.4) * 0.10; this.drift.t = 2.5 + rnd() * 2.5;
      } else if (pick < 0.78) {
        this.flowBoost = 1.6 + rnd(); this.glance.x = 0.3 * g.side; this.glance.y = 0.55; this.glanceT = 0.9;
      } else if (pick < 0.90) {
        sp.squash.v += 1.5 * ms; sp.lift.v += 0.4 * ms; this.glance.x = 0.15 * g.side; this.glance.y = 0.7; this.glanceT = 1.2;
      } else {
        sp.lift.v += 1.2 * ms * hop; sp.squash.v += 1.4 * ms; this.blink();
      }
    }
  }
  this.glanceT -= dt; this.drift.t -= dt;
  if (this.drift.t <= 0) { this.drift.x = 0; this.drift.y = 0; }

  // --- pointer / attention ---
  this.attn.k += (this.attn.target - this.attn.k) * (1 - decay(dt, 0.35));
  var ak = this.notice ? this.attn.k : 0;

  // --- thinking: the inner light circles while it mulls ---
  this.think += dt * 2.5 * g.tempo * ts * (0.25 + 0.75 * Math.min(1, w.thinking * 2 + 0.3));

  // --- working gestures ---
  this.work += dt * TAU * 1.4 * ts;
  var cmdPrev = Math.floor(this.cmd);
  this.cmd += dt * 3.3 * ts * g.tempo;
  if (aCmd > 0.3 && Math.floor(this.cmd) !== cmdPrev) {
    this.tick = 1;
    if (Math.floor(this.cmd) % 8 === 0) this.cmdCycle += 1;
  }
  var cmdStep = (Math.floor(this.cmd) % 8) + 1;
  var filePrev = Math.floor(this.file);
  this.file += dt * 1.05 * ts * g.tempo;
  if (Math.floor(this.file) !== filePrev) this.fileLine = (this.fileLine + 1) % 3;
  var ff = this.file - Math.floor(this.file);
  var fileX = ff < 0.82 ? lerp(-0.95, 0.95, smooth(0, 0.82, ff) * 0.4 + (ff / 0.82) * 0.6) : lerp(0.95, -0.95, smooth(0.82, 1, ff));
  var fileOn = ff < 0.82 ? smooth(0, 0.08, ff) * (1 - smooth(0.74, 0.82, ff)) : 0;
  if (aSearch > 0.3) {
    this.searchT += dt * ts;
    if (this.searchT > 0.8) { this.searchT = 0; this.spawnRing({ r0: 0.05, r1: 2.3, dur: 1.7, a: 0.55, w: 0.11, ease: 0 }); }
    this.sacT -= dt * ts;
    if (this.sacT <= 0) { this.sacT = 0.45 + rnd() * 0.5; var sa = rnd() * TAU; this.sac.x = Math.cos(sa) * 0.9; this.sac.y = Math.sin(sa) * 0.5; }
  }
  if (aMem > 0.3) {
    this.memT += dt * ts;
    if (this.memT > 1.25) { this.memT = 0; this.memHit = 0.95; this.spawnRing({ r0: 2.2, r1: 0.0, dur: 1.05, a: 0.6, w: 0.12, ease: 2 }); }
    if (this.memHit > 0) { this.memHit -= dt * ts; if (this.memHit <= 0) { this.gulp = 1; sp.squash.v -= 0.9 * ms; } }
  }

  // --- speaking: an envelope that follows token bursts ---
  if (this.state === 'speaking' && t - this.lastFeed.token > 0.7) {
    this.simT -= dt;
    if (this.simT <= 0) {
      if (this.simLeft <= 0) { this.simLeft = 3 + Math.floor(rnd() * 10); this.simT = 0.16 + rnd() * 0.34; }
      else { this.simLeft--; this.simT = 0.05 + rnd() * 0.07; this._voice(0.6 + 0.5 * rnd()); }
    }
  }
  if (this.state === 'listening' && t - this.lastFeed.key > 1.2) {
    this.simT -= dt;
    if (this.simT <= 0) { this.simT = rnd() < 0.2 ? 0.5 + rnd() * 0.7 : 0.09 + rnd() * 0.14; this.keyPulse = 1; sp.squash.v -= 0.22 * ms; }
  }
  this.voiceImp *= decay(dt, 0.085);
  var vk = this.voiceImp > this.voice ? (this.reduced ? 0.2 : 0.03) : (this.reduced ? 0.5 : 0.15);
  this.voice += (this.voiceImp - this.voice) * (1 - decay(dt, vk));
  var voice = this.voice * w.speaking;
  this.voicePhase += dt * (6 + 10 * voice);

  // --- waiting: a small hop and swell, then stillness ---
  if (w.waiting > 0.5) {
    this.waitT += dt / (this.reduced ? 3.6 : 2.7);
    if (this.waitT >= 1) {
      this.waitT -= 1; this.waitSide = -this.waitSide; this.swell = 1;
      sp.lift.v += 1.5 * ms * hop; sp.squash.v += 1.3 * ms;
      this.spawnRing({ r0: 0.95, r1: 1.95, dur: 1.5, a: 0.42, w: 0.2, ease: 1 });
    }
  }

  // --- error: one shake, then the odd twitch ---
  this.shakeT += dt;
  if (w.error > 0.5) {
    this.twitchT -= dt;
    if (this.twitchT <= 0) { this.twitchT = 1.3 + rnd() * 2.0; this.shakeT = 0; this.shakeAmp = 0.35 + rnd() * 0.25; }
    this.stutterT -= dt;
    if (this.stutterT <= 0) { this.stutterT = 0.08 + rnd() * 0.3; this.stutter = rnd() < 0.45 ? 0.05 : 1.2 + rnd() * 2.2; }
  }
  var shake = Math.sin(this.shakeT * TAU * 7.5) * Math.exp(-this.shakeT * 5.5) * this.shakeAmp * ms;
  var dizzy = Math.exp(-this.shakeT * 1.5) * this.shakeAmp * w.error * ms;
  var stut = lerp(1, this.stutter, w.error);
  var flick = 1 - w.error * 0.35 * (this.stutter < 0.5 ? 1 : 0);

  // --- rings ---
  var rw = 1 + 1.4 * (1 - this.detail);
  for (i = 0; i < 4; i++) {
    var Rg = this.rings[i], u = this.uB.uRings.value[i];
    if (Rg.on) { Rg.t += dt * (this.reduced ? 0.6 : 1); if (Rg.t >= Rg.dur) Rg.on = false; }
    if (!Rg.on) { u.set(5, 0, 1); continue; }
    var f = Rg.t / Rg.dur, ez = Rg.ease === 1 ? 1 - (1 - f) * (1 - f) : Rg.ease === 2 ? f * f : f;
    u.set(lerp(Rg.r0, Rg.r1, ez), Rg.a * smooth(0, 0.14, f) * (1 - smooth(0.45, 1, f)), Rg.w * rw);
  }

  // --- gaze: every state says where it is looking; the blend is the gaze ---
  var gx = 0, gy = 0;
  var wx = 0.22 * Math.sin(t * 0.23 + g.ph[1]) + 0.10 * Math.sin(t * 0.61 + g.ph[2]);
  var wy = 0.15 * Math.sin(t * 0.19 + g.ph[3]) + 0.08 * Math.sin(t * 0.47 + g.ph[0]);
  var ix = this.glanceT > 0 ? this.glance.x : wx, iy = this.glanceT > 0 ? this.glance.y : wy;
  ix = lerp(ix, this.attn.x, ak * 0.9); iy = lerp(iy, this.attn.y, ak * 0.9);
  gx += w.idle * ix; gy += w.idle * iy;
  gx += w.listening * lerp(this.text.x, this.attn.x, ak * 0.45); gy += w.listening * lerp(this.text.y, this.attn.y, ak * 0.45);
  gx += w.thinking * (g.side * 0.55 + 0.14 * Math.sin(t * 0.7)); gy += w.thinking * (0.62 + 0.08 * Math.sin(t * 1.1));
  var cs4 = (cmdStep - 1) % 4;
  gx += aCmd * (-0.36 + cs4 * 0.24); gy += aCmd * (-0.25 - (cmdStep > 4 ? 0.2 : 0));
  gx += aFile * fileX * 0.8; gy += aFile * (0.05 - this.fileLine * 0.2);
  gx += aSearch * (this.reduced ? 0.7 * Math.sin(t * 0.9) : this.sac.x); gy += aSearch * (this.reduced ? 0.2 : this.sac.y);
  gy += aMem * 0.3; gx += aMem * 0.25 * g.side;
  gx += w.speaking * lerp(this.text.x * 0.25 + 0.08 * Math.sin(t * 1.3), this.attn.x, ak * 0.5); gy += w.speaking * lerp(this.text.y * 0.2, this.attn.y, ak * 0.5);
  gx += w.waiting * lerp(0.0, this.attn.x, ak * 0.8); gy += w.waiting * lerp(0.05, this.attn.y, ak * 0.8);
  gy += w.done * (0.1 - this.nod * 0.9);
  gx += w.error * (-0.5 * g.side); gy += w.error * -0.5;
  gy += w.asleep * -0.6;
  if (eo.use) { gx = eo.gx; gy = eo.gy; }
  gx = clamp(gx, -1, 1); gy = clamp(gy, -1, 1);
  // a big jump of the eyes often comes with a blink
  var jump = Math.abs(gx - this.gazePrev.x) + Math.abs(gy - this.gazePrev.y);
  if (jump > 0.55 && this.blinkP < 0 && e.blink > 0.2 && rnd() < 0.3) this.blink();
  this.gazePrev.x = gx; this.gazePrev.y = gy;
  sp.gx.f = sp.gy.f = this.reduced ? 1.0 : R ? 2.6 : 2.0;
  sp.ex.f = sp.ey.f = this.reduced ? 1.3 : 5.5;
  sp.gx.t = sp.ex.t = gx; sp.gy.t = sp.ey.t = gy;
  sp.gx.step(dt); sp.gy.step(dt); sp.ex.step(dt); sp.ey.step(dt);
  var gzx = sp.gx.x, gzy = sp.gy.x;

  // --- blinks and the small movements of the eyes ---
  if (e.blink > 0.05 && e.close < 0.5 && eo.close < 0.5) {
    this.blinkT -= dt * e.blink * (this.reduced ? 0.6 : 1);
    if (this.blinkT <= 0) {
      this.blink();
      this.blinkT = g.blinkEvery * (0.45 + 1.1 * rnd());
      if (rnd() < g.blinkDouble) this.blinkQ = 0.30;
    }
  }
  if (this.blinkQ > 0) { this.blinkQ -= dt; if (this.blinkQ <= 0) this.blink(); }
  if (this.blinkP >= 0) {
    this.blinkP += dt * g.blinkSpeed * (this.reduced ? 0.6 : 1);
    var bp = this.blinkP;
    this.blinkV = bp < 0.07 ? bp / 0.07 : bp < 0.12 ? 1 : bp < 0.27 ? 1 - (bp - 0.12) / 0.15 : 0;
    if (bp >= 0.27) { this.blinkP = -1; this.blinkV = 0; }
  }
  this.micro.t -= dt;
  if (this.micro.t <= 0) {
    this.micro.t = 0.35 + rnd() * 1.4;
    var mk = this.reduced ? 0 : (1 - w.asleep) * (0.5 + 0.5 * e.blink);
    this.micro.x = (rnd() - 0.5) * 0.10 * mk; this.micro.y = (rnd() - 0.5) * 0.07 * mk;
  }

  // --- body: position, scale, squash, roll ---
  var bob = 0.010 * Math.sin(this.work) * w.working * ms;
  var fl = 0.5 + 0.5 * Math.min(1, p.wob);
  sp.x.t = gzx * 0.05 * p.lean + this.drift.x * w.idle + 0.012 * Math.sin(t * 0.37 + g.ph[1]) * fl * ms + aFile * fileX * 0.02;
  sp.y.t = gzy * 0.04 * p.lean + this.drift.y * w.idle + 0.016 * Math.sin(t * 0.29 + g.ph[2]) * fl * ms;
  sp.lift.t = p.lift; sp.scale.t = p.scale; sp.squash.t = p.squash - pet * 0.07 * ms;
  sp.roll.t = -gzx * 0.13 * p.lean + w.waiting * this.waitSide * 0.13 + w.thinking * (0.08 * g.side + 0.05 * Math.sin(t * 0.9) * ms) + w.error * 0.09 * g.side + w.asleep * 0.07 * g.side
    // petted: it leans into the hand and rubs against it
    - pet * (this.petX * 0.14 + 0.035 * Math.sin(t * 10.5)) * ms;
  if (this.reduced) { sp.squash.z = 1; sp.lift.z = 1; }
  else { sp.squash.z = g.bounce - (R ? 0.08 : 0); sp.lift.z = g.bounce + (R ? 0 : 0.1); }
  sp.squash.f = R ? 3.3 : 2.9; sp.lift.f = R ? 2.3 : 2.0;
  sp.x.step(dt); sp.y.step(dt); sp.lift.step(dt); sp.scale.step(dt); sp.squash.step(dt); sp.roll.step(dt);

  var ex = this.exag;
  var scale = sp.scale.x * (1 + p.breath * br * (this.reduced ? 0.5 : 1) * ex)
    + (voice * 0.055 + this.tick * 0.016 * aCmd + this.swell * 0.03 * w.waiting + this.flash * 0.045 + this.gulp * 0.04 * aMem + this.keyPulse * 0.006 * w.listening) * ex * (this.reduced ? 0.25 : 1);
  this.velStretch += (clamp(sp.lift.v * 0.14, -0.08, 0.1) - this.velStretch) * (1 - decay(dt, 0.06));
  var squash = sp.squash.x + p.breath * br * (R ? 0.9 : 0.5) * ms + voice * 0.05 * ms + this.velStretch * ms;
  squash = clamp(squash, -0.3, 0.35);
  var sy = 1 + squash, sx = 1 / Math.sqrt(sy);
  var S = this.fill * scale * (this.eggMode === 'hatch' ? Math.max(sp.born.x, 0.05) : 1);
  var X = sp.x.x + shake * 0.085, Y = this.rest + sp.y.x + sp.lift.x + bob + this.bornY;
  var lim = Math.max(0, 0.985 - S * 1.03);
  X = clamp(X, -lim, lim); Y = clamp(Y, -lim + Math.min(0, this.rest), lim);
  var roll = sp.roll.x + shake * 0.2;
  if (R) {
    // hold poses on the pixel grid: whole pixels for position, half pixels for size
    var pu = 2 / this.px;
    X = Math.round(X / pu) * pu; Y = Math.round(Y / pu) * pu; S = Math.round(S / pu * 2) * pu / 2;
  }

  // --- flows ---
  var flow = p.flow * (1 + this.flowBoost) * stut * (this.reduced ? 0.35 : 1);
  this.tFlow += dt * g.flowSpd * flow;
  this.tPat += dt * flow * g.tempo * 0.6;
  this.inner += dt * g.spinSpd * p.spin * (1 + this.flowBoost * 1.5) * stut * (this.reduced ? 0.35 : 1) * 2.2;
  this.tMote += dt * p.mote * g.moteSpd * (this.reduced ? 0.35 : 1);
  this.tSat += dt * g.satSpd * (0.4 + 0.6 * p.mote) * (this.reduced ? 0.35 : 1);

  // --- write uniforms ---
  var b = this.uB, m = M4;
  // the head turns after the eyes; the whole body is the head
  var hk = 0.5 + 0.5 * p.lean;
  var yaw = gzx * 0.34 * hk + 0.06 * Math.sin(t * 0.31 + g.ph[3]) * fl * ms;
  var pitch = -gzy * 0.26 * hk;
  m.rot.makeRotationFromEuler(m.e.set(pitch, yaw, 0, 'XYZ'));
  m.a.makeTranslation(X, Y, 0);
  m.a.multiply(m.b.makeRotationZ(roll));
  m.a.multiply(m.b.makeScale(sx, sy, sx));
  m.a.multiply(m.rot);
  m.a.multiply(m.b.makeScale(S, S, S));
  this.body.matrix.copy(m.a); this.body.matrixWorldNeedsUpdate = true;
  m.b.makeRotationZ(roll).multiply(m.rot).transpose();
  b.uFront.value.set(0, 0, 1).applyMatrix4(m.b);

  var ampK = 0.5 + 0.5 * Math.min(1.3, p.wob);
  b.uFlow.value.set(g.flowDir[0] * this.tFlow + g.ph[0], g.flowDir[1] * this.tFlow + g.ph[1], g.flowDir[2] * this.tFlow + g.ph[2]);
  b.uFlow2.value.set(-g.flowDir[0] * this.tFlow * 1.7 + 11.3, g.flowDir[1] * this.tFlow * 1.9 + 4.1, g.flowDir[2] * this.tFlow * 1.6 + 7.7);
  if (R) {
    b.uSurf.value.y = g.amp * 0.55 * ampK;
    b.uVoice.value.set(0, 0, 7);
  } else {
    b.uSurf.value.set(g.freq, g.amp * ampK * (this.reduced ? 0.8 : 1), g.freq2, g.amp2 * ampK * this.detail);
    b.uVoice.value.set(voice * 0.045 * ms * lerp(0.5, 1, this.detail), this.voicePhase, 7.0);
    m.rot.makeRotationFromEuler(m.e.set(g.axisX, this.inner, g.axisZ, 'XZY'));
    b.uInner.value.setFromMatrix4(m.rot);
    b.uPatT.value = this.tPat + g.phase;
  }
  b.uCenterV.value.set(X, Y, -3.7320508);
  b.uS.value = S;

  var orbit = w.thinking * 0.44;
  var cz = Math.sin(this.think);
  b.uCorePos.value.set(
    gzx * 0.2 * (1 - w.thinking) + orbit * Math.cos(this.think) * g.side,
    gzy * 0.2 * (1 - w.thinking) + orbit * cz * 0.72 + w.asleep * -0.12,
    0);
  var core = g.coreGain * (p.core + voice * 0.6 + this.tick * 0.55 * aCmd * ex + this.swell * 0.45 * w.waiting + this.flash * 0.9 + this.gulp * 0.8 * aMem + this.keyPulse * 0.14 * w.listening + 0.06 * br + aMem * 0.15) * flick;
  b.uCore.value.set(core, g.coreSize * p.coreSize * (1 + 0.25 * this.gulp * aMem + 0.15 * voice) * lerp(1.15, 1, this.detail), 0);
  b.uLamp.value = 0.35 * clamp(core - 0.6, 0, 1.4);

  // the body's own shine sits up and to the left and only leans a little with the head
  var gdx = -0.40 + gzx * 0.2, gdy = 0.52 + gzy * 0.18, gl2 = gdx * gdx + gdy * gdy;
  if (gl2 > 0.86) { var gs = Math.sqrt(0.86 / gl2); gdx *= gs; gdy *= gs; gl2 = 0.86; }
  b.uGaze.value.set(gdx, gdy, Math.sqrt(1 - gl2));
  var glint = g.glintGain * p.glint * flick * (1 + 0.25 * this.keyPulse * w.listening);
  if (R) b.uGlint.value.set(this.px < 40 ? 0 : glint, 1 - (g.flat ? 0.022 : 0.016) * lerp(1.3, 0.6, (g.glintPow - 16) / 44));
  else b.uGlint.value.set(glint, g.glintPow * lerp(0.5, 1, this.detail) * (1 + 0.5 * w.listening));
  b.uRim.value = R && this.px < 40 ? -9 : g.rim * (p.rim + 0.25 * voice + 0.3 * this.flash + 0.2 * this.keyPulse * w.listening);
  b.uGrade.value.set(p.sat, p.bright * (1 + 0.035 * br * ex * (R ? 0 : 1)) + (voice * 0.10 + this.tick * 0.06 * aCmd) * (ex - 0.4),
    R ? this.flash * 0.3 + this.tick * 0.05 * aCmd : this.flash * 0.22 + this.swell * 0.05 * w.waiting, w.error - w.asleep);
  b.uFade.value = eo.fade;
  b.uAcc.value.set(aCmd, aFile * fileOn, 0, 0);
  b.uAccP.value.set(cmdStep, fileX, this.cmdCycle % 97, this.tick);

  // --- the face ---
  var upv = e.up + eo.up + voice * 0.12 + this.keyPulse * 0.04 * w.listening + this.swell * 0.08 * w.waiting + aSearch * 0.2 - aMem * 0.12 + this.gape * 0.14;
  var esz = this.eyeScale * (1 + 0.10 * Math.max(0, upv - 1));
  var eA = g.eyeSize * esz, eB = eA * g.eyeAspect;
  b.uEye.value.set(Math.max(g.eyeSize + g.eyeGap, eA + (R ? 1.1 * (2 / this.px) / S : 0.035)), g.eyeY, eA, eB);
  var glad = Math.max(this.joy, pet);
  var smile = clamp(Math.max(e.smile, this.flash, glad), -1, 1), sm = Math.max(0, smile);
  var close = clamp(Math.max(e.close + this.flash * 0.95 + glad * 0.8 + this.gulp * 0.9 * aMem, this.blinkV, eo.close), 0, 1);
  var U = upv <= 1 ? lerp(-0.3, g.eyeLid, upv) : g.eyeLid + (upv - 1);
  var Lo = lerp(-1.25, 0.15, clamp(e.low + aMem * 0.08, 0, 1));
  var yc = lerp(-0.28, 0.06, sm);
  var curve = -0.16 - 0.52 * sm + 0.55 * Math.max(0, -smile) + 0.18 * this.blinkV * (1 - sm);
  var ad = (w.waiting * this.waitSide + (1 - w.waiting) * g.side) * e.asym;
  var tl = g.eyeTilt + e.tilt - aSearch * 0.16 - aMem * 0.10 + dizzy * 0.15 * Math.sin(t * 9);
  b.uLidL.value.set(lerp(U + ad * 0.3, yc + 0.01, close), lerp(Lo, yc - 0.01, close), curve, tl + ad * 0.12);
  b.uLidR.value.set(lerp(U - ad * 0.3, yc + 0.01, close), lerp(Lo, yc - 0.01, close), curve, tl - ad * 0.12);
  var pz = lerp(g.eyeAspect, 1, 0.55);
  // keep a little white above and below the pupil, whatever the eye shape
  var pr = clamp(g.pupilSize * e.pupil, 0.3, Math.min(0.97, 0.9 * pz));
  if (this.darkBody) pr = lerp(Math.min(pr, 0.62), pr, this.detail); else pr = Math.max(pr, lerp(0.88, pr, this.detail));
  var crisp = R ? (this.detail > 0.1 ? 1 : 0) : smooth(0.03, 0.4, this.detail);
  b.uEyeS.value.set(g.eyeN, pr, g.pupil === 'iris' && this.detail > 0.25 ? 0.56 : 0, crisp);
  var px = sp.ex.x * 0.38 + this.micro.x + dizzy * 0.22 * Math.cos(t * 11);
  var py = sp.ey.x * 0.34 + this.micro.y + dizzy * 0.22 * Math.sin(t * 11);
  var pl = Math.sqrt(px * px + py * py);
  if (pl > 0.5) { px *= 0.5 / pl; py *= 0.5 / pl; }
  var cursor = aCmd * smooth(0.25, 0.6, this.detail);
  b.uPup.value.set(px, py, pz, cursor);
  b.uEyeK.value.set(lerp(R ? 0.16 : 0.24, R ? 0.075 : 0.065, this.detail), R ? smooth(0.2, 0.6, this.detail) * 0.95 : 0.92, g.eyeHi2 && this.detail > 0.4 ? 1 : 0, (this.cmd % 1) < 0.55 ? 1 : 0.2);
  if (R) {
    // a mouth held open for a treat is wider as well as taller
    var mW = 0.085 * g.mouthW * e.mw * lerp(1.3, 1, this.detail) * (1 + 0.9 * agape);
    var mO = clamp(e.mo + voice * 0.95 + this.flash * 0.25 + agape * 1.15, 0, 1.6);
    b.uMouth.value.set(g.eyeY - eB - lerp(0.20, 0.15, this.detail), mW * (1 + 0.25 * pet), mO * 0.75, lerp(e.mc, 0.9, pet) + dizzy * 0.25 * Math.sin(t * 13));
    b.uMouthK.value.set(1, w.thinking * g.side * 0.05 + sp.ex.x * 0.03, lerp(0.34, 0.2, this.detail));
  } else b.uMouthK.value.set(0, 0, 0.2);

  // --- antenna or floating ball: it lags behind the body and springs back ---
  if (b.uTop.value.w > 0.5) {
    sp.ax.t = X - roll * 0.25; sp.ay.t = Y;
    sp.ax.z = this.reduced ? 1 : 0.22; sp.ay.z = this.reduced ? 1 : 0.25;
    sp.ax.step(dt); sp.ay.step(dt);
    var ox = clamp((sp.ax.x - sp.ax.t) / S, -0.45, 0.45), oy = clamp((sp.ay.x - sp.ay.t) / S, -0.3, 0.3);
    var cr = Math.cos(roll), sr = Math.sin(roll);
    b.uBend.value.set(cr * ox + sr * oy, (-sr * ox + cr * oy) * 0.6 + (g.top === 'floater' ? 0.05 * Math.sin(t * 1.7) * ms : 0), 0);
  }

  var h = this.uH;
  h.uC.value.set(X, Y); h.uSc.value.set(S * sx * b.uShape.value.x, S * sy * b.uShape.value.y); h.uRoll.value = roll; h.uRs.value = S;
  h.uHalo.value = (p.halo * (1 + 0.14 * br) + voice * 0.45 + this.swell * 0.4 * w.waiting + this.flash * 0.8 + this.tick * 0.16 * aCmd + this.gulp * 0.4 * aMem + pet * 0.3) * (this.dark ? 1 : 0.62);
  h.uLobe.value.set(Math.cos(this.think) * g.side, cz * 0.72, w.thinking * 0.75);
  var big = smooth(150, 260, this.css), air = Y - this.rest;
  h.uGround.value.set(big * (this.dark ? 0.16 : 0.20) * clamp(1 - (air + 0.1) * 2.2, 0.25, 1.2) * (0.5 + 0.5 * p.bright), 1.0 + (air + 0.05) * 1.5, Math.max(-0.92, this.rest - this.fill * b.uShape.value.y - 0.26));

  var kf = 1 - decay(dt, 0.11);
  this.sec.x += (X - this.sec.x) * kf; this.sec.y += (Y - this.sec.y) * kf;
  var up = this.uP;
  up.uCenterW.value.set(this.sec.x, this.sec.y, 0);
  up.uS.value = S;
  up.uCount.value.set(g.sats, g.motes);
  up.uT.value.set(this.tMote + g.phase, this.tSat + g.phase);
  up.uInward.value = aMem;
  up.uPush.value = voice + this.flash * 1.5;
  var dim = clamp((p.bright - 0.45) / 0.55, 0, 1);
  up.uAl.value.set(this.extras * (R ? 1 : this.detail) * dim * (this.dark ? 0.95 : 0.8), this.extras * (0.35 + 0.65 * dim));

  var ur = this.uR;
  for (i = 0; i < 2; i++) {
    var rg = g.ring[i], on = i < g.rings ? 1 : 0;
    m.rot.makeRotationFromEuler(m.e.set(rg.tx + 0.05 * Math.sin(t * 0.21 + i), 0, rg.tz + roll + 0.06 * Math.sin(t * 0.17 + i * 2), 'ZXY'));
    ur.uRU.value[i].set(1, 0, 0).applyMatrix4(m.rot);
    ur.uRV.value[i].set(0, 0, 1).applyMatrix4(m.rot);
    ur.uRP.value[i].set(rg.r, rg.w * lerp(1.7, 1, this.detail), this.tSat * rg.spd * 2.2 + g.ph[i], on * this.extras * (0.4 + 0.6 * dim) * (this.dark ? 0.85 : 0.75));
  }

  // --- the egg: it sits on the shadow, rocks about its base, and has the stage until the blob is out ---
  var out = this.born > 0, E = this.E, eg = this.eggMesh;
  this.body.visible = out && !this.hidden;
  this.halo.visible = !this.hidden;
  this.ring.visible = this.showRing && out && eo.fade > 0.99 && !this.hidden;
  this.points.visible = this.showPoints && out && eo.fade > 0.99 && !this.hidden;
  eg.visible = this.eggMode !== 'none' && E.fade > 0.01 && E.burst < 1.3 && !this.hidden;
  if (this.worn) this.worn.tick(dt, t);
  if (eg.visible) {
    var ue = this.uE, es = ue.uEggS.value, Se = this.fill * 0.92;
    var qy = 1 + E.squash, qx = 1 / Math.sqrt(qy), hE = Se * es.y * qy;
    var Ye = h.uGround.value.z + 0.05 + hE + Math.max(0, sp.eggY.x), Xe = -Math.sin(E.roll) * hE * 0.9;
    if (R) { var pe = 2 / this.px; Xe = Math.round(Xe / pe) * pe; Ye = Math.round(Ye / pe) * pe; }
    this.eggYc = Ye;
    m.a.makeTranslation(Xe, Ye, 0);
    m.a.multiply(m.b.makeRotationZ(E.roll));
    m.a.multiply(m.b.makeScale(Se * qx, Se * qy, Se * qx));
    eg.matrix.copy(m.a); eg.matrixWorldNeedsUpdate = true;
    ue.uCrk.value.w = E.crack; ue.uBurst.value = E.burst; ue.uFade.value = E.fade;
    ue.uGrade.value.set(1, 1, E.jolt * 0.14, 0);
    if (!out) {
      h.uC.value.set(Xe, Ye); h.uSc.value.set(Se * es.x * qx, hE); h.uRs.value = Se; h.uHalo.value = 0;
      h.uGround.value.x = big * (this.dark ? 0.16 : 0.20); h.uGround.value.y = 0.9 - Math.max(0, sp.eggY.x) * 1.5;
    }
  }
  h.uGround.value.x *= this.shadow;
};

Orb.prototype.render = function () { this.owed = !Stage.draw(this); };
Orb.prototype.dispose = function () {
  if (this.worn) { this.worn.dispose(); this.worn = null; }
  Runner.remove(this);
  this.halo.material.dispose(); this.body.material.dispose(); this.eggMesh.material.dispose(); this.ring.material.dispose(); this.points.material.dispose();
  Stage.sweep(Runner.orbs);
};

/* ================================================================
   Runner: one frame loop for every orb. It needs requestAnimationFrame;
   everything else it uses from the page is optional.
   ================================================================ */
function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
var Runner = {
  orbs: [], raf: 0, last: 0, frame: 0, fps: 0, running: false, rectsAt: 0, wired: false,
  add: function (orb, slow) { orb.half = !!slow; orb.parity = this.orbs.length % 6; this.orbs.push(orb); return orb; },
  remove: function (orb) { var i = this.orbs.indexOf(orb); if (i >= 0) this.orbs.splice(i, 1); },
  // page events, hooked up once and only where a page exists
  wire: function () {
    if (this.wired || typeof document === 'undefined' || typeof window === 'undefined') return;
    this.wired = true;
    var self = this;
    document.addEventListener('visibilitychange', function () { if (document.hidden) self.stop(); else self.start(); });
    window.addEventListener('scroll', function () { self.rectsAt = 0; }, { passive: true });
    window.addEventListener('resize', function () { self.rectsAt = 0; });
  },
  start: function () {
    this.wire();
    if (this.running || (typeof document !== 'undefined' && document.hidden)) return;
    this.running = true; this.last = now();
    var self = this;
    this.raf = requestAnimationFrame(function loop(t) {
      if (!self.running) return;
      self.tick(t);
      self.raf = requestAnimationFrame(loop);
    });
  },
  stop: function () { this.running = false; if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf); },
  // One frame for every orb. Hosts with their own loop can call this directly with a time in milliseconds.
  tick: function (t) {
    var raw = (t - this.last) / 1000; this.last = t;
    var dt = Math.min(Math.max(raw, 0), 0.25);
    if (raw > 0) this.fps = this.fps ? lerp(this.fps, 1 / raw, 0.08) : 1 / raw;
    this.frame++;
    var fresh = t - this.rectsAt > 400, viewH = typeof window !== 'undefined' ? window.innerHeight : 1e9;
    if (fresh) this.rectsAt = t;
    for (var i = 0; i < this.orbs.length; i++) {
      var o = this.orbs[i];
      // one that is held still is not moved, but is given the picture it is owed
      if (o.paused) { if (o.owed) o.render(); o.pending = 0; continue; }
      if (fresh || !o.rect) {
        o.resize();
        if (o.canvas && o.canvas.getBoundingClientRect) {
          o.rect = o.canvas.getBoundingClientRect();
          o.visible = o.rect.bottom > -40 && o.rect.top < viewH + 40 && o.rect.width > 0;
        } else { o.rect = { left: 0, top: 0, width: o.css, height: o.css }; o.visible = true; }
      }
      if (!o.visible) { o.pending = 0; continue; }
      if (t - o.ptr.t < 2600) {
        var cx = o.rect.left + o.rect.width / 2, cy = o.rect.top + o.rect.height / 2;
        var dx = (o.ptr.x - cx) / (o.rect.width * 0.9), dy = (cy - o.ptr.y) / (o.rect.width * 0.9);
        var dist = Math.sqrt(dx * dx + dy * dy), reach = o.rect.width > 150 ? 3.2 : 2.2;
        var nrm = dist > 1 ? 1 / dist : 1;
        o.attend(dx * nrm, dy * nrm, dist < reach ? 1 : 0);
      } else if (o.ptr.t > -1e8) { o.ptr.t = -1e9; o.attend(o.attn.x, o.attn.y, 0); }
      o.pending += dt;
      // the mascot is drawn at console frame rates: 30 a second, 20 for the bystanders
      var every = o.retro ? (o.half ? 3 : 2) : (o.half ? 2 : 1);
      if ((this.frame + o.parity) % every) continue;
      o.update(o.pending); o.pending = 0;
      o.render();
    }
  }
};

function createOrb(canvas, opts) {
  var orb = new Orb(canvas, opts);
  Runner.add(orb, opts && opts.slow);
  Runner.start();
  return orb;
}

return {
  Orb: Orb, Runner: Runner, Stage: Stage, createOrb: createOrb,
  makeGenome: makeGenome, describeGenome: describeGenome,
  PALETTE: PALETTE, STATES: STATES, VARIANTS: VARIANTS, STYLES: ['retro', 'glass']
};
}

// The demo page's build drops this line: there the core is one plain script.
export { AgentOrbCore }
