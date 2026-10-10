/* First-run mock-up. ../agent-pages/src/head.js (icons, pretend people and agents, the creature)
   opens the function this file closes. */

P.down = '<path d="m6 9 6 6 6-6"/>';
P.sideL = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/>';
P.side = '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M15 4.5v15"/>';
P.aside = '<path d="M3.500 5h11.500v8.500H8.500l-3 2.500v-2.500h-2z"/><path d="M18 9h2.500v8.500H19V20l-3-2.500h-4.500v-1"/>';
P.dice = '<rect x="4" y="4" width="16" height="16" rx="3.500"/><path d="M8.500 8.500h.01M15.500 8.500h.01M12 12h.01M8.500 15.500h.01M15.500 15.500h.01" stroke-width="2.400"/>';

var app = document.getElementById("app"), strip = document.getElementById("strip");
var T3 = window.THREE, TAU = Math.PI * 2;
var SCENES = [
  ["sky", "1 · From the sky"], ["you", "2 · Who are you"], ["name", "3 · A name"], ["computer", "4 · This computer"], ["hatch", "5 · Hatching"], ["chat", "6 · The chat"], null,
  ["back", "Signing in again"]
];
var NOTES = {
  sky: ["The app opens on the sky.", "No form first: an egg comes down out of the night onto a little island, and speaks. Click anywhere to skip the fall."],
  you: ["The egg asks who you are.", "This is making an account (or signing in). The server is already chosen; “Change” is there for someone who runs their own. Answering puts the first crack in the shell."],
  name: ["It asks for a name.", "The first agent is named and coloured here, and the egg takes the colour as you pick. A second crack, and the sky begins to lighten."],
  computer: ["It asks to work on this computer.", "The pairing, as one question. Nothing to copy or confirm: this window is signed in, so the app pairs itself. “Not now” leaves the computer unshared."],
  hatch: ["It hatches.", "The last crack, then it is out, at sunrise. Each answer was a step of the hatch: the egg is the progress bar."],
  chat: ["And you are in its chat.", "Not on a settings page. The creature goes to its place in the panel, and says hello first. The computer it was given is in its panel."],
  back: ["Someone who already has an account.", "They sign in and are not asked for a name: their own agent comes out of the egg, asks about this computer, and takes them to the chat they left."]
};
var NAMES = ["Pip", "Mochi", "Juniper", "Biscuit", "Tarn", "Wren", "Sorrel", "Nori", "Pebble"];
var SWATCH = ["#3f7f9c", "#5f8a4e", "#c9952c", "#b8674a", "#c0607a", "#7d5a9a", "#5b6672", "#2f3a52"];
var view = { scene: "sky", step: null, signin: false, back: false, share: "yes", login: true, serverOpen: false, dice: 0 };
var me = PEOPLE.me, who = "egg";
AGENTS.egg = { name: "", seed: "Sorrel", color: SWATCH[0] };
function A() { return AGENTS[who]; }
function pick(list, r) { return list[Math.floor((r || Math.random)() * list.length)]; }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function lerp(a, b, k) { return a + (b - a) * k; }
function smooth(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
function mul(seed) { return function () { seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* Whatever was asked for later is dropped when another scene is shown. */
var gen = 0;
function later(fn, ms) { var g = gen; return setTimeout(function () { if (g === gen) fn(); }, ms); }

/* ---------- the sky, the clouds and the island ---------- */
/* Drawn small and shown large, three CSS pixels to one of its own, as the creature is. Lit at
   each corner and not across a face, each corner on a whole pixel, and what is see-through is a
   pattern of holes: the look of the consoles the creature comes from. */
var K = 3, FALL = 7.6, HIGH = 46, FAR = 10.5, TALL = 6.42;
var gl = null, world, cam, skyU, beamU, glowU, isle, beam, glow, puff, clouds = [], stones = [], amb, sun, snap = { value: null };
var W = { t: 0, mode: "rest", fallT: 0, alt: 0, sway: 0, tilt: 0, eggY: 0.1, phase: 0, phaseTo: 0, beam: 0, glow: 0, flash: 0, dip: 0, dipV: 0, acc: 0, fly: 0, hatching: false, burst: false };
var PH = [
  { zen: "#05071a", mid: "#0e1a3c", hor: "#1b5560", amb: "#44548c", sun: "#8fb4ff", si: 0.55, stars: 1, day: 0, fog: "#123040", puff: "#8890b4" },
  { zen: "#080c26", mid: "#182a52", hor: "#2c7a80", amb: "#52629a", sun: "#a8c4ff", si: 0.6, stars: 0.85, day: 0.12, fog: "#1c4a58", puff: "#98a0c2" },
  { zen: "#141a40", mid: "#3a4a7c", hor: "#d98a6a", amb: "#76709a", sun: "#ffc8a0", si: 0.75, stars: 0.4, day: 0.5, fog: "#8a6a70", puff: "#e6ccd0" },
  { zen: "#2c66a6", mid: "#6cbccb", hor: "#ffe0b0", amb: "#828aa8", sun: "#fff0d0", si: 0.62, stars: 0, day: 1, fog: "#cfe0d8", puff: "#ffffff" }
];
var BAYER = "float b2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }\nfloat bayer(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }\n";

/* A shape made a triangle at a time, each with a colour of its own. */
function Bag() { this.p = []; this.c = []; }
Bag.prototype.tri = function (a, b, c, col) {
  this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (var i = 0; i < 3; i++) this.c.push(col.r, col.g, col.b);
};
Bag.prototype.add = function (geo, m, colorOf) {
  if (geo.index) geo = geo.toNonIndexed();
  geo.applyMatrix4(m);
  var a = geo.attributes.position.array;
  for (var i = 0; i < a.length; i += 9) this.tri([a[i], a[i + 1], a[i + 2]], [a[i + 3], a[i + 4], a[i + 5]], [a[i + 6], a[i + 7], a[i + 8]], colorOf());
};
Bag.prototype.geo = function () {
  var g = new T3.BufferGeometry();
  g.setAttribute("position", new T3.Float32BufferAttribute(this.p, 3));
  g.setAttribute("color", new T3.Float32BufferAttribute(this.c, 3));
  g.computeVertexNormals();
  return g;
};
function at(x, y, z, sx, sy, sz, ry) {
  return new T3.Matrix4().compose(new T3.Vector3(x, y, z), new T3.Quaternion().setFromEuler(new T3.Euler(0, ry || 0, 0)), new T3.Vector3(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));
}
function shades(list, r) { var cols = list.map(function (h) { return new T3.Color(h); }); return function () { return pick(cols, r); }; }
/* Every corner drawn on a whole pixel, so that what moves shivers a little as it goes. */
function ps1(mat) {
  mat.onBeforeCompile = function (s) {
    s.uniforms.uSnap = snap;
    s.vertexShader = "uniform vec2 uSnap;\n" + s.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;");
  };
  return mat;
}

function islandGeo() {
  var r = mul(7), bag = new Bag(), N = 9;
  // rings from the middle of the grass out to its edge, and down the rock to its point
  var rings = [[0, 0.1, 0, 0], [0.85, 0.08, 0.1, 0.03], [1.6, 0.02, 0.12, 0.04], [2.0, -0.1, 0.1, 0.03], [1.92, -0.4, 0.1, 0.05], [1.5, -0.95, 0.2, 0.1], [1.0, -1.6, 0.25, 0.15], [0.45, -2.2, 0.3, 0.2], [0, -2.8, 0, 0]];
  var pts = rings.map(function (g, i) {
    var row = [];
    for (var k = 0; k < N; k++) {
      var a = (k + (i % 2) * 0.5) / N * TAU, rr = g[0] * (1 + (r() - 0.5) * g[2]);
      row.push([Math.cos(a) * rr, g[1] + (r() - 0.5) * g[3], Math.sin(a) * rr]);
    }
    return row;
  });
  var grass = shades(["#58a85f", "#4c9a58", "#66b568"], r), lip = shades(["#2f7350", "#2a6848"], r), rock = shades(["#7b6a5c", "#6b5b50", "#8a7868", "#5d4f48"], r);
  for (var i = 0; i < rings.length - 1; i++) for (var k = 0; k < N; k++) {
    var k2 = (k + 1) % N, a = pts[i][k], b = pts[i][k2], c = pts[i + 1][k], d = pts[i + 1][k2];
    var col = i < 3 ? grass : i === 3 ? lip : rock;
    if (i % 2) { bag.tri(a, b, d, col()); bag.tri(a, d, c, col()); }
    else { bag.tri(a, b, c, col()); bag.tri(b, d, c, col()); }
  }
  // two little trees at the back, some stones, tufts of grass and a few flowers
  var leaf = shades(["#2f8060", "#2a7358", "#37906a"], r), bark = shades(["#6b4a3a", "#5f4234"], r), tuft = shades(["#3f8a52", "#74c070"], r), petal = shades(["#ffffff", "#f6b7c8", "#ffe08a"], r);
  function tree(x, z, s) {
    bag.add(new T3.CylinderGeometry(0.07, 0.09, 0.4, 5), at(x, 0.2 * s, z, s), bark);
    bag.add(new T3.ConeGeometry(0.44, 0.75, 6), at(x, 0.7 * s, z, s, s, s, r() * 3), leaf);
    bag.add(new T3.ConeGeometry(0.31, 0.62, 6), at(x, 1.12 * s, z, s, s, s, r() * 3), leaf);
  }
  tree(-1.25, -0.75, 1.05); tree(1.42, -0.5, 0.74); tree(-0.55, -1.35, 0.6);
  [[1.3, 0.62, 0.2], [-1.52, 0.4, 0.15], [0.95, -1.2, 0.17], [-0.9, 1.25, 0.11]].forEach(function (s) {
    bag.add(new T3.IcosahedronGeometry(s[2], 0), at(s[0], 0.06, s[1], 1.2, 0.75, 1, r() * 3), rock);
  });
  for (var t = 0; t < 22; t++) {
    var ang = r() * TAU, rad = 0.95 + r() * 0.85, x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    if (t % 4 === 3) bag.add(new T3.OctahedronGeometry(0.055, 0), at(x, 0.17, z, 1), petal);
    else bag.add(new T3.ConeGeometry(0.06, 0.2 + r() * 0.12, 3), at(x, 0.14, z, 1, 1, 1, r() * 3), tuft);
  }
  return bag.geo();
}
function stoneGeo(n) {
  var r = mul(40 + n), bag = new Bag();
  bag.add(new T3.IcosahedronGeometry(0.34, 0), at(0, 0, 0, 1.2, 0.8, 1, r() * 3), shades(["#7b6a5c", "#6b5b50", "#8a7868"], r));
  bag.add(new T3.ConeGeometry(0.3, 0.14, 6), at(0, 0.22, 0, 1.1, 1, 0.9), shades(["#58a85f", "#4c9a58"], r));
  return bag.geo();
}
function cloudGeo(r) {
  var bag = new Bag(), n = 3 + Math.floor(r() * 3), white = function () { return new T3.Color("#ffffff"); };
  for (var i = 0; i < n; i++) {
    var s = 0.75 + r() * 0.75, mid = 1 - Math.abs(i - (n - 1) / 2) / n;
    bag.add(new T3.IcosahedronGeometry(1, 1), at((i - (n - 1) / 2) * 1.05 + (r() - 0.5) * 0.4, (r() - 0.3) * 0.3, (r() - 0.5) * 0.6, s * 1.25, s * (0.6 + mid * 0.45), s, r() * 3), white);
  }
  // a flat underside, as a cloud has
  for (var k = 1; k < bag.p.length; k += 3) if (bag.p[k] < -0.28) bag.p[k] = -0.28;
  return bag.geo();
}

/* Sparks: what the egg trails as it falls, the dust it lands in, its chips of shell, and the rest. */
var NP = 260, pp, pc, pv, pl, pg, pn = 0, sparks;
function spark(x, y, z, vx, vy, vz, life, grav, hex) {
  var i = pn++ % NP, c = new T3.Color(hex);
  pp[i * 3] = x; pp[i * 3 + 1] = y; pp[i * 3 + 2] = z;
  pv[i * 3] = vx; pv[i * 3 + 1] = vy; pv[i * 3 + 2] = vz;
  pc[i * 3] = c.r; pc[i * 3 + 1] = c.g; pc[i * 3 + 2] = c.b;
  pl[i] = life; pg[i] = grav;
}
function clearSparks() { for (var i = 0; i < NP; i++) { pl[i] = 0; pp[i * 3 + 1] = -999; } }
function dust() {
  for (var i = 0; i < 26; i++) { var a = Math.random() * TAU, v = 1 + Math.random() * 1.6; spark(Math.cos(a) * 0.6, isle.position.y + 0.15, Math.sin(a) * 0.5, Math.cos(a) * v, 0.5 + Math.random() * 1.3, Math.sin(a) * v, 0.45 + Math.random() * 0.45, 3.5, pick(["#e8f4e0", "#bcd8b0", "#ffffff"])); }
}
function chips() {
  for (var i = 0; i < 12; i++) spark((Math.random() - 0.5) * 0.7, W.eggY + 0.6 + Math.random() * 0.6, 0.4, (Math.random() - 0.5) * 3.4, 1.2 + Math.random() * 2.2, Math.random(), 0.6 + Math.random() * 0.4, 8, pick(["#f4efe6", "#ffffff", A().color]));
}
function confetti() {
  var cols = SWATCH.concat(["#ffffff", "#ffe08a", "#7fd6cf"]);
  for (var i = 0; i < 110; i++) spark((Math.random() - 0.5) * 0.5, W.eggY + 0.8, 0.3, (Math.random() - 0.5) * 7, 3 + Math.random() * 5, (Math.random() - 0.5) * 3, 1.3 + Math.random() * 1.3, 7, pick(cols));
}

function makeWorld() {
  var cv = document.createElement("canvas");
  cv.className = "ob-sky";
  try { gl = new T3.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: "low-power" }); } catch (e) { gl = null; return; }
  gl.setPixelRatio(1);
  snap.value = new T3.Vector2(160, 100);
  world = new T3.Scene();
  world.fog = new T3.Fog(0x14323f, 15, 62);
  cam = new T3.PerspectiveCamera(34, 1, 0.1, 300);
  amb = new T3.AmbientLight(0xffffff, 1); sun = new T3.DirectionalLight(0xffffff, 0.6);
  world.add(amb, sun);

  // the sky: one colour into the next with height, stars where it is dark, and a low sun at the end
  skyU = { uFog: { value: world.fog.color }, uZen: { value: new T3.Color() }, uMid: { value: new T3.Color() }, uHor: { value: new T3.Color() }, uCamY: { value: 0 }, uStars: { value: 1 }, uDay: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uFlash: { value: 0 } };
  var sky = new T3.Mesh(new T3.PlaneGeometry(2, 2), new T3.ShaderMaterial({
    uniforms: skyU, depthTest: false, depthWrite: false, fog: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "precision highp float; varying vec2 vUv; uniform vec3 uFog, uZen, uMid, uHor; uniform float uCamY, uStars, uDay, uTime, uAspect, uFlash;\n" + BAYER +
      "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n" +
      "void main(){\n" +
      "  float alt = vUv.y + uCamY * 0.035;\n" +
      "  vec3 col = mix(uFog, uHor, smoothstep(0.5, 0.7, alt));\n" +
      "  col = mix(col, uMid, smoothstep(0.68, 1.02, alt));\n" +
      "  col = mix(col, uZen, smoothstep(0.95, 1.9, alt));\n" +
      "  vec2 sp = vec2((vUv.x - 0.5) * uAspect - 0.4, (alt - mix(0.58, 0.78, uDay)) * 1.25);\n" +
      "  col += vec3(1.0, 0.86, 0.62) * exp(-dot(sp, sp) * 7.0) * uDay * 0.75;\n" +
      "  col = mix(col, vec3(1.0, 0.97, 0.86), step(dot(sp, sp), 0.0042) * smoothstep(0.55, 1.0, uDay));\n" +
      "  vec2 g = floor(gl_FragCoord.xy + vec2(0.0, floor(uCamY * 5.0)));\n" +
      "  float h = hash(g);\n" +
      "  float tw = 0.55 + 0.45 * sin(uTime * (1.0 + fract(h * 91.0) * 3.0) + h * 600.0);\n" +
      "  col += step(0.9962, h) * tw * uStars * smoothstep(0.72, 1.05, alt) * vec3(0.85, 0.95, 1.0);\n" +
      "  col += uFlash;\n" +
      "  col = floor(col * 30.0 + bayer(gl_FragCoord.xy)) / 30.0;\n" +
      "  gl_FragColor = vec4(col, 1.0);\n}"
  }));
  sky.frustumCulled = false; sky.renderOrder = -10;
  world.add(sky);

  var land = ps1(new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide }));
  isle = new T3.Mesh(islandGeo(), land);
  world.add(isle);
  [[-3.0, -0.7, 0.5], [3.2, -0.15, -0.9], [2.5, -1.7, 0.9], [-2.4, -2.0, -0.6]].forEach(function (p, i) {
    var m = new T3.Mesh(stoneGeo(i), land);
    m.userData = { x: p[0], y: p[1], z: p[2], ph: i * 1.7 };
    m.scale.setScalar(i === 3 ? 0.6 : 1 - i * 0.15);
    stones.push(m); world.add(m);
  });

  // clouds: some in the sky it falls through, some about the island, and a floor of them far below
  var r = mul(11);
  puff = ps1(new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide }));
  var shapes = [cloudGeo(r), cloudGeo(r), cloudGeo(r), cloudGeo(r), cloudGeo(r)];
  function cloud(x, y, z, s, flat) {
    var m = new T3.Mesh(pick(shapes, r), puff);
    m.position.set(x, y, z); m.scale.set(s * (flat ? 1.7 : 1), s * (flat ? 0.5 : 1), s);
    m.userData = { v: (0.08 + r() * 0.16) * (r() < 0.5 ? -1 : 1), span: flat ? 44 : 26 };
    clouds.push(m); world.add(m);
  }
  for (var i = 0; i < 20; i++) cloud((r() < 0.5 ? -1 : 1) * (3 + r() * 15), 6 + i * 2.1 + r() * 1.5, -5 - r() * 24, 0.6 + r() * 1.1);
  cloud(-6.6, 1.9, -5, 1.1); cloud(7.6, 3.0, -9, 1.5); cloud(-11, 4.4, -15, 2.0); cloud(5.6, -1.9, -4.5, 0.9); cloud(-4.8, -2.6, -7, 1.2);
  for (i = 0; i < 20; i++) cloud((r() - 0.5) * 84, -6 - r() * 3, -10 - r() * 42, 2.6 + r() * 3, true);
  for (i = 0; i < 9; i++) cloud(-26 + i * 6.5 + r() * 3, -6.6 - r() * 1.2, -4.5 - r() * 5, 2.4 + r(), true);

  // the light it comes down in, and the glow about it
  beamU = { uA: { value: 0 }, uCol: { value: new T3.Color("#8fd8d2") } };
  beam = new T3.Mesh(new T3.CylinderGeometry(1.5, 0.8, 44, 12, 1, true), new T3.ShaderMaterial({
    uniforms: beamU, fog: false,
    vertexShader: "varying vec3 vN; varying float vH; void main(){ vN = normalize(normalMatrix * normal); vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "precision highp float; varying vec3 vN; varying float vH; uniform float uA; uniform vec3 uCol;\n" + BAYER +
      "void main(){ float a = uA * (0.42 - 0.3 * vH) * pow(abs(vN.z), 1.6); if (a < bayer(gl_FragCoord.xy) + 0.03) discard; gl_FragColor = vec4(uCol, 1.0); }"
  }));
  glowU = { uA: { value: 0 }, uCol: { value: new T3.Color("#b4ece4") } };
  glow = new T3.Mesh(new T3.CircleGeometry(1.6, 16), new T3.ShaderMaterial({
    uniforms: glowU, fog: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "precision highp float; varying vec2 vUv; uniform float uA; uniform vec3 uCol;\n" + BAYER +
      "void main(){ float r = length(vUv - 0.5) * 2.0; float a = uA * (1.0 - r) * (1.0 - r) * 1.3; if (a < bayer(gl_FragCoord.xy) + 0.03) discard; gl_FragColor = vec4(uCol, 1.0); }"
  }));
  world.add(beam, glow);

  pp = new Float32Array(NP * 3); pc = new Float32Array(NP * 3); pv = new Float32Array(NP * 3); pl = new Float32Array(NP); pg = new Float32Array(NP);
  var geo = new T3.BufferGeometry();
  geo.setAttribute("position", new T3.BufferAttribute(pp, 3));
  geo.setAttribute("color", new T3.BufferAttribute(pc, 3));
  sparks = new T3.Points(geo, new T3.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false }));
  sparks.frustumCulled = false;
  world.add(sparks);
  clearSparks();
}

var c1 = null, c2 = null;
function mix(u, a, b, k) { if (!c1) { c1 = new T3.Color(); c2 = new T3.Color(); } u.copy(c1.set(a)).lerp(c2.set(b), k); }
function palette(p) {
  var i = Math.min(PH.length - 2, Math.floor(p)), k = clamp(p - i, 0, 1), a = PH[i], b = PH[i + 1];
  mix(skyU.uZen.value, a.zen, b.zen, k); mix(skyU.uMid.value, a.mid, b.mid, k); mix(skyU.uHor.value, a.hor, b.hor, k);
  mix(amb.color, a.amb, b.amb, k); mix(puff.color, a.puff, b.puff, k); mix(sun.color, a.sun, b.sun, k); mix(world.fog.color, a.fog, b.fog, k);
  sun.intensity = lerp(a.si, b.si, k);
  sun.position.set(lerp(-3, 4, p / 3), lerp(6, 3.5, p / 3), 5.5);
  skyU.uStars.value = lerp(a.stars, b.stars, k); skyU.uDay.value = lerp(a.day, b.day, k);
}

/* One step of the world. */
function stepWorld(dt) {
  W.t += dt;
  W.phase += (W.phaseTo - W.phase) * (1 - Math.exp(-dt * 0.9));
  palette(W.phase);
  var u = 1;
  if (W.mode === "fall") {
    W.fallT += dt;
    u = Math.min(1, W.fallT / FALL);
    W.alt = HIGH * Math.pow(1 - u, 1.8);
    W.sway = Math.sin(W.t * 1.3) * 0.32 * (1 - u);
    W.tilt = Math.sin(W.t * 2.1) * 6 * (1 - u * u);
    // it leaves a trail above it as it comes
    W.acc += dt * 30;
    while (W.acc > 1) {
      W.acc--;
      var a = Math.random() * TAU, r0 = 0.25 + Math.random() * 0.5;
      spark(W.sway + Math.cos(a) * r0, W.eggY + 0.5 + Math.random() * 1.4, Math.sin(a) * r0 * 0.5 - 0.2, Math.cos(a) * 0.5, 1 + Math.random() * 1.6, 0, 0.6 + Math.random() * 0.7, 0, pick(["#ffffff", "#bfeee8", "#7fd6cf", "#ffe9b0"]));
    }
    if (u >= 1) land();
  } else if (W.mode === "rest") {
    // specks of light about the island, fewer as the day comes
    W.fly += dt * (1.6 - W.phase * 0.4);
    if (W.fly > 1) {
      W.fly = 0;
      var b = Math.random() * TAU, rr = 2.2 + Math.random() * 2.2;
      spark(Math.cos(b) * rr, -1 + Math.random() * 3, Math.sin(b) * rr * 0.6 - 0.5, (Math.random() - 0.5) * 0.2, 0.12 + Math.random() * 0.2, 0, 2.5 + Math.random() * 2, 0, pick(["#bfeee8", "#ffe9b0", "#7fd6cf"]));
    }
  }
  // the island floats, and dips under what lands on it
  W.dipV += (-70 * W.dip - 7 * W.dipV) * dt; W.dip += W.dipV * dt;
  isle.position.y = Math.sin(W.t * 0.9) * 0.05 + W.dip;
  stones.forEach(function (m) { var d = m.userData; m.position.set(d.x, d.y + Math.sin(W.t * 0.7 + d.ph) * 0.12 + W.dip * 0.3, d.z); m.rotation.y = W.t * 0.15 + d.ph; });
  clouds.forEach(function (m) { var d = m.userData; m.position.x += d.v * dt; if (m.position.x > d.span) m.position.x = -d.span; else if (m.position.x < -d.span) m.position.x = d.span; });
  W.eggY = isle.position.y + 0.1 + W.alt;

  // nearer or further, higher or lower, so that the egg and the top of the island clear the card
  var far = 0.25 / L.fe, cy = W.alt + lerp(-4.9, 0.1 - (0.5 - L.ay) * TALL * far, smooth(0.02, 0.5, u));
  cam.position.set(0, cy + 2.4 * far, FAR * far); cam.lookAt(0, cy, 0);
  skyU.uCamY.value = cy; skyU.uTime.value = W.t;
  W.beam += ((W.mode === "fall" ? 1 : 0) - W.beam) * (1 - Math.exp(-dt * 2.2));
  W.glow += ((W.mode === "fall" ? 0.75 : 0) - W.glow) * (1 - Math.exp(-dt * 2.6));
  W.flash *= Math.exp(-dt * 3.2);
  beamU.uA.value = W.beam; glowU.uA.value = W.glow; skyU.uFlash.value = W.flash;
  beam.visible = W.beam > 0.03; glow.visible = W.glow > 0.03;
  beam.position.set(W.sway, W.eggY + 22, 0);
  glow.position.set(W.sway, W.eggY + 0.8, -0.4); glow.quaternion.copy(cam.quaternion);

  for (var i = 0; i < NP; i++) {
    if (pl[i] <= 0) continue;
    pl[i] -= dt;
    if (pl[i] <= 0) { pp[i * 3 + 1] = -999; continue; }
    pv[i * 3 + 1] -= pg[i] * dt;
    pp[i * 3] += pv[i * 3] * dt; pp[i * 3 + 1] += pv[i * 3 + 1] * dt; pp[i * 3 + 2] += pv[i * 3 + 2] * dt;
  }
  sparks.geometry.attributes.position.needsUpdate = true; sparks.geometry.attributes.color.needsUpdate = true;
}

/* ---------- the egg ---------- */
/* The creature's own renderer, in a canvas of its own laid over the island. Two things the mock-up
   reaches into it for, which it would need calls for when built: an egg that keeps its cracks
   while it waits, and one with no shadow under it while it is in the air. */
var stage = null, eggEl = null, cardEl = null, titleEl = null, skipEl = null, shellEl = null;
var pet = null, held = 0, shadow = 1, S = 300, hatched = false, stageW = 1, stageH = 1, flying = false;
var v3 = T3 ? new T3.Vector3() : null;
/* How much of the height the egg takes and how far down the island's top is, now and where they are heading. */
var L = { fe: 0.25, ay: 0.375, feTo: 0.25, ayTo: 0.375, feS: 0.25 };
function layout(dt) {
  if (cardEl.classList.contains("on")) {
    var ay = Math.min(0.375 * stageH, stageH - 26 - cardEl.offsetHeight - 30);
    L.ayTo = ay / stageH; L.feTo = clamp((ay - 14) / stageH, 0.08, 0.25);
  }
  var k = 1 - Math.exp(-dt * 6);
  L.fe += (L.feTo - L.fe) * k; L.ay += (L.ayTo - L.ay) * k;
  if (Math.abs(L.feTo - L.feS) > 0.004) sizeEgg();
}
function sizeEgg() {
  L.feS = L.feTo; S = eggSize();
  eggEl.style.width = eggEl.style.height = S + "px";
  pet.resize(S);
}
function makeEgg() {
  var a = A();
  pet = core.createOrb(eggEl.firstChild, { seed: a.seed, color: a.color, size: S, dark: true, notice: false });
  pet.setState("egg");
  var egg = pet._egg, update = pet.update;
  pet._egg = function (dt, hop) { egg.call(this, dt, hop); if (this.eggMode === "egg") this.E.crack = held; };
  pet.update = function (dt) { update.call(this, dt); this.uH.uGround.value.x *= shadow; };
}
function eggSize() {
  var part = (pet.fill || 0.62) * 0.92 * pet.uE.uEggS.value.y;
  return clamp(Math.round(L.feS * stageH / part / K) * K, 60, 600);
}
function nudge(amp) {
  if (!pet || pet.getState() !== "egg") return;
  pet.E.rockT = 0; pet.E.rockA = amp * (Math.random() < 0.5 ? -1 : 1);
}
function crack(n) {
  held = n === 1 ? 0.34 : 0.67;
  pet.E.jolt = 1; pet.sp.eggY.v += 0.7; nudge(0.2);
  W.glow = 0.9; W.dipV -= 0.5;
  chips();
}
function land() {
  W.mode = "rest"; W.alt = 0; W.sway = 0; W.tilt = 0;
  W.dipV = -1.7;
  pet.sp.eggY.v += 1.1; nudge(0.2);
  dust();
  if (skipEl) skipEl.hidden = true;
  titleEl.classList.remove("on");
  later(function () { begin("hello"); }, 1100);
}
/* The hatch, from as far along as its cracks are. */
function hatch(then) {
  var from = held >= 0.6 ? 1.6 : held >= 0.3 ? 1.2 : 0.5, kept = held;
  L.feTo = 0.25; L.ayTo = 0.375;
  pet.hatch({ onDone: function () { hatched = true; W.hatching = false; pet.notice = true; then(); } });
  pet.hatchT = from; pet.E.crack = kept;
  W.hatching = true; W.burst = false;
}
function place() {
  v3.set(W.sway, W.eggY, 0).project(cam);
  var ax = (v3.x * 0.5 + 0.5) * stageW, ay = (-v3.y * 0.5 + 0.5) * stageH, gz = pet.uH.uGround.value.z;
  eggEl.style.transformOrigin = "50% " + ((1 - gz) * 50).toFixed(2) + "%";
  eggEl.style.transform = "translate(" + Math.round(ax - S / 2) + "px," + Math.round(ay - S / 2 * (1 - gz)) + "px) rotate(" + W.tilt.toFixed(2) + "deg) scale(" + (L.fe / L.feS).toFixed(4) + ")";
}
function fit() {
  if (!gl) return;
  stageW = app.clientWidth; stageH = app.clientHeight;
  var rw = Math.max(2, Math.round(stageW / K)), rh = Math.max(2, Math.round(stageH / K));
  gl.setSize(rw, rh, false);
  cam.aspect = stageW / stageH; cam.updateProjectionMatrix();
  snap.value.set(rw / 2, rh / 2); skyU.uAspect.value = stageW / stageH;
  if (pet && stage && !flying) sizeEgg();
}
var last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  var dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  if (!stage || !gl) return;
  if (!flying) layout(dt);
  stepWorld(dt);
  shadow = 1 - smooth(0, 2.5, W.alt);
  if (W.hatching && !W.burst && pet.hatchT >= 2.9) { W.burst = true; W.flash = 0.55; W.phaseTo = 3; W.dipV -= 0.9; confetti(); }
  gl.render(world, cam);
  if (!flying) place();
}

/* ---------- what the egg says, and what it asks for ---------- */
function line(step) {
  var a = A().name, f = me.first;
  if (step === "hello") return "Oof. That was a long way down. Hello? Is somebody out there?";
  if (step === "you") return view.signin ? "Have we met before? Tell me who you are and I’ll know." : "Oh good, a voice! It’s dark inside this egg, so tell me: who are you?";
  if (step === "name") return "Nice to meet you, " + f + ". I don’t have a name yet. What will you call me?";
  if (step === "computer") return view.back ? f + ", it’s you! I haven’t worked on this computer before. May I?" : a + ". I like that. One more thing before I come out: may I work on this computer?";
  if (view.back) return view.share === "no" ? "No problem, I’ll stay off this computer. Let’s pick up where we left off." : "All set. Let’s pick up where we left off.";
  return "There you are, " + f + "! " + (view.share === "yes" ? "This computer is ours to work on now." : view.share === "read" ? "I’ll only read files here until you say otherwise." : "I’ll stay off this computer until you say otherwise.") + " Shall we?";
}
function body(step) {
  if (step === "hello") return '<div class="acts"><span class="grow"></span><button class="btn pri" data-do="next">Hello!</button></div>';
  if (step === "you") {
    var server = view.serverOpen ? '<label class="f wide">Server<input class="field" value="https://do.computer" spellcheck="false"><small>The address of the Do Computer you use.</small></label>' : "";
    var fields = view.signin
      ? '<label class="f">Email<input class="field" value="sawyer@tidewater.studio" spellcheck="false"></label><label class="f">Password<input class="field" type="password" value="correct horse"></label>'
      : '<label class="f">Your name<input class="field" id="f-name" value="Sawyer Hood" spellcheck="false"></label><label class="f">Email<input class="field" value="sawyer@tidewater.studio" spellcheck="false"></label><label class="f wide">Password<input class="field" type="password" value="correct horse"></label>';
    return '<div class="grid2">' + fields + server + "</div>" +
      '<div class="acts">' + (view.serverOpen ? "" : '<span class="srv">On <b>do.computer</b> · <button class="lnk" data-do="server">Change</button></span>') + '<span class="grow"></span>' +
      '<button class="btn quiet" data-do="signin">' + (view.signin ? "I’m new here" : "I already have an account") + '</button><button class="btn pri" data-do="next">' + (view.signin ? "Sign in" : "That’s me") + "</button></div>";
  }
  if (step === "name") {
    return '<div class="namerow"><input class="field" id="f-agent" placeholder="A name for it" maxlength="24" spellcheck="false" autocomplete="off"><button class="btn" data-do="dice" title="Suggest a name">' + ic("dice", 19) + "</button></div>" +
      '<div class="sws">' + SWATCH.map(function (c) { return '<button class="sw' + (c === A().color ? " on" : "") + '" data-do="color:' + c + '" style="--c:' + c + '" title="Its colour"></button>'; }).join("") + "</div>" +
      '<div class="acts"><span class="hint">Both can be changed later.</span><span class="grow"></span><button class="btn pri" data-do="next" disabled>That’s your name</button></div>';
  }
  if (step === "computer") {
    return '<p class="fine">' + esc(A().name) + " would run commands and read and change files here, as you. It can reach this computer while Do Computer is running; closing the window leaves it in the tray.</p>" +
      '<label class="chk"><input type="checkbox" id="f-login"' + (view.login ? " checked" : "") + "><span>Open Do Computer when I sign in to this computer</span></label>" +
      '<div class="acts"><button class="btn quiet" data-do="share:no">Not now</button><span class="grow"></span><button class="btn" data-do="share:read">Only read files</button><button class="btn pri" data-do="share:yes">Yes, work here</button></div>';
  }
  return '<div class="acts"><span class="grow"></span><button class="btn pri" data-do="next">' + (view.back ? "Back to our chat" : "Start chatting with " + esc(A().name)) + "</button></div>";
}
function tag() { var a = A(); return '<i style="--c:' + a.color + '"></i>' + esc(hatched ? a.name : a.name ? a.name + ", in the egg" : "The egg"); }

var saying = null;
function type(el, text, end) {
  var i = 0, timer = 0, g = gen;
  function tick() {
    if (g !== gen) return;
    i = Math.min(text.length, i + 1);
    el.textContent = text.slice(0, i);
    if (hatched) pet.feed("token"); else if (i % 9 === 1) nudge(0.05);
    if (i < text.length) { timer = setTimeout(tick, /[.,!?:]/.test(text[i - 1]) ? 190 : 24); return; }
    saying = null; el.classList.add("said");
    if (hatched) pet.setState("idle");
    end();
  }
  saying = { finish: function () { clearTimeout(timer); i = text.length - 1; tick(); } };
  if (hatched) pet.setState("speaking");
  tick();
}
function begin(step) {
  view.step = step;
  var was = cardEl.classList.contains("on");
  cardEl.classList.remove("on");
  later(function () {
    cardEl.innerHTML = '<div class="tag">' + tag() + '</div><p class="line"></p><div class="body"><div>' + body(step) + "</div></div>";
    cardEl.classList.add("on");
    type(cardEl.querySelector(".line"), line(step), function () {
      cardEl.querySelector(".body").classList.add("in");
      var first = cardEl.querySelector("#f-agent") || cardEl.querySelector(".btn.pri");
      if (first) first.focus({ preventScroll: true });
    });
  }, was ? 240 : 0);
}
/* The same step again with another body: its words are not said twice. */
function again() {
  cardEl.querySelector(".tag").innerHTML = tag();
  cardEl.querySelector(".line").textContent = line(view.step);
  cardEl.querySelector(".body > div").innerHTML = body(view.step);
}
function mark(scene) { view.scene = scene; drawStrip(); }
function setName(name) {
  var f = cardEl.querySelector("#f-agent");
  f.value = name; f.focus();
  cardEl.querySelector(".btn.pri").disabled = false;
}
/* The step in the card was answered. */
function done() {
  var s = view.step;
  if (saying) return saying.finish();
  if (s === "hello") { mark("you"); return begin("you"); }
  if (s === "you") {
    if (view.signin) {
      // someone the server knows: their own agent is in the egg, and comes straight out
      view.back = true; who = "pip";
      me.full = "Sawyer Hood"; me.first = "Sawyer"; me.ini = "SH";
      pet.setSeed(A().seed); pet.setColor(A().color);
      cardEl.classList.remove("on");
      return later(function () { hatch(function () { begin("computer"); }); }, 300);
    }
    var full = cardEl.querySelector("#f-name").value.trim() || "Sawyer Hood";
    me.full = full; me.first = full.split(/\s+/)[0];
    me.ini = full.split(/\s+/).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("");
    crack(1); W.phaseTo = 1; mark("name");
    cardEl.classList.remove("on");
    return later(function () { begin("name"); }, 650);
  }
  if (s === "name") {
    var name = cardEl.querySelector("#f-agent").value.trim();
    if (!name) return;
    A().name = name;
    crack(2); W.phaseTo = 2; mark("computer");
    cardEl.classList.remove("on");
    return later(function () { begin("computer"); }, 650);
  }
  if (s === "out") return toChat();
}
function share(how) {
  view.share = how;
  view.login = cardEl.querySelector("#f-login").checked;
  if (how === "no") return paired();
  var pc = esc(me.first) + "’s MacBook", row = cardEl.querySelector(".body > div");
  row.innerHTML = '<div class="pairing"><span class="spin mut">' + ic("ring", 16) + "</span><span>Pairing " + pc + " with " + esc(A().name) + "…</span><span class=\"grow\"></span><code>KQ7M-2XWD</code></div>";
  later(function () {
    row.innerHTML = '<div class="pairing"><span class="ok">' + ic("okc", 18) + "</span><span>" + pc + " is paired" + (how === "read" ? ", read-only" : "") + ".</span></div>";
    later(paired, 750);
  }, 1500);
}
function paired() {
  if (view.back) return begin("out");
  mark("hatch");
  cardEl.classList.remove("on");
  later(function () { hatch(function () { begin("out"); }); }, 250);
}

/* ---------- the app it ends in ---------- */
function side() {
  var keys = view.back ? ["pip", "ledger", "scout"] : [who];
  var lines = { ledger: ["Priya: can you total October?", "52m"], scout: ["Three launches worth a look this week", "Tue"] };
  var row = function (key) {
    var a = AGENTS[key], cur = key === who, l = cur ? [view.back ? "The status page is yours in the checklist." : "Hi " + me.first + ", I’m " + a.name + ".", "now"] : lines[key];
    return '<div class="arow' + (cur ? " sel cur" : "") + '" data-do="toast:' + (cur ? "This is " + esc(a.name) + "’s main chat" : "Only the first chat is in this mock-up") + '">' + orb(key, 40) + '<span class="grow"><div class="t"><span class="grow trunc">' + esc(a.name) + '</span><span class="end">' + l[1] + '</span></div><div class="s"><span class="trunc">' + esc(l[0]) + "</span></div></span></div>";
  };
  var ws = view.back ? TEAM.name : me.first + "’s workspace";
  return '<aside class="side"><div class="ws-h"><button class="wsw" data-do="toast:The workspace menu is as it is today">' + tile(ws[0], TEAM.c, 26) + '<b class="trunc">' + esc(ws) + '</b><span class="mut">' + ic("sort", 13) + '</span></button><button class="ib" data-do="toast:Hides the sidebar, as today" title="Hide the sidebar">' + ic("sideL", 17) + "</button></div>" +
    '<div class="side-h" style="padding-top:8px"><h2 class="lbl">Agents</h2><button class="ib" data-do="toast:New agent" title="New agent">' + ic("plus", 17) + '</button></div><div class="chats flat">' + keys.map(row).join("") + "</div><span class=\"grow\"></span>" +
    '<div class="side-f me"><button class="prow" data-do="toast:Your menu is as it is today">' + face("me", 26, "on") + '<span class="grow trunc">' + esc(me.full) + '</span><span class="mut">' + ic("sort", 13) + "</span></button></div></aside>";
}
function ahead() {
  var a = A(), t = function (label, on) { return '<button class="tab' + (on ? " on" : "") + '" data-do="toast:' + label + ' is as it is today">' + label + "</button>"; };
  return '<header class="ahead"><button class="who" data-do="toast:Another agent, as today">' + orb(who, 26, { still: true }) + "<b>" + esc(a.name) + '</b><span class="mut">' + ic("down", 13) + "</span></button>" +
    '<nav class="tabs">' + t("Chat", true) + t("Library") + t("Automations") + '</nav><span class="grow"></span>' + stack(["me"], 26) +
    '<button class="scb" data-do="toast:Side chats, as today">' + ic("aside", 17) + "Side chats</button>" +
    '<span class="acts"><button class="ib" data-do="toast:Its settings, as today" title="Settings">' + ic("gear", 17) + '</button><button class="ib on" data-do="toast:Hides the panel, as today" title="Panel">' + ic("side", 17) + "</button></span></header>";
}
function hello() {
  var a = A(), pc = "<b>" + esc(me.first) + "’s MacBook</b>";
  var p2 = view.share === "yes" ? "I can work on " + pc + " now: run commands, read and change files, and use a browser when I need one. I can reach it while Do Computer is running, so I have left it in your tray."
    : view.share === "read" ? "I can read files on " + pc + " now, and nothing more. If you want me to change things there, switch that under This Computer in the tray."
    : "I am not on " + pc + " yet. When you want me to work here, switch it on under This Computer in the tray.";
  return "<p>Hi " + esc(me.first) + ", I’m " + esc(a.name) + ". Good to finally see you.</p><p>" + p2 + "</p><p>What should we do first?</p>";
}
function words(html) { return html.replace(/(<[^>]+>)|([^\s<]+)/g, function (m, t, w) { return t || '<span class="w">' + w + "</span>"; }); }
function middle() {
  var a = A(), list, chips = "";
  if (view.back) {
    list = [{ day: "Today" }].concat(msgs).map(function (m) {
      return m.day ? '<div class="dayd">' + m.day + "</div>" : m.agent ? '<div class="m"><div class="prose">' + m.html + "</div></div>" : '<div class="m h me"><div class="line"><div class="bub">' + esc(m.text) + "</div></div></div>";
    }).join("") + (view.share === "no" ? "" : '<div class="dayd word">' + esc(me.first) + "’s MacBook was added" + (view.share === "read" ? ", read-only" : "") + "</div>");
  } else {
    list = '<div class="dayd">Today</div><div class="m"><div class="prose" id="first">' + words(hello()) + "</div></div>";
    chips = '<div class="chips">' + ["Show me what you can do", "Tidy up my Downloads folder", "Look at a project with me"].map(function (c) { return '<button class="chip" data-do="toast:Only the scene and the navigation work in this mock-up">' + c + "</button>"; }).join("") + "</div>";
  }
  return '<div class="acol">' + ahead() + '<div class="chat"><div class="scroll"><div class="msgs">' + list + chips + '</div></div><div class="foot"><div class="comp"><textarea placeholder="Message ' + esc(a.name) + '"></textarea><div class="r"><button class="ib" title="Attach">' + ic("clip", 17) + '</button><span class="grow"></span><button class="send" data-do="toast:Only the scene and the navigation work in this mock-up" title="Send">' + ic("up", 17) + "</button></div></div></div></div></div>";
}
function panel() {
  var a = A(), pc = view.share === "no"
    ? '<p class="none">None yet.</p><div class="pc"><button class="btn sm" data-do="toast:Opens This Computer, as today">Let ' + esc(a.name) + " work on this one</button></div>"
    : '<div class="pc"><span class="mut">' + ic("desktop", 18) + '</span><span class="grow"><div>' + esc(me.first) + '’s MacBook</div><div class="s"><span class="dot"></span>This computer' + (view.share === "read" ? " · read-only" : "") + "</div></span></div>";
  var did = view.back ? runs.map(function (r) { return '<div class="run"><span class="mut">' + ic("okc", 16) + '</span><div class="grow"><div class="t">' + esc(r.title) + '</div><div class="s">' + r.at + " · " + r.steps + " steps</div></div></div>"; }).join("") : '<p class="none">Nothing yet.</p>';
  return '<aside class="panel"><div class="top">' + orb(who, 176, { id: "main" }) + '<button class="pname" data-do="toast:Its settings, as today">' + esc(a.name) + '<span class="mut">' + ic("gear", 14) + '</span></button><p id="mood">Ready</p></div>' +
    '<div class="sec"><h3>Computers</h3>' + pc + "</div>" +
    '<div class="sec" style="flex:1;min-height:0;overflow:auto"><h3>What it did here</h3>' + did + "</div></aside>";
}
/* Its first words in the chat, said as it would say an answer. */
function greet() {
  var list = shellEl.querySelectorAll("#first .w"), chips = shellEl.querySelector(".chips"), i = 0;
  if (!list.length) return;
  act("speaking");
  (function next() {
    if (i < list.length) { list[i++].classList.add("on"); if (named.main) named.main.feed("token", 2); return later(next, 55); }
    act("idle");
    if (chips) chips.classList.add("on");
    var box = shellEl.querySelector("textarea");
    if (box) box.focus({ preventScroll: true });
  })();
}
function shell() {
  shellEl.innerHTML = side() + '<div class="main">' + middle() + panel() + "</div>";
  shellEl.classList.add("in");
  shellEl.querySelectorAll(".scroll").forEach(function (p) { p.scrollTop = p.scrollHeight; });
}
/* The scene is over: the app comes up under it, and the creature goes to its place in the panel. */
function toChat() {
  mark("chat");
  shell();
  var slot = shellEl.querySelector(".panel .top .orb");
  slot.classList.add("wait");
  mountOrbs();
  stage.classList.add("leaving");
  cardEl.classList.remove("on");
  var r = slot.getBoundingClientRect(), o = app.getBoundingClientRect(), to = r.width * 1.24;
  // where the creature is in its own picture, and where the one in the panel will be in its
  var mine = eggEl.getBoundingClientRect();
  flying = true;
  eggEl.style.transformOrigin = "0 0";
  eggEl.style.transform = "translate(" + (mine.left - o.left) + "px," + (mine.top - o.top) + "px) scale(" + (mine.width / S).toFixed(4) + ")";
  void eggEl.offsetWidth;
  eggEl.style.transition = "transform .95s cubic-bezier(.55,0,.2,1)";
  eggEl.style.transform = "translate(" + (r.left - o.left + r.width / 2 - to / 2) + "px," + (r.top - o.top + r.height / 2 - to / 2) + "px) scale(" + (to / S).toFixed(4) + ")";
  later(function () {
    slot.classList.remove("wait");
    stage.remove(); stage = null;
    pet.dispose(); pet = null; flying = false;
    greet();
  }, 1000);
}

/* ---------- drawing and what the buttons do ---------- */
function drawStrip() {
  var s = view.scene;
  strip.innerHTML = "<b>Mock-up</b>" + SCENES.map(function (x) { return x ? '<button class="' + (x[0] === s ? "on" : "") + '" data-do="scene:' + x[0] + '">' + x[1] + "</button>" : "<i></i>"; }).join("") +
    '<span class="sp"></span><button data-do="scene:sky">Play it from the start</button><button data-do="theme">Light / dark</button><div class="note"><b>' + NOTES[s][0] + "</b>" + NOTES[s][1] + "</div>";
  // a page shown inside another may not be allowed an address of its own
  try { if (location.hash !== "#" + s) history.replaceState(null, "", "#" + s); } catch (e) {}
}
/* A scene from the strip, or from the address: set up as if everything before it had been answered. */
function show(scene) {
  gen++;
  saying = null;
  if (pet) { pet.dispose(); pet = null; }
  orbs.forEach(function (o) { o.dispose(); }); orbs = []; named = {};
  flying = false; hatched = false; held = 0;
  view.scene = scene; view.step = null; view.signin = scene === "back"; view.back = false; view.share = "yes"; view.login = true; view.serverOpen = false;
  who = "egg";
  AGENTS.egg.name = scene === "sky" || scene === "you" || scene === "name" || scene === "back" ? "" : "Pip";
  AGENTS.egg.color = SWATCH[0];
  me.full = "Sawyer Hood"; me.first = "Sawyer"; me.ini = "SH";
  resetChat();
  app.innerHTML = '<div class="shell"></div><div class="ob"><div class="ob-title">Do Computer<small>Your agents, in a window of their own.</small></div><div class="ob-egg"><canvas></canvas></div><button class="ob-skip" data-do="skip" hidden>Skip</button><div class="ob-card"></div></div>';
  shellEl = app.querySelector(".shell"); stage = app.querySelector(".ob");
  eggEl = stage.querySelector(".ob-egg"); cardEl = stage.querySelector(".ob-card"); titleEl = stage.querySelector(".ob-title"); skipEl = stage.querySelector(".ob-skip");
  drawStrip();
  if (!gl || !core) {
    stage.innerHTML = '<div class="ob-none">This mock-up is drawn with WebGL, which this browser will not give it.</div>';
    stage = null;
    return;
  }
  if (scene === "chat") {
    stage.remove(); stage = null;
    shell(); mountOrbs();
    return later(greet, 500);
  }
  stage.insertBefore(gl.domElement, stage.firstChild);
  stageW = app.clientWidth; stageH = app.clientHeight;
  L.fe = L.feTo = L.feS = 0.25; L.ay = L.ayTo = 0.375;
  makeEgg();
  fit();
  clearSparks();
  var n = { sky: 0, you: 0, back: 0, name: 1, computer: 2, hatch: 2 }[scene];
  held = n === 1 ? 0.34 : n === 2 ? 0.67 : 0;
  W.t = 0; W.phase = W.phaseTo = n; W.mode = "rest"; W.alt = 0; W.sway = 0; W.tilt = 0; W.fallT = 0; W.beam = 0; W.glow = 0; W.flash = 0; W.dip = 0; W.dipV = 0; W.hatching = false; W.burst = false;
  if (scene === "sky") {
    W.mode = "fall"; W.alt = HIGH; W.beam = 1; W.glow = 0.75;
    skipEl.hidden = false;
    later(function () { titleEl.classList.add("on"); }, 250);
    later(function () { titleEl.classList.remove("on"); }, 1900);
  } else if (scene === "hatch") {
    later(function () { hatch(function () { begin("out"); }); }, 900);
  } else {
    later(function () { begin(scene === "back" ? "you" : scene); }, 500);
  }
  stepWorld(0); place();
}
function toast(words) {
  var t = document.createElement("div");
  t.className = "toast"; t.textContent = words; app.appendChild(t);
  setTimeout(function () { t.remove(); }, 2600);
}
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-do]");
  if (!el) {
    // a click on the scene itself: it skips the fall, and a touch rocks the egg
    if (!stage || !stage.contains(e.target) || e.target.closest(".ob-card")) return;
    if (W.mode === "fall") { W.fallT = FALL; return; }
    var b = eggEl.getBoundingClientRect();
    if (e.clientX > b.left + b.width * 0.25 && e.clientX < b.right - b.width * 0.25 && e.clientY > b.top + b.height * 0.2 && e.clientY < b.bottom) {
      if (hatched) pet.cheer(); else { nudge(0.2); pet.sp.eggY.v += 0.5; }
    }
    return;
  }
  var d = el.dataset.do.split(":"), a = d[0], v = d.slice(1).join(":");
  e.stopPropagation();
  if (a === "toast") return toast(v);
  if (a === "scene") return show(v);
  if (a === "theme") return document.documentElement.classList.toggle("dark");
  if (a === "skip") { W.fallT = FALL; return; }
  if (a === "next") return done();
  if (a === "share") return share(v);
  if (a === "signin") { view.signin = !view.signin; return again(); }
  if (a === "server") { view.serverOpen = true; return again(); }
  if (a === "dice") return setName(NAMES[view.dice++ % NAMES.length]);
  if (a === "color") {
    A().color = v; pet.setColor(v);
    cardEl.querySelectorAll(".sw").forEach(function (s) { s.classList.toggle("on", s === el); });
    cardEl.querySelector(".tag").innerHTML = tag();
    nudge(0.14); W.glow = 0.6;
  }
});
document.addEventListener("input", function (e) {
  if (e.target.id !== "f-agent") return;
  cardEl.querySelector(".btn.pri").disabled = !e.target.value.trim();
});
document.addEventListener("keydown", function (e) {
  if (e.key !== "Enter" || !stage || e.target.tagName === "BUTTON") return;
  if (W.mode === "fall") { W.fallT = FALL; return; }
  if (saying) return saying.finish();
  var b = cardEl.querySelector(".body.in .btn.pri:not(:disabled)");
  if (b) b.click();
});
window.addEventListener("pointermove", function (e) { if (pet && hatched && !flying) pet.setPointer(e.clientX, e.clientY); }, { passive: true });
window.addEventListener("hashchange", function () { var s = location.hash.slice(1); if (NOTES[s] && s !== view.scene) show(s); });
window.addEventListener("resize", fit);

if (T3 && core) makeWorld();
var first = location.hash.slice(1);
show(NOTES[first] ? first : "sky");
requestAnimationFrame(frame);
})();
