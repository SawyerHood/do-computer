/* ================================================================
   AGENT ORB WARDROBE
   What a creature can wear, and the box a new thing comes in. It sits beside orb-core.js and is
   handed the same THREE and the core:  var Wardrobe = AgentOrbWardrobe(THREE, AgentOrb)

   Wardrobe.dress(orb, { hat, glasses, face, neck })   put these on, in place of whatever it wore;
                                                       each is the id of a thing, or nothing
   Wardrobe.strip(orb)                                 take everything off
   Wardrobe.audit(orb)                                 how far the deepest thing sits inside its body
   Wardrobe.unwrap(orb, { onPop, onShown })            show a box on its stage in its place; the box
                                                       has shake(), calm(), open({ id, tiers }), dispose()
   Wardrobe.ITEMS                                      every id, and the place it is worn
   Wardrobe.SLOTS                                      the places, in the order things are put on

   There are two hundred things: 81 for the head, 40 for the eyes, 40 for the face and 39 for the
   neck. The first hundred come first, a place at a time, and the second hundred after them.
   Their names and rarities are the app's to say (packages/protocol); here is only the shape of
   each. Each is a few low-poly shapes hung on the creature's body, so it moves, squashes
   and turns with it, and is drawn at the same low resolution with the same snapped vertices,
   flat tones and dither.

   Nothing is placed by a fixed number. Every creature is grown from a seed, so each thing is
   fitted to the body it is put on, in one of three ways:
   - a stiff hat is lowered onto the head until some part of its underside touches (Maker.hat);
   - a soft one (a beanie, a scarf, a beard) is made out of the skin itself, lifted a little,
     with a hole where a tail or an ear comes through (Maker.shell, Maker.patch);
   - anything else stands off a point of the skin (Maker.at, Maker.face).
   Ears, a horn or an antenna in a hat's way flop out from under it or go under it (Maker.clear),
   and a last pass moves anything that still has a corner in the body straight out (Maker.settle).
   ================================================================ */
function AgentOrbWardrobe(THREE, core) {
"use strict";
var TAU = Math.PI * 2, HALF = Math.PI / 2;
var FRONT = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);
var SLOTS = ["hat", "glasses", "face", "neck"];
var INK = "#22252c", DARK = "#4b5066", GOLD = "#f2c230", RED = "#e63946", TEAL = "#2bb5a8", WHITE = "#f4f1ea", PINK = "#ec5a94", YEL = "#ffd23f",
  BLUE = "#3d7fe0", GREEN = "#5fbf4a", BROWN = "#7a4a2a", PURPLE = "#6b4bd6", ORANGE = "#ff7a1a", STEEL = "#a9b0bb", SKY = "#8fd3ff", ROSE = "#ff8fa3";

var VERT = [
  "uniform float uSnap; varying vec3 vV;",
  "void main(){",
  "  vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = mv.xyz;",
  "  vec4 clip = projectionMatrix * mv;",
  "  if (uSnap > 0.5) clip.xy = floor(clip.xy/clip.w*uSnap + 0.5)/uSnap*clip.w;",
  "  gl_Position = clip;",
  "}"
].join("\n");
// uPlain: one flat color, no light. uDoor: every other pixel left out, the consoles' way of seeing through.
var FRAG = [
  "uniform vec3 uCol; uniform float uPlain; uniform float uDoor; uniform float uFade; varying vec3 vV;",
  "float B2(vec2 a){ a = floor(a); return fract(a.x/2.0 + a.y*a.y*0.75); }",
  "float bayer4(vec2 p){ return B2(0.5*p)*0.25 + B2(p) + 0.03; }",
  "void main(){",
  "  float bay = bayer4(gl_FragCoord.xy);",
  "  if (uFade < 0.999 && bay > uFade) discard;",
  "  if (uDoor > 0.5 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 0.5) discard;",
  "  vec3 N = normalize(cross(dFdx(vV), dFdy(vV)));",
  "  float x = dot(N, normalize(vec3(-0.45, 0.65, 0.62))) + (bay - 0.5)*0.22;",
  "  vec3 col = uPlain > 0.5 ? uCol : x < -0.05 ? uCol*0.55 : x < 0.5 ? uCol*0.78 : x < 0.88 ? uCol : mix(uCol, vec3(1.0), 0.4);",
  "  col = floor(clamp(col, 0.0, 1.0)*31.0 + bay)/31.0;",
  "  gl_FragColor = vec4(col, 1.0);",
  "}"
].join("\n");

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
function decay(dt, tau) { return Math.exp(-dt / tau); }
function cyl(rt, rb, h, seg, open, from, arc) { return new THREE.CylinderGeometry(rt, rb, h, seg || 8, 1, !!open, from || 0, arc == null ? TAU : arc); }
function cone(r, h, seg) { return new THREE.ConeGeometry(r, h, seg || 4); }
function ico(r) { return new THREE.IcosahedronGeometry(r, 0); }
function box(x, y, z) { return new THREE.BoxGeometry(x, y, z); }
function disc(r, seg) { return new THREE.CircleGeometry(r, seg || 8); }
function tor(R, t, arc, seg) { return new THREE.TorusGeometry(R, t, 4, seg || 10, arc == null ? TAU : arc); }
// A shape turned round its axis from a profile of [radius, height] corners; open wherever the profile is.
function lathe(pts, seg) { return new THREE.LatheGeometry(pts.map(function (p) { return new THREE.Vector2(Math.max(p[0], 0.0001), p[1]); }), seg || 10); }
function ball(r, to) { return new THREE.SphereGeometry(r, 8, 4, 0, TAU, 0, to == null ? HALF : to); }
function square(t) { var g = tor(1, t, null, 4); g.rotateZ(Math.PI / 4); return g; }
function poly(points, r) {
  var s = new THREE.Shape();
  points.forEach(function (p, i) { s[i ? "lineTo" : "moveTo"](p[0] * r, p[1] * r); });
  return new THREE.ShapeGeometry(s);
}
function star(r) { var p = []; for (var i = 0; i < 10; i++) { var a = i * Math.PI / 5 + HALF, k = i % 2 ? 0.45 : 1; p.push([Math.cos(a) * k, Math.sin(a) * k]); } return poly(p, r); }
function heart(r) { return poly([[0, -1], [-1, 0.05], [-1, 0.6], [-0.55, 1], [0, 0.55], [0.55, 1], [1, 0.6], [1, 0.05]], r); }
function put(o, x, y, z, rx, ry, rz) { o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, rz || 0); return o; }
function dir(a, az) { var s = Math.sin(a); return [s * Math.sin(az), Math.cos(a), s * Math.cos(az)]; }
// How far a soft thing stands off the skin across its width: flat at the edges, full in the middle.
function puff(edge, mid) { return function (t) { return edge + (mid - edge) * Math.sin(Math.PI * t); }; }

/* What one creature's things are fitted to: the shape of its body and where its eyes and mouth are. */
function Maker(orb) {
  var g = orb.g, sh = orb.uB.uShape.value;
  var a = g.eyeSize * orb.eyeScale, b = a * g.eyeAspect;
  this.orb = orb;
  this.eye = { x: Math.max(g.eyeSize + g.eyeGap, a + 0.04), y: g.eyeY, a: a, b: b };
  this.mouthY = g.eyeY - b - 0.17;
  // the neck is under the mouth; given as how far up the face, and as an angle down from the top
  // a body that sits flat on the ground has no skin below this height of the face
  this.lowY = Math.max(-0.93, (0.12 - sh.w) / sh.y);
  this.neckY = Math.max(this.mouthY - 0.17, -0.6, this.lowY + 0.1);
  this.neck = Math.acos(this.neckY);
  // no cap comes lower than just above the eyes
  this.brow = Math.acos(clamp(g.eyeY + b + 0.14, -1, 1));
  this.sx = sh.x; this.sy = sh.y;
  this.sxTop = sh.x * (1 - sh.z * 0.7 * sh.y);
  // the skin ripples; a stiff thing keeps this far off where the skin rests
  this.slack = 0.02 + g.amp * 0.3;
  this.root = new THREE.Group();
  this.ticks = []; this.trash = [];
  // how high above its middle the tallest thing reaches, and how far out the widest, so that room can be left
  this.top = 0; this.wide = 0;
}
// A point on its skin, in the direction given; `out` lifts it off the skin.
Maker.prototype.surf = function (x, y, z, out) {
  var l = Math.sqrt(x * x + y * y + z * z) || 1;
  x /= l; y /= l; z /= l;
  var u = this.orb.uB, bump = u.uBump.value, K = u.uBumpK.value, sh = u.uShape.value, ks = [K.x, K.y, K.z], d = 0;
  for (var i = 0; i < 3; i++) d += bump[i].w * Math.pow(Math.max(x * bump[i].x + y * bump[i].y + z * bump[i].z, 0), ks[i]);
  var r = 1 + d + (out || 0), qy = y * r, k = sh.x * (1 - sh.z * qy), fb = -sh.w;
  qy *= sh.y;
  return new THREE.Vector3(x * r * k, fb + Math.log(1 + Math.exp((qy - fb) * 9)) / 9, z * r * k);
};
// How far a tail, an ear, a horn or a tuft stands out of the body in this direction. A soft thing
// leaves a hole for one rather than wrap it; the tip of a drop-shaped body is the body, not a growth.
Maker.prototype.grown = function (x, y, z) {
  var u = this.orb.uB, bump = u.uBump.value, K = u.uBumpK.value, ks = [K.x, K.y, K.z], t = this.orb.g.top, d = 0;
  for (var i = t === "ears" || t === "horn" || t === "tuft" ? 0 : 2; i < 3; i++) d += bump[i].w * Math.pow(Math.max(x * bump[i].x + y * bump[i].y + z * bump[i].z, 0), ks[i]);
  return d;
};
// The same by angles: `a` down from the top of its head, `az` round from the front.
Maker.prototype.at = function (a, az, out) { var d = dir(a, az); return this.surf(d[0], d[1], d[2], out); };
// The same for a place on its face, given the way the eyes are: across and up.
Maker.prototype.face = function (fx, fy, out) { return this.surf(fx, fy, Math.sqrt(Math.max(0.01, 1 - fx * fx - fy * fy)), out); };
// Turn something to lie against the face there. `k` is how far: 1 flat on the skin, 0 facing straight out.
Maker.prototype.facing = function (o, fx, fy, k) {
  var n = new THREE.Vector3(fx, fy, Math.sqrt(Math.max(0.01, 1 - fx * fx - fy * fy))).normalize().lerp(FRONT, 1 - (k == null ? 0.6 : k)).normalize();
  o.quaternion.setFromUnitVectors(FRONT, n);
  return o;
};
Maker.prototype.group = function (parent) { var g = new THREE.Group(); (parent || this.root).add(g); return g; };
// A group on the face: at a place, lying against it.
Maker.prototype.onFace = function (fx, fy, out, k) { var g = this.group(); g.position.copy(this.face(fx, fy, out)); return this.facing(g, fx, fy, k); };
// A color to draw with: lit in a few flat tones, or `plain`, or with every other pixel left out (`door`).
Maker.prototype.ink = function (color, o) {
  var u = this.orb.uB;
  var mat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(color) }, uPlain: { value: o.plain ? 1 : 0 }, uDoor: { value: o.door ? 1 : 0 }, uSnap: u.uSnap, uFade: u.uFade },
    vertexShader: VERT, fragmentShader: FRAG, extensions: { derivatives: true }, transparent: true, side: THREE.DoubleSide
  });
  this.trash.push(mat);
  return mat;
};
Maker.prototype.free = function () { this.trash.forEach(function (x) { x.dispose(); }); this.trash = []; };
Maker.prototype.mesh = function (geo, color, o) {
  o = o || {};
  var mat = this.ink(color, o);
  var m = new THREE.Mesh(geo, mat);
  // after the body, before its rings and motes
  m.renderOrder = 1.5; m.frustumCulled = false;
  // soft: meant to go into the skin (a lining, the root of a horn), so not counted as sunk into it
  m.userData.soft = !!o.soft;
  (o.in || this.root).add(m);
  this.trash.push(geo);
  return m;
};
// The top of its head as points, for lowering a hat onto.
Maker.prototype.dome = function () {
  var pts = [this.surf(0, 1, 0)];
  for (var a = 0.04; a < 1.5; a += 0.04) for (var i = 0; i < 20; i++) pts.push(this.at(a, i * TAU / 20));
  return pts;
};
// The highest thing about it, an antenna counted.
Maker.prototype.peak = function () {
  var u = this.orb.uB, y = -9, t = u.uTop.value;
  this.dome().forEach(function (p) { if (p.y > y) y = p.y; });
  if (t.w > 0.5) {
    var d = u.uTopDir.value, up = new THREE.Vector3(d.x, d.y + 0.7, d.z).normalize();
    y = Math.max(y, this.surf(d.x, d.y, d.z).y * 0.96 + up.y * t.x + t.z);
  }
  return y;
};
// The widest it is round the middle, between two angles down from the top.
Maker.prototype.girth = function (a0, a1) {
  var r = 0;
  for (var a = a0; a <= a1; a += 0.08) for (var i = 0; i < 16; i++) { var p = this.at(a, i * TAU / 16); r = Math.max(r, Math.sqrt(p.x * p.x + p.z * p.z)); }
  return r;
};
/* What grows on its head and is in the way of a hat this wide. An antenna goes under the hat. Ears
   flop out sideways from under a small hat, to the nearest corner of the body that is clear of it,
   and are smaller for it; under a wide brim they lie flat, as a horn or a tuft does under any hat.
   `flat` lays everything flat. */
Maker.prototype.clear = function (radius, flat) {
  var o = this.orb, g = o.g, u = o.uB, bump = u.uBump.value, K = u.uBumpK.value, ks = [K.x, K.y];
  if (g.top === "antenna" || g.top === "floater") { u.uTop.value.w = 0; return; }
  if (g.top !== "ears" && g.top !== "horn" && g.top !== "tuft") return;
  var edge = Math.asin(Math.min(1, radius / this.sxTop));
  for (var i = 0; i < (g.top === "ears" ? 2 : 1); i++) {
    var b = bump[i];
    if (b.w <= 0.04) continue;
    var here = Math.acos(clamp(b.y, -1, 1));
    if (here >= edge + Math.acos(Math.pow(0.04 / b.w, 1 / ks[i]))) continue;
    if (flat || g.top !== "ears") { b.w = 0; continue; }
    // a flopped ear is a smaller one; under a wide brim there is nowhere for it to flop to
    var small = b.w * 0.7, want = edge + Math.acos(Math.pow(Math.min(1, 0.08 / small), 1 / ks[i]));
    if (want > 1.02) { b.w = 0; continue; }
    b.w = small;
    var d = dir(want, Math.atan2(b.x, b.z)), verts = null, best = -1, near = 0.9;
    try { verts = core.Stage.body(o.css < 40 ? Math.min(g.poly, 2) : o.css < 100 ? Math.min(g.poly, 3) : g.poly).userData.body; } catch (e) { verts = null; }
    // an ear needs a corner of the body at its tip, or it is only a swelling
    if (verts) for (var j = 0; j < verts.length; j += 3) {
      if (verts[j + 1] > Math.cos(want - 0.02) || verts[j + 1] < Math.cos(want + 0.3)) continue;
      var dot = verts[j] * d[0] + verts[j + 1] * d[1] + verts[j + 2] * d[2];
      if (dot > near) { near = dot; best = j; }
    }
    if (best >= 0) d = [verts[best], verts[best + 1], verts[best + 2]];
    b.x = d[0]; b.y = d[1]; b.z = d[2];
  }
};
// For something that stands on the very top: an antenna, a horn or a tuft makes way; ears stay.
Maker.prototype.bare = function () {
  var o = this.orb, g = o.g;
  if (g.top === "antenna" || g.top === "floater") o.uB.uTop.value.w = 0;
  if (g.top === "horn" || g.top === "tuft") o.uB.uBump.value[0].w = 0;
};
/* A stiff hat's own frame. The hat is described by its underside: `r` is how wide it is open
   underneath, `R` how wide it is in all (its brim), and the hollow above the opening is `dome`
   high (a cone's narrows to nothing; Infinity is a ring with no top), or `cav(rho)` gives it.
   The frame is tipped by `tilt` and `lean`, and then lowered along its own axis until the first
   point of the head touches the underside, so no part of the hat is inside the head whatever
   the head's shape. `tall` is the hat's height, `liner` the color of a lining that hides the gap
   where the head falls away. */
Maker.prototype.hat = function (o) {
  var r = o.r || 0, R = Math.max(o.R || 0, r + 0.08);
  this.clear(R + Math.abs(o.tilt || 0) * 0.5);
  var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.lean || 0, 0, o.tilt || 0)), back = q.clone().conjugate();
  var h = -9, v = new THREE.Vector3();
  this.dome().forEach(function (p) {
    v.copy(p).applyQuaternion(back);
    var rho = Math.sqrt(v.x * v.x + v.z * v.z);
    if (rho > R) return;
    var cav = rho >= r ? 0 : o.cav ? Math.max(0, o.cav(rho)) : o.cone ? o.dome * (1 - rho / r) : o.dome || 0;
    if (v.y - cav > h) h = v.y - cav;
  });
  if (h < -1) h = this.surf(0, 1, 0).y;
  h += this.slack;
  var g = this.group();
  g.quaternion.copy(q); g.position.set(0, h, 0).applyQuaternion(q);
  g.userData.push = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  this.top = Math.max(this.top, g.position.y + (o.tall || 0));
  if (o.liner) put(this.mesh(cyl(r * 0.93, r * 0.93, 0.24, 10, true), o.liner, { in: g, soft: true }), 0, -0.12, 0);
  return g;
};
/* A soft thing, made of the skin itself between two angles down from the top, lifted by `out`
   (a number, or a function of how far down and how far round). It cannot be inside the body. */
Maker.prototype.shell = function (a0, a1, out, color, o) {
  o = o || {};
  var z0 = o.az0 || 0, z1 = o.az1 == null ? TAU : o.az1, seg = o.seg || Math.max(2, Math.round(16 * (z1 - z0) / TAU)), rows = o.rows || 3, pos = [], idx = [], out0 = [], i, j;
  for (j = 0; j <= rows; j++) for (i = 0; i <= seg; i++) {
    var t = j / rows, u = i / seg, a = a0 + (a1 - a0) * t + (o.zig && j === rows ? (i % 2 ? o.zig : -o.zig) : 0), d = dir(a, z0 + (z1 - z0) * u);
    var p = this.surf(d[0], d[1], d[2], typeof out === "function" ? out(t, u) : out);
    pos.push(p.x, p.y, p.z); out0.push(this.grown(d[0], d[1], d[2]) > 0.03);
    if (a < HALF) this.top = Math.max(this.top, p.y);
  }
  for (j = 0; j < rows; j++) for (i = 0; i < seg; i++) {
    var k = j * (seg + 1) + i;
    if (out0[k] || out0[k + 1] || out0[k + seg + 1] || out0[k + seg + 2]) continue;
    idx.push(k, k + seg + 1, k + 1, k + 1, k + seg + 1, k + seg + 2);
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  return this.mesh(geo, color, o);
};
// The same on the face: `fn(u, v)` gives across, up and out for each corner of an n by n sheet.
Maker.prototype.patch = function (fn, color, o) {
  o = o || {};
  var n = o.n || 5, pos = [], idx = [], i, j;
  for (j = 0; j <= n; j++) for (i = 0; i <= n; i++) { var f = fn(i / n, j / n), p = this.face(f[0], f[1], f[2]); pos.push(p.x, p.y, p.z); }
  for (j = 0; j < n; j++) for (i = 0; i < n; i++) { var k = j * (n + 1) + i; idx.push(k, k + n + 1, k + 1, k + 1, k + n + 1, k + n + 2); }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  return this.mesh(geo, color, o);
};
// A soft cap down to angle `a`: whatever grows under it lies flat, and it stops above the eyes.
Maker.prototype.capTo = function (a) { a = Math.min(a, this.brow); this.clear(Math.sin(Math.min(a, HALF)) * this.sxTop, true); return a; };
// `n` things spaced round it at angle `a`.
Maker.prototype.around = function (a, n, out, fn, from) {
  for (var i = 0; i < n; i++) { var az = (from || 0) + i * TAU / n, d = dir(a, az); if (this.grown(d[0], d[1], d[2]) < 0.03) fn(this.surf(d[0], d[1], d[2], out), i, az); }
};
// A band round the neck.
Maker.prototype.band = function (color, half, mid, o) { o = Object.assign({ rows: 2 }, o); return this.shell(this.neck - half, this.neck + half, o.rows > 1 ? puff(0.03, mid) : mid, color, o); };
// A frame hanging under the chin, for what a band carries.
Maker.prototype.chin = function (drop, out) { var g = this.group(); g.position.copy(this.face(0, this.neckY, out == null ? 0.09 : out)); g.position.y -= drop || 0; return g; };

// Something placed where it is on purpose: the last pass leaves it there.
Maker.prototype.stay = function (o) { o.userData.stay = true; return o; };
// How far a point is inside the body, in body radii; less than nothing is outside. The reverse of `surf`.
Maker.prototype.depth = function (p) {
  var u = this.orb.uB, sh = u.uShape.value, bump = u.uBump.value, K = u.uBumpK.value, ks = [K.x, K.y, K.z], fb = -sh.w, d = 0;
  var e = Math.exp((p.y - fb) * 9) - 1;
  if (e <= 0.02) return -9;
  var y = (fb + Math.log(e) / 9) / sh.y, k = sh.x * (1 - sh.z * y), x = p.x / k, z = p.z / k, r = Math.sqrt(x * x + y * y + z * z) || 1;
  for (var i = 0; i < 3; i++) d += bump[i].w * Math.pow(Math.max((x * bump[i].x + y * bump[i].y + z * bump[i].z) / r, 0), ks[i]);
  return 1 + d - r;
};
// The deepest corner, or middle of a face, of everything under `o`. Linings and roots, which are meant to go in, are not counted.
Maker.prototype.sunk = function (o) {
  var self = this, root = this.root, worst = -9, M = new THREE.Matrix4(), v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  o.traverse(function (n) {
    if (!n.isMesh || n.userData.soft) return;
    M.identity();
    for (var q = n; q && q !== root; q = q.parent) { q.updateMatrix(); M.premultiply(q.matrix); }
    var pos = n.geometry.attributes.position, idx = n.geometry.index, count = idx ? idx.count : pos.count, i;
    for (i = 0; i < pos.count; i++) worst = Math.max(worst, self.depth(v.fromBufferAttribute(pos, i).applyMatrix4(M)));
    for (i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i); b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1); c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2);
      worst = Math.max(worst, self.depth(v.copy(a).add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(M)));
    }
  });
  return worst;
};
/* The last pass, once everything is on: anything that still has a corner in the body is moved
   straight out from it (a hat along its own axis) until it has none. */
Maker.prototype.settle = function () {
  var self = this, v = new THREE.Vector3();
  this.root.children.forEach(function (c) {
    if (c.userData.stay) return;
    for (var n = 0; n < 5; n++) {
      var d = self.sunk(c);
      if (d < -0.004) return;
      if (c.userData.push) v.copy(c.userData.push); else v.copy(c.position);
      if (v.lengthSq() < 0.04) return;
      c.position.addScaledVector(v.normalize(), d + 0.014);
    }
  });
};

// Every thing by its id: the place it is worn, and how it is made for one creature.
var ITEMS = {}, MAKE = {};
function item(id, slot, make) { ITEMS[id] = slot; MAKE[id] = make; }

/* ================= on the head (41) =================
   A stiff hat is open underneath, like a real one: a brim is a ring and a crown has no floor, so
   that the top of the head can be inside the hat without being inside any part of it. */
function partyHat(id, c1, c2) {
  item(id, "hat", function (m) {
    var h = m.hat({ r: 0.32, R: 0.42, dome: 0.64, cone: true, tall: 0.86, tilt: -0.16, liner: c2 });
    m.mesh(lathe([[0.36, 0], [0.02, 0.72], [0, 0.72]], 10), c1, { in: h });
    put(m.mesh(tor(0.37, 0.05, null, 12), c2, { in: h }), 0, 0.05, 0, HALF);
    put(m.mesh(ico(0.1), c2, { in: h }), 0, 0.76, 0);
  });
}
function beanie(id, c1, c2, stripes) {
  item(id, "hat", function (m) {
    var a = m.capTo(1.0), p = m.at(0, 0, 0.19);
    if (stripes) { m.shell(0, a * 0.5, 0.075, c1); m.shell(a * 0.5, a, 0.075, c2); } else m.shell(0, a, 0.075, c1);
    m.shell(a - 0.14, a + 0.04, puff(0.03, 0.14), stripes ? c1 : c2, { rows: 2 });
    put(m.mesh(ico(stripes ? 0.2 : 0.14), c2), p.x, p.y + (stripes ? 0.1 : 0.04), p.z);
    m.top = Math.max(m.top, p.y + 0.3);
  });
}
function cap(id, c1, c2, back) {
  item(id, "hat", function (m) {
    var a = m.capTo(0.8), s = back ? -1 : 1, p = m.at(a - 0.05, back ? Math.PI : 0, 0.08), t = m.at(0, 0, 0.13);
    m.shell(0, a, 0.075, c1);
    put(m.mesh(box(0.54, 0.05, 0.34), c2), p.x, p.y - 0.01, p.z + s * 0.2, s * 0.28);
    put(m.mesh(ico(0.05), c2), t.x, t.y, t.z);
  });
}
function crown(id, c, jewel) {
  item(id, "hat", function (m) {
    var h = m.hat({ r: 0.33, R: 0.44, cav: function (rho) { return rho < 0.24 ? Infinity : 0.2; }, tall: 0.44, tilt: 0.1, liner: c });
    put(m.mesh(cyl(0.37, 0.34, 0.2, 10, true), c, { in: h }), 0, 0.1, 0);
    for (var i = 0; i < 5; i++) { var a = i * TAU / 5; put(m.mesh(cone(0.09, 0.2), c, { in: h }), 0.35 * Math.sin(a), 0.3, 0.35 * Math.cos(a)); }
    if (jewel) put(m.mesh(ico(0.065), jewel, { in: h }), 0, 0.1, 0.4);
  });
}
partyHat("party", PINK, YEL);
partyHat("party2", TEAL, WHITE);
beanie("beanie", "#d9534f", WHITE);
beanie("beanie2", BLUE, YEL);
beanie("bobble", GREEN, WHITE, true);
item("sprout", "hat", function (m) {
  m.bare();
  var g = m.group(), p = m.surf(0, 1, 0);
  g.position.set(p.x, p.y - 0.03, p.z);
  put(m.mesh(cyl(0.035, 0.035, 0.3, 4), "#4faa3c", { in: g, soft: true }), 0, 0.15, 0);
  [-1, 1].forEach(function (s) { put(m.mesh(ico(0.17), "#86e052", { in: g }), s * 0.17, 0.32, 0, 0, 0, s * 0.5).scale.set(1.35, 0.4, 0.8); });
  m.ticks.push(function (dt, t) { g.rotation.z = 0.12 * Math.sin(t * 1.7); });
  m.top = Math.max(m.top, p.y + 0.5);
});
item("cone", "hat", function (m) {
  var h = m.hat({ r: 0.35, R: 0.64, cav: function (rho) { return 0.07 + 0.78 * (1 - rho / 0.35); }, tall: 0.95, tilt: 0.08, liner: "#c9560a" });
  put(m.mesh(lathe([[0.52, 0], [0.64, 0], [0.64, 0.07], [0.52, 0.07]], 4), ORANGE, { in: h }), 0, 0, 0, 0, Math.PI / 4);
  put(m.mesh(lathe([[0.38, 0], [0.07, 0.85], [0, 0.85]], 8), ORANGE, { in: h }), 0, 0.07, 0);
  put(m.mesh(cyl(0.192, 0.264, 0.2, 8, true), WHITE, { in: h }), 0, 0.52, 0);
});
cap("cap", RED, WHITE);
cap("backcap", BLUE, INK, true);
item("beret", "hat", function (m) {
  var a = m.capTo(0.72), p = m.at(0, 0, 0.1);
  m.shell(0, a, function (t) { return 0.06 + 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.15)); }, "#a8323e", { rows: 4 });
  put(m.mesh(cyl(0.025, 0.025, 0.1, 4), "#a8323e"), p.x, p.y + 0.04, p.z);
});
item("bow", "hat", function (m) {
  var h = m.hat({ R: 0.42, tall: 0.4, lean: 0.12 });
  [-1, 1].forEach(function (s) { put(m.mesh(cone(0.2, 0.3), PINK, { in: h }), s * 0.2, 0.2, 0, 0, 0, s * HALF).scale.z = 0.6; });
  put(m.mesh(box(0.12, 0.16, 0.12), "#c93d77", { in: h }), 0, 0.2, 0);
});
item("paperhat", "hat", function (m) {
  var h = m.hat({ r: 0.24, R: 0.52, dome: 0.4, cone: true, tall: 0.48, liner: "#cfcabb" });
  put(m.mesh(lathe([[0.5, 0], [0.02, 0.44], [0, 0.44]], 4), WHITE, { in: h }), 0, 0, 0, 0, Math.PI / 4).scale.z = 0.72;
  put(m.mesh(lathe([[0.52, 0], [0.43, 0.09]], 4), STEEL, { in: h }), 0, 0, 0, 0, Math.PI / 4).scale.z = 0.74;
});
item("bucket", "hat", function (m) {
  var h = m.hat({ r: 0.4, R: 0.66, cav: function (rho) { return rho < 0.32 ? 0.46 : rho < 0.4 ? 0.16 : 0.16 * (0.66 - rho) / 0.26; }, tall: 0.5, tilt: -0.08, liner: "#5e7d49" });
  put(m.mesh(cyl(0.42, 0.66, 0.16, 10, true), "#8fb573", { in: h }), 0, 0.08, 0);
  m.mesh(lathe([[0.42, 0.16], [0.34, 0.46], [0, 0.46]], 10), "#8fb573", { in: h });
});
item("straw", "hat", function (m) {
  var h = m.hat({ r: 0.4, R: 0.74, dome: 0.33, tall: 0.36, tilt: 0.1, liner: "#b89b55" });
  m.mesh(lathe([[0.42, 0], [0.74, 0], [0.74, 0.05], [0.42, 0.05]], 12), "#e8cf8a", { in: h });
  m.mesh(lathe([[0.42, 0.05], [0.4, 0.33], [0, 0.33]], 10), "#e8cf8a", { in: h });
  put(m.mesh(cyl(0.435, 0.435, 0.09, 10, true), RED, { in: h }), 0, 0.11, 0);
});
item("sweatband", "hat", function (m) {
  m.shell(m.brow - 0.24, m.brow - 0.04, puff(0.04, 0.1), RED, { rows: 2 });
  m.shell(m.brow - 0.17, m.brow - 0.11, 0.105, WHITE, { rows: 1 });
});
crown("papercrown", ROSE);
item("eggshell", "hat", function (m) {
  var a = m.capTo(0.84);
  m.shell(0, a - 0.1, 0.08, "#f6f1e4", { rows: 3, zig: 0.1 });
});
item("tophat", "hat", function (m) {
  var h = m.hat({ r: 0.4, R: 0.66, dome: 0.61, tall: 0.62, tilt: 0.12, liner: "#2b2e3a" });
  m.mesh(lathe([[0.44, 0], [0.66, 0], [0.66, 0.06], [0.44, 0.06]], 10), DARK, { in: h });
  m.mesh(lathe([[0.44, 0.06], [0.42, 0.61], [0, 0.61]], 10), DARK, { in: h });
  put(m.mesh(cyl(0.46, 0.46, 0.12, 10, true), TEAL, { in: h }), 0, 0.15, 0);
});
item("bowler", "hat", function (m) {
  var h = m.hat({ r: 0.4, R: 0.62, cav: function (rho) { return 0.05 + 0.34 * Math.sqrt(Math.max(0, 1 - rho * rho / 0.16)); }, tall: 0.46, tilt: -0.1, liner: "#2b2e3a" });
  m.mesh(lathe([[0.42, 0], [0.62, 0], [0.62, 0.05], [0.42, 0.05]], 10), DARK, { in: h });
  put(m.mesh(ball(0.42), DARK, { in: h }), 0, 0.05, 0).scale.y = 0.9;
  put(m.mesh(cyl(0.435, 0.435, 0.08, 10, true), STEEL, { in: h }), 0, 0.1, 0);
});
item("cowboy", "hat", function (m) {
  var h = m.hat({ r: 0.31, R: 0.84, cav: function (rho) { return rho < 0.2 ? 0.44 : 0.44 * (0.31 - rho) / 0.11; }, tall: 0.5, tilt: 0.08, liner: "#7d5430" });
  put(m.mesh(cyl(0.84, 0.56, 0.14, 10, true), "#b07a48", { in: h }), 0, 0.07, 0);
  m.mesh(lathe([[0.36, 0], [0.56, 0]], 10), "#b07a48", { in: h });
  m.mesh(lathe([[0.4, 0], [0.27, 0.44], [0, 0.44]], 8), "#b07a48", { in: h }).scale.z = 0.85;
  put(m.mesh(cyl(0.385, 0.41, 0.07, 8, true), "#5a3a20", { in: h }), 0, 0.045, 0).scale.z = 0.85;
});
item("fez", "hat", function (m) {
  var h = m.hat({ r: 0.32, R: 0.36, cav: function (rho) { return rho < 0.24 ? 0.42 : 0.42 * (0.32 - rho) / 0.08; }, tall: 0.46, tilt: 0.14, liner: "#8f1d2a" });
  m.mesh(lathe([[0.34, 0], [0.26, 0.42], [0, 0.42]], 10), "#c62b3b", { in: h });
  put(m.mesh(box(0.3, 0.03, 0.03), GOLD, { in: h }), 0.15, 0.435, 0);
  put(m.mesh(box(0.035, 0.22, 0.035), GOLD, { in: h }), 0.31, 0.33, 0);
  put(m.mesh(ico(0.05), GOLD, { in: h }), 0.31, 0.2, 0);
});
item("chef", "hat", function (m) {
  var h = m.hat({ r: 0.34, R: 0.38, dome: 0.22, tall: 0.86, tilt: -0.08, liner: "#cfcabb" });
  put(m.mesh(cyl(0.36, 0.36, 0.34, 10, true), WHITE, { in: h }), 0, 0.17, 0);
  put(m.mesh(ico(0.47), WHITE, { in: h }), 0, 0.54, 0).scale.y = 0.68;
});
item("hardhat", "hat", function (m) {
  var a = m.capTo(0.86), p = m.at(0, 0, 0.13);
  m.shell(0, a, 0.09, YEL);
  m.shell(a - 0.05, a + 0.06, puff(0.07, 0.2), YEL, { rows: 2, az0: -1.1, az1: 1.1, seg: 6 });
  put(m.mesh(box(0.1, 0.06, 0.5), "#e0b020"), p.x, p.y + 0.03, p.z);
});
// A band over the top of its head from one side to the other, `half` wide to the front and to the back.
function arch(m, color, half) {
  var pos = [], idx = [], n = 12, i;
  for (i = 0; i <= n; i++) { var t = -1.4 + 2.8 * i / n, p = m.surf(Math.sin(t), Math.cos(t), 0, 0.1); pos.push(p.x, p.y, p.z + half, p.x, p.y, p.z - half); m.top = Math.max(m.top, p.y); }
  for (i = 0; i < n; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
  var geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  return m.mesh(geo, color);
}
item("headphones", "hat", function (m) {
  m.clear(1, true);
  arch(m, DARK, 0.08);
  [-1, 1].forEach(function (s) {
    var c = m.surf(s, 0.12, 0, 0.12), g = m.group();
    g.position.set(c.x + s * 0.06, c.y, c.z);
    put(m.mesh(cyl(0.27, 0.27, 0.17, 8), TEAL, { in: g }), 0, 0, 0, 0, 0, HALF);
    put(m.mesh(cyl(0.19, 0.19, 0.06, 8), DARK, { in: g }), s * 0.1, 0, 0, 0, 0, HALF);
    m.wide = Math.max(m.wide, Math.abs(c.x) + 0.3);
  });
});
item("mortarboard", "hat", function (m) {
  var h = m.hat({ r: 0.34, R: 0.4, dome: 0.17, tall: 0.26, tilt: 0.1, liner: "#1d2028" });
  m.mesh(lathe([[0.38, 0], [0.36, 0.17]], 10), "#2f3340", { in: h });
  put(m.mesh(box(0.86, 0.04, 0.86), "#2f3340", { in: h }), 0, 0.19, 0, 0, Math.PI / 4);
  put(m.mesh(box(0.4, 0.025, 0.025), YEL, { in: h }), 0.2, 0.225, 0.1, 0, -0.5);
  put(m.mesh(box(0.035, 0.2, 0.035), YEL, { in: h }), 0.4, 0.13, 0.2);
});
item("daisy", "hat", function (m) {
  m.bare();
  var g = m.group(), p = m.surf(0, 1, 0), f = m.group(g);
  g.position.set(p.x, p.y - 0.03, p.z);
  put(m.mesh(cyl(0.03, 0.03, 0.34, 4), "#4faa3c", { in: g, soft: true }), 0, 0.17, 0);
  put(f, 0, 0.38, 0.02, 0.35);
  for (var i = 0; i < 6; i++) { var a = i * TAU / 6; put(m.mesh(ico(0.09), WHITE, { in: f }), 0.13 * Math.cos(a), 0.13 * Math.sin(a), 0).scale.z = 0.4; }
  m.mesh(ico(0.08), YEL, { in: f }).position.z = 0.03;
  m.ticks.push(function (dt, t) { g.rotation.z = 0.1 * Math.sin(t * 1.5); });
  m.top = Math.max(m.top, p.y + 0.62);
});
// A pair of things that grow out of the head, where ears would: its own ears lie flat for them.
function pair(m, a, fn) {
  m.clear(1, true);
  [-1, 1].forEach(function (s) { var g = m.group(); g.position.copy(m.at(a, s * HALF, -0.02)); m.stay(g); fn(g, s); m.top = Math.max(m.top, g.position.y + 0.5); });
}
item("catears", "hat", function (m) {
  pair(m, 0.6, function (g, s) {
    g.rotation.z = -s * 0.45;
    put(m.mesh(cone(0.22, 0.36), "#3a3f4f", { in: g, soft: true }), 0, 0.16, 0).scale.z = 0.7;
    put(m.mesh(cone(0.12, 0.22), ROSE, { in: g, soft: true }), 0, 0.13, 0.09).scale.z = 0.5;
  });
});
item("devilhorns", "hat", function (m) {
  pair(m, 0.52, function (g, s) {
    g.rotation.z = -s * 0.3;
    put(m.mesh(cyl(0.06, 0.1, 0.16, 5), RED, { in: g, soft: true }), 0, 0.07, 0);
    put(m.mesh(cone(0.06, 0.18, 5), RED, { in: g, soft: true }), -s * 0.03, 0.23, 0, 0, 0, s * 0.35);
  });
});
item("wizard", "hat", function (m) {
  var h = m.hat({ r: 0.4, R: 0.78, cav: function (rho) { return rho < 0.18 ? 0.5 : 0.05 + 0.45 * (0.4 - rho) / 0.22; }, tall: 0.95, tilt: -0.1, liner: "#4a31a3" });
  m.mesh(lathe([[0.44, 0], [0.78, 0], [0.78, 0.05], [0.44, 0.05]], 10), PURPLE, { in: h });
  put(m.mesh(cyl(0.2, 0.44, 0.5, 7, true), PURPLE, { in: h }), 0, 0.3, 0);
  put(m.mesh(cyl(0.01, 0.21, 0.42, 7), PURPLE, { in: h }), 0.07, 0.74, 0, 0, 0, -0.35);
  put(m.mesh(cyl(0.455, 0.47, 0.09, 7, true), YEL, { in: h }), 0, 0.1, 0);
  put(m.mesh(ico(0.07), YEL, { in: h }), 0.15, 0.94, 0);
});
item("propeller", "hat", function (m) {
  var a = m.capTo(0.7), p = m.at(0, 0, 0.08), cols = [RED, YEL, BLUE, GREEN], blades = m.group();
  for (var i = 0; i < 4; i++) m.shell(0, a, 0.075, cols[i], { az0: i * HALF, az1: (i + 1) * HALF, seg: 3 });
  put(m.mesh(cyl(0.035, 0.035, 0.16, 4), YEL, { soft: true }), p.x, p.y + 0.07, p.z);
  blades.position.set(p.x, p.y + 0.17, p.z);
  m.mesh(box(0.7, 0.035, 0.13), YEL, { in: blades });
  m.ticks.push(function (dt) { blades.rotation.y += dt * 9; });
  m.top = Math.max(m.top, p.y + 0.22);
});
item("viking", "hat", function (m) {
  var a = m.capTo(0.84);
  m.shell(0, a, 0.09, STEEL);
  m.shell(a - 0.1, a + 0.03, puff(0.08, 0.14), "#7c8494", { rows: 2 });
  [-1, 1].forEach(function (s) {
    var g = m.group();
    g.position.copy(m.at(Math.min(0.85, a), s * HALF, 0.07)); m.stay(g);
    g.quaternion.setFromUnitVectors(UP, new THREE.Vector3(s * 0.8, 0.6, 0).normalize());
    put(m.mesh(cyl(0.09, 0.13, 0.26, 6), WHITE, { in: g, soft: true }), 0, 0.11, 0);
    put(m.mesh(cone(0.09, 0.26, 6), WHITE, { in: g }), -s * 0.06, 0.34, 0, 0, 0, s * 0.5);
    m.wide = Math.max(m.wide, Math.abs(g.position.x) + 0.45);
    m.top = Math.max(m.top, g.position.y + 0.45);
  });
});
item("santa", "hat", function (m) {
  var h = m.hat({ r: 0.33, R: 0.52, cav: function (rho) { return rho < 0.19 ? 0.5 : 0.09 + 0.4 * (0.33 - rho) / 0.14; }, tall: 0.8, tilt: 0.1, liner: WHITE });
  put(m.mesh(tor(0.43, 0.09, null, 12), WHITE, { in: h }), 0, 0.09, 0, HALF);
  put(m.mesh(cyl(0.22, 0.42, 0.42, 8, true), RED, { in: h }), 0, 0.3, 0);
  put(m.mesh(cyl(0.03, 0.23, 0.42, 8), RED, { in: h }), 0.17, 0.61, 0, 0, 0, -0.95);
  put(m.mesh(ico(0.1), WHITE, { in: h }), 0.38, 0.72, 0);
});
item("bunny", "hat", function (m) {
  pair(m, 0.36, function (g, s) {
    g.rotation.z = -s * 0.16;
    put(m.mesh(ico(0.15), WHITE, { in: g, soft: true }), 0, 0.42, 0).scale.set(1, 3, 0.55);
    put(m.mesh(ico(0.08), ROSE, { in: g, soft: true }), 0, 0.44, 0.06).scale.set(1, 3.6, 0.4);
    if (s > 0) m.ticks.push(function (dt, t) { g.rotation.z = -0.16 - 0.5 * Math.max(0, Math.sin(t * 0.9) - 0.8); });
    m.top = Math.max(m.top, g.position.y + 0.9);
  });
});
item("mushroom", "hat", function (m) {
  var h = m.hat({ r: 0.82, R: 0.88, cav: function (rho) { return 0.5 * Math.sqrt(Math.max(0, 1 - rho * rho / 0.6724)) - 0.02; }, tall: 0.54, tilt: 0.06 });
  m.mesh(ball(0.86), "#e23b3b", { in: h }).scale.y = 0.6;
  [[0, 0.5, 0.1, 0.13], [0.5, 0.33, 0.35, 0.11], [-0.45, 0.36, 0.4, 0.1], [0.1, 0.2, 0.78, 0.09], [-0.55, 0.3, -0.3, 0.1], [0.55, 0.3, -0.35, 0.1]].forEach(function (s) {
    put(m.mesh(ico(s[3]), WHITE, { in: h, soft: true }), s[0], s[1], s[2]).scale.y = 0.5;
  });
  m.wide = Math.max(m.wide, 0.9);
});
item("frog", "hat", function (m) {
  var a = m.capTo(0.86);
  m.shell(0, a, 0.08, "#6cc24a");
  [-1, 1].forEach(function (s) {
    var p = m.at(0.42, s * 0.75, 0.2), g = m.group();
    g.position.copy(p);
    m.mesh(ico(0.17), WHITE, { in: g });
    put(m.mesh(ico(0.08), INK, { in: g }), 0, 0, 0.14);
    m.top = Math.max(m.top, p.y + 0.2);
  });
});
crown("crown", GOLD, RED);
item("halo", "hat", function (m) {
  var y = m.peak() + 0.26, ring = put(m.mesh(tor(0.4, 0.055, null, 10), "#ffd95a"), 0, y, 0, HALF - 0.22);
  m.stay(ring);
  m.ticks.push(function (dt, t) { ring.position.y = y + 0.035 * Math.sin(t * 2.2); });
  m.top = Math.max(m.top, y + 0.14);
});
item("cloud", "hat", function (m) {
  var y = m.peak() + 0.66, g = m.stay(m.group()), drops = [];
  g.position.y = y;
  [[-0.24, 0, 0.2], [0, 0.07, 0.27], [0.25, 0, 0.19], [0.05, -0.03, 0.2]].forEach(function (c, i) { put(m.mesh(ico(c[2]), i === 3 ? "#b9c4d2" : "#e6ecf3", { in: g }), c[0], c[1], i === 3 ? 0.12 : 0); });
  for (var i = 0; i < 5; i++) drops.push(put(m.mesh(box(0.035, 0.1, 0.035), SKY, { in: g, plain: true }), -0.3 + i * 0.15, -0.2, 0.05));
  m.ticks.push(function (dt, t) {
    g.position.x = 0.06 * Math.sin(t * 0.7);
    drops.forEach(function (d, i) { d.position.y = -0.18 - ((t * 0.9 + i * 0.37) % 1) * 0.3; });
  });
  m.top = Math.max(m.top, y + 0.36);
});
item("spacehelmet", "hat", function (m) {
  var top = m.peak(), low = m.surf(0, -1, 0).y, cy = (top + low) / 2 + 0.06, Rb = top - cy + 0.14;
  for (var a = 0.1; a < 3.1; a += 0.1) for (var i = 0; i < 16; i++) { var p = m.at(a, i * TAU / 16); Rb = Math.max(Rb, Math.sqrt(p.x * p.x + (p.y - cy) * (p.y - cy) + p.z * p.z) + 0.14); }
  m.stay(put(m.mesh(tor(Rb, 0.035, null, 20), "#d7efff"), 0, cy, 0));
  m.stay(put(m.mesh(new THREE.SphereGeometry(Rb, 5, 3, 0.45, 0.75, 0.55, 0.6), WHITE, { plain: true, door: true }), 0, cy, 0));
  var cut = Math.acos(clamp((low + 0.2 - cy) / Rb, -1, 1));
  m.stay(put(m.mesh(tor(Rb * Math.sin(cut), 0.09, null, 14), STEEL), 0, cy + Rb * Math.cos(cut), 0, HALF));
  m.top = Math.max(m.top, cy + Rb + 0.04); m.wide = Math.max(m.wide, Rb + 0.06);
});
item("ufo", "hat", function (m) {
  var y = m.peak() + 0.42, g = m.stay(m.group()), lights = [];
  put(m.mesh(cyl(0.2, 0.52, 0.1, 10), STEEL, { in: g }), 0, 0.05, 0);
  put(m.mesh(cyl(0.52, 0.24, 0.08, 10), "#7c8494", { in: g }), 0, -0.04, 0);
  put(m.mesh(ball(0.2), "#7ff0e0", { in: g, plain: true, door: true }), 0, 0.09, 0);
  put(m.mesh(ico(0.07), GREEN, { in: g }), 0, 0.15, 0);
  for (var i = 0; i < 5; i++) { var a = i * TAU / 5; lights.push(put(m.mesh(ico(0.055), YEL, { in: g, plain: true }), 0.4 * Math.sin(a), -0.01, 0.4 * Math.cos(a))); }
  var beam = put(m.mesh(cyl(0.1, 0.22, 0.18, 8, true), "#fff3a0", { in: g, plain: true, door: true }), 0, -0.17, 0);
  m.ticks.push(function (dt, t) {
    g.position.set(0.14 * Math.sin(t * 0.8), y + 0.04 * Math.sin(t * 2.1), 0.1 * Math.cos(t * 0.8));
    g.rotation.set(0.1 * Math.sin(t * 1.3), t * 1.4, 0.1 * Math.cos(t * 1.1));
    lights.forEach(function (l, i) { l.visible = Math.floor(t * 4 + i) % 3 !== 0; });
    beam.visible = Math.floor(t * 0.5) % 2 === 0;
  });
  g.position.y = y;
  m.top = Math.max(m.top, y + 0.34);
});
item("starcrown", "hat", function (m) {
  var y = m.peak() + 0.3, stars = [], g = m.stay(m.group());
  g.position.y = y; g.rotation.set(0.12, 0, 0.08);
  for (var i = 0; i < 6; i++) stars.push(m.mesh(new THREE.OctahedronGeometry(0.1), i % 2 ? "#fff3a0" : YEL, { in: g, plain: i % 2 === 1 }));
  m.ticks.push(function (dt, t) {
    stars.forEach(function (s, i) {
      var a = t * 1.1 + i * TAU / 6, k = 0.75 + 0.35 * Math.sin(t * 5 + i * 2.1);
      s.position.set(0.5 * Math.sin(a), 0.03 * Math.sin(t * 3 + i), 0.5 * Math.cos(a)); s.rotation.y = t * 3; s.scale.set(k, k * 1.3, k);
    });
  });
  m.ticks[m.ticks.length - 1](0, 0);
  m.top = Math.max(m.top, y + 0.3);
});

/* ================= over the eyes (20) ================= */
function lens(m, side) {
  var e = m.eye, rx = e.a + 0.075, ry = e.b + 0.075, cx = Math.max(e.x, rx + 0.012), g = m.group();
  g.position.copy(m.face(side * cx, e.y, 0.08));
  m.facing(g, side * cx, e.y, 0.5);
  return { g: g, rx: rx, ry: ry, cx: cx, s: side };
}
function bridge(m, color, up) {
  var e = m.eye, rx = e.a + 0.075, cx = Math.max(e.x, rx + 0.012), p = m.face(0, e.y + (up == null ? 0.02 : up), 0.1);
  return put(m.mesh(box(Math.max(0.1, 2 * (cx - rx) + 0.1), 0.06, 0.05), color), p.x, p.y, p.z);
}
function both(m, fn) { [-1, 1].forEach(function (s) { fn(lens(m, s)); }); }
// A strap round the head at the height of the eyes, leaving the front.
function strap(m, color, wide) { var a = Math.acos(clamp(m.eye.y, -1, 1)); m.shell(a - (wide || 0.05), a + (wide || 0.05), 0.045, color, { rows: 1, az0: 0.95, az1: TAU - 0.95, seg: 10 }); }
function frames(id, color, sq, t) {
  item(id, "glasses", function (m) {
    both(m, function (l) { m.mesh(sq ? square(t || 0.2) : tor(1, t || 0.2, null, 10), color, { in: l.g }).scale.set(l.rx * (sq ? 1.32 : 1), l.ry * (sq ? 1.25 : 1), l.rx); });
    bridge(m, color);
  });
}
frames("round", INK);
frames("wire", GOLD, false, 0.12);
frames("square", "#c8452f", true);
frames("thick", INK, true, 0.3);
item("halfmoon", "glasses", function (m) {
  both(m, function (l) { put(m.mesh(tor(1, 0.16, Math.PI, 8), GOLD, { in: l.g }), 0, -l.ry * 0.25, 0, 0, 0, Math.PI).scale.set(l.rx, l.ry * 0.8, l.rx); });
  bridge(m, GOLD, -0.08);
});
item("sleepmask", "glasses", function (m) {
  var e = m.eye, w = Math.max(e.x, e.a + 0.09) + e.a + 0.12, h = e.b + 0.07;
  m.patch(function (u, v) { var x = (u * 2 - 1) * w, k = 1 - 0.35 * Math.pow(Math.abs(u * 2 - 1), 3); return [x, e.y + (v * 2 - 1) * h * k, 0.06]; }, "#5b4bb5", { n: 6 });
  [-1, 1].forEach(function (s) { var g = m.onFace(s * Math.max(e.x, e.a + 0.09), e.y - 0.02, 0.08, 0.6); put(m.mesh(tor(0.09, 0.022, Math.PI, 5), "#cfc7ff", { in: g, plain: true }), 0, 0, 0, 0, 0, Math.PI); });
  strap(m, "#3f338a");
});
item("shades", "glasses", function (m) {
  both(m, function (l) {
    m.mesh(disc(1), "#14161b", { in: l.g, plain: true }).scale.set(l.rx * 1.15, l.ry, 1);
    put(m.mesh(new THREE.PlaneGeometry(0.5, 0.16), "#5d6678", { in: l.g, plain: true }), -0.07 * 1.15, l.ry * 0.3, 0.015, 0, 0, 0.7).scale.set(l.rx * 1.6, l.rx * 1.6, 1);
  });
  bridge(m, "#14161b");
});
item("eyepatch", "glasses", function (m) {
  var l = lens(m, 1);
  m.mesh(disc(1, 7), "#14161b", { in: l.g, plain: true }).scale.set(l.rx * 1.1, l.ry * 1.05, 1);
  strap(m, "#14161b", 0.035);
  var e = m.eye, p = m.face(0, e.y + 0.02, 0.07);
  put(m.mesh(box(Math.max(0.12, 2 * (l.cx - l.rx) + 0.3), 0.05, 0.03), "#14161b"), p.x - 0.1, p.y, p.z);
});
item("aviators", "glasses", function (m) {
  both(m, function (l) {
    m.mesh(disc(1, 7), "#6b4a2a", { in: l.g, plain: true, door: true }).scale.set(l.rx * 1.18, l.ry * 1.05, 1);
    m.mesh(tor(1, 0.1, null, 7), GOLD, { in: l.g }).scale.set(l.rx * 1.2, l.ry * 1.07, l.rx);
  });
  bridge(m, GOLD, 0.02); bridge(m, GOLD, 0.11);
});
item("monocle", "glasses", function (m) {
  var l = lens(m, 1);
  m.mesh(tor(1, 0.2, null, 10), GOLD, { in: l.g }).scale.set(l.rx, l.ry, l.rx);
  put(m.mesh(box(0.035, 0.5, 0.035), GOLD, { in: l.g }), l.rx * 0.85, -l.ry - 0.2, 0);
});
item("threed", "glasses", function (m) {
  both(m, function (l) {
    m.mesh(square(0.24), WHITE, { in: l.g }).scale.set(l.rx * 1.36, l.ry * 1.28, l.rx);
    put(m.mesh(new THREE.PlaneGeometry(1.8, 1.7), l.s < 0 ? "#ff3b4e" : "#27d3e6", { in: l.g, plain: true, door: true }), 0, 0, -0.01).scale.set(l.rx, l.ry, 1);
  });
  bridge(m, WHITE);
});
item("hearts", "glasses", function (m) {
  both(m, function (l) { var k = Math.max(l.rx, l.ry) * 1.15; m.mesh(heart(k), "#ff4d7e", { in: l.g, plain: true }); put(m.mesh(disc(k * 0.16, 5), "#ffc2d4", { in: l.g, plain: true }), -k * 0.45, k * 0.45, 0.012); });
  bridge(m, "#ff4d7e");
});
item("cateye", "glasses", function (m) {
  both(m, function (l) {
    m.mesh(square(0.2), TEAL, { in: l.g }).scale.set(l.rx * 1.32, l.ry * 1.15, l.rx);
    put(m.mesh(cone(0.07, 0.2), TEAL, { in: l.g }), l.s * l.rx * 1.05, l.ry * 0.95, 0, 0, 0, -l.s * 0.8);
  });
  bridge(m, TEAL);
});
item("shutter", "glasses", function (m) {
  both(m, function (l) {
    m.mesh(square(0.16), "#ff4fd8", { in: l.g }).scale.set(l.rx * 1.36, l.ry * 1.2, l.rx);
    for (var i = -1; i <= 1; i++) put(m.mesh(box(l.rx * 1.9, l.ry * 0.2, 0.03), "#ff4fd8", { in: l.g }), 0, i * l.ry * 0.5, 0);
  });
  bridge(m, "#ff4fd8");
});
function visor(id, color, holo) {
  item(id, "glasses", function (m) {
    var e = m.eye, p = m.face(0, e.y, 0.1), Rv = p.z, h = 2 * e.b + 0.14, a = 1.15;
    var glass = m.stay(put(m.mesh(cyl(Rv, Rv, h, 10, true, -a, 2 * a), color, { plain: true, door: true }), 0, p.y, 0));
    [-1, 1].forEach(function (s) { m.stay(put(m.mesh(cyl(Rv + 0.012, Rv + 0.012, 0.055, 10, true, -a, 2 * a), INK), 0, p.y + s * h / 2, 0)); });
    if (holo) m.ticks.push(function (dt, t) { glass.material.uniforms.uCol.value.setHSL((t * 0.25) % 1, 0.9, 0.62); });
  });
}
visor("visor", "#35d0c0");
item("stars", "glasses", function (m) {
  both(m, function (l) { var k = Math.max(l.rx, l.ry) * 1.3; m.mesh(star(k), YEL, { in: l.g, plain: true }); put(m.mesh(star(k * 0.55), "#fff3a0", { in: l.g, plain: true, door: true }), 0, 0, 0.012); });
  bridge(m, YEL);
});
item("pixel", "glasses", function (m) {
  var e = m.eye, cx = Math.max(e.x, e.a + 0.09), w = cx + e.a + 0.14, p = m.face(0, e.y, 0.11), u = 0.075, g = m.group();
  g.position.set(p.x, p.y, p.z);
  put(m.mesh(box(2 * w, u, 0.04), "#14161b", { in: g, plain: true }), 0, e.b * 0.6, 0);
  [-1, 1].forEach(function (s) {
    [[1, 0], [0.74, 1], [0.44, 2]].forEach(function (r) { put(m.mesh(box((e.a * 2 + 0.16) * r[0], u, 0.04), "#14161b", { in: g, plain: true }), s * cx, e.b * 0.6 - u * (r[1] + 1), 0); });
    put(m.mesh(box(u * 0.9, u * 0.9, 0.045), WHITE, { in: g, plain: true }), s * cx - e.a * 0.5, e.b * 0.6 - u, 0);
  });
});
item("goggles", "glasses", function (m) {
  strap(m, "#3a3f4f", 0.07);
  both(m, function (l) {
    m.mesh(disc(1, 8), "#7fe3ff", { in: l.g, plain: true, door: true }).scale.set(l.rx * 1.05, l.ry * 1.05, 1);
    m.mesh(tor(1, 0.3, null, 8), ORANGE, { in: l.g }).scale.set(l.rx * 1.12, l.ry * 1.12, l.rx * 1.4);
  });
  bridge(m, "#3a3f4f");
});
item("vr", "glasses", function (m) {
  var e = m.eye, w = 2 * (Math.max(e.x, e.a + 0.09) + e.a) + 0.2, h = 2 * e.b + 0.16, p = m.face(0, e.y, 0.03);
  strap(m, "#3a3f4f", 0.06);
  put(m.mesh(box(w, h, 0.3), WHITE), p.x, p.y, p.z + 0.15);
  put(m.mesh(box(w * 0.8, h * 0.55, 0.02), "#14161b", { plain: true }), p.x, p.y, p.z + 0.31);
  var led = put(m.mesh(box(0.05, 0.05, 0.02), GREEN, { plain: true }), p.x + w * 0.42, p.y + h * 0.36, p.z + 0.31);
  m.ticks.push(function (dt, t) { led.visible = t % 1.4 < 1; });
});
visor("holo", "#ff66cc", true);

/* ================= on the face (20) ================= */
function cheeks(m, fn) { var e = m.eye; [-1, 1].forEach(function (s) { fn(m.onFace(s * (e.x + e.a * 0.9), e.y - e.b - 0.06, 0.04, 1), s); }); }
function nose(m, out) { var e = m.eye; return m.face(0, e.y - e.b * 0.8, out == null ? 0.05 : out); }
item("blush", "face", function (m) { cheeks(m, function (g) { m.mesh(disc(0.1), ROSE, { in: g, plain: true }).scale.x = 1.35; }); });
item("freckles", "face", function (m) {
  cheeks(m, function (g) { [[-0.07, 0.03], [0.06, 0.04], [0, -0.04]].forEach(function (d) { put(m.mesh(disc(0.034, 4), "#8a5a34", { in: g, plain: true }), d[0], d[1], 0); }); });
});
item("nose", "face", function (m) { var p = nose(m, 0.1); put(m.mesh(ico(0.09), RED), p.x, p.y, p.z); });
function tache(id, color, curl) {
  item(id, "face", function (m) {
    var p = m.face(0, m.mouthY + 0.075, 0.06);
    [-1, 1].forEach(function (s) {
      put(m.mesh(cone(0.07, 0.3), color), p.x + s * 0.15, p.y - 0.01 + (curl ? 0.02 : 0), p.z, 0, 0, -s * (HALF + (curl ? -0.45 : 0.3))).scale.z = 0.6;
      if (curl) put(m.mesh(ico(0.045), color), p.x + s * 0.3, p.y + 0.09, p.z);
    });
  });
}
tache("moustache", "#4a3426");
item("bandage", "face", function (m) {
  var g = m.onFace(-0.4, 0.5, 0.04, 1);
  [-1, 1].forEach(function (s) { put(m.mesh(box(0.34, 0.11, 0.03), "#f1d9b5", { in: g, plain: true }), 0, 0, 0, 0, 0, s * Math.PI / 4); });
});
item("sweat", "face", function (m) {
  var e = m.eye, g = m.group(), p = m.face(0.6, e.y + e.b + 0.1, 0.09);
  g.position.copy(p);
  m.mesh(ico(0.075), SKY, { in: g });
  put(m.mesh(cone(0.06, 0.13, 5), SKY, { in: g }), 0, 0.09, 0);
  m.ticks.push(function (dt, t) { g.position.y = p.y - 0.05 * ((t * 0.5) % 1); });
});
item("starsticker", "face", function (m) { var e = m.eye, g = m.onFace(-(e.x + e.a * 0.9), e.y - e.b - 0.08, 0.04, 1); m.mesh(star(0.13), YEL, { in: g, plain: true }).rotation.z = 0.2; });
item("heartsticker", "face", function (m) { var e = m.eye, g = m.onFace(e.x + e.a * 0.9, e.y - e.b - 0.08, 0.04, 1); m.mesh(heart(0.1), "#ff4d7e", { in: g, plain: true }).rotation.z = -0.2; });
item("brows", "face", function (m) {
  var e = m.eye;
  [-1, 1].forEach(function (s) { var g = m.onFace(s * e.x, e.y + e.b + 0.09, 0.05, 0.9); m.mesh(box(e.a * 1.7, 0.075, 0.04), "#3a2a20", { in: g }).rotation.z = -s * 0.22; });
});
item("buckteeth", "face", function (m) {
  var g = m.onFace(0, m.mouthY - 0.055, 0.04, 0.8);
  [-1, 1].forEach(function (s) { put(m.mesh(box(0.06, 0.09, 0.03), WHITE, { in: g, plain: true }), s * 0.034, 0, 0); });
});
item("carrot", "face", function (m) { var p = nose(m, 0); put(m.mesh(cone(0.075, 0.42, 6), ORANGE, { soft: true }), p.x, p.y, p.z + 0.19, HALF); });
item("snout", "face", function (m) {
  var p = nose(m, 0.01);
  put(m.mesh(cyl(0.13, 0.14, 0.12, 8), ROSE, { soft: true }), p.x, p.y, p.z + 0.05, HALF).scale.x = 1.2;
  [-1, 1].forEach(function (s) { put(m.mesh(disc(0.035, 5), "#b8506a", { plain: true }), p.x + s * 0.06, p.y, p.z + 0.115); });
});
item("whiskers", "face", function (m) {
  var p = nose(m, 0.06), e = m.eye;
  put(m.mesh(ico(0.05), ROSE), p.x, p.y, p.z);
  [-1, 1].forEach(function (s) {
    var g = m.onFace(s * (e.x + e.a * 0.5), e.y - e.b - 0.07, 0.07, 1);
    [-1, 0, 1].forEach(function (k) { put(m.mesh(box(0.3, 0.03, 0.03), INK, { in: g, plain: true }), s * 0.13, k * 0.06, 0, 0, 0, s * k * 0.22); });
  });
});
tache("curly", "#2b2118", true);
item("fangs", "face", function (m) {
  [-1, 1].forEach(function (s) { var g = m.onFace(s * 0.075, m.mouthY - 0.05, 0.04, 0.8); m.mesh(cone(0.04, 0.13), WHITE, { in: g, plain: true }).rotation.z = Math.PI; });
});
item("lollipop", "face", function (m) {
  var p = m.face(0.04, m.mouthY, 0.05), g = m.group(), sweet = m.group(g);
  g.position.copy(p); g.rotation.z = -0.5;
  put(m.mesh(cyl(0.022, 0.022, 0.3, 4), WHITE, { in: g, soft: true }), 0.15, 0, 0.03, 0, 0, HALF);
  put(sweet, 0.36, 0, 0.05);
  put(m.mesh(cyl(0.14, 0.14, 0.05, 8), PINK, { in: sweet }), 0, 0, 0, HALF);
  put(m.mesh(disc(0.07, 6), WHITE, { in: sweet, plain: true }), 0, 0, 0.03);
  m.ticks.push(function (dt, t) { sweet.rotation.z = t * 1.5; });
});
function beard(id, color, long, wide) {
  item(id, "face", function (m) {
    var top = m.mouthY - 0.03, low = Math.max(top - long, m.lowY);
    m.patch(function (u, v) {
      var y = top + (low - top) * v, x = (u * 2 - 1) * wide * (1 - 0.55 * v * v);
      return [clamp(x, -0.9, 0.9) * Math.sqrt(Math.max(0.05, 1 - y * y)), y, 0.045 + 0.06 * Math.sin(Math.PI * Math.min(1, v * 1.1))];
    }, color, { n: 6 });
    if (wide > 0.6) { var p = m.face(0, m.mouthY + 0.075, 0.06); [-1, 1].forEach(function (s) { put(m.mesh(cone(0.075, 0.32), color), p.x + s * 0.16, p.y, p.z, 0, 0, -s * (HALF + 0.3)).scale.z = 0.6; }); }
  });
}
beard("beard", "#6b4a2e", 0.36, 0.5);
item("bubblegum", "face", function (m) {
  var p = m.face(0, m.mouthY, 0.02), b = m.mesh(ico(1), "#ff8fd0", { soft: true });
  m.ticks.push(function (dt, t) { var k = (t * 0.45) % 1, r = k < 0.85 ? 0.05 + 0.2 * k : 0.02; b.scale.set(r, r, r); b.position.set(p.x, p.y, p.z + r * 0.9); });
  m.ticks[m.ticks.length - 1](0, 1.3);
});
item("blower", "face", function (m) {
  var p = m.face(0.02, m.mouthY, 0.04), g = m.group(), tube = m.mesh(cyl(0.05, 0.04, 1, 5), YEL, { in: g, soft: true }), tip = m.mesh(ico(0.08), PINK, { in: g });
  g.position.copy(p); g.rotation.set(0, -0.45, -HALF - 0.12);
  m.ticks.push(function (dt, t) {
    var k = 0.14 + 0.42 * Math.pow(Math.max(0, Math.sin(t * 2.2)), 0.6);
    tube.scale.y = k; tube.position.y = k / 2; tip.position.y = k;
  });
  m.ticks[m.ticks.length - 1](0, 0.7);
});
beard("bigbeard", "#f1ede2", 0.62, 0.85);

/* ================= round the neck (19) ================= */
function bowtie(id, c1, c2) {
  item(id, "neck", function (m) {
    var g = m.onFace(0, Math.max(m.mouthY - 0.2, -0.62), 0.07, 0.6);
    [-1, 1].forEach(function (s) { put(m.mesh(cone(0.14, 0.24), c1, { in: g }), s * 0.14, 0, 0, 0, 0, s * HALF).scale.z = 0.6; });
    m.mesh(box(0.09, 0.11, 0.09), c2, { in: g });
  });
}
function scarf(id, c1, c2) {
  item(id, "neck", function (m) {
    if (c2) for (var i = 0; i < 8; i++) m.band(i % 2 ? c2 : c1, 0.12, 0.12, { az0: i * TAU / 8, az1: (i + 1) * TAU / 8, seg: 2 });
    else m.band(c1, 0.12, 0.12);
    var p = m.face(0.3, m.neckY - 0.02, 0.13);
    put(m.mesh(box(0.2, 0.3, 0.08), c1), p.x, p.y - 0.16, p.z + 0.02, 0, 0, -0.14);
    put(m.mesh(box(0.2, 0.06, 0.085), c2 || WHITE), p.x + 0.02, p.y - 0.27, p.z + 0.02, 0, 0, -0.14);
  });
}
bowtie("bowtie", RED, "#b02a37");
bowtie("bowtie2", TEAL, WHITE);
scarf("scarf", TEAL);
item("necktie", "neck", function (m) {
  var g = m.chin(0);
  m.band(WHITE, 0.05, 0.045, { rows: 1 });
  m.mesh(box(0.11, 0.09, 0.07), BLUE, { in: g });
  put(m.mesh(cyl(0.05, 0.1, 0.34, 4), BLUE, { in: g }), 0, -0.2, 0.02, 0, Math.PI / 4).scale.z = 0.4;
});
item("bandana", "neck", function (m) {
  var g = m.chin(0.04, 0.07);
  m.band(RED, 0.08, 0.06);
  put(m.mesh(cone(0.26, 0.34, 3), RED, { in: g }), 0, -0.12, 0.03, 0, 0, Math.PI).scale.z = 0.25;
  [[-0.08, -0.06], [0.07, -0.1], [0, -0.2]].forEach(function (d) { put(m.mesh(disc(0.03, 4), WHITE, { in: g, plain: true }), d[0], d[1], 0.075); });
});
item("bib", "neck", function (m) {
  var top = m.neckY + 0.07, low = Math.max(top - 0.42, m.lowY);
  m.band(WHITE, 0.04, 0.04, { rows: 1 });
  m.patch(function (u, v) { var y = top + (low - top) * v; return [(u * 2 - 1) * 0.36 * (1 - 0.3 * v * v) * Math.sqrt(Math.max(0.05, 1 - y * y)), y, 0.05]; }, WHITE, { n: 5 });
  var g = m.onFace(0, (top + low) / 2, 0.065, 1);
  m.mesh(heart(0.07), "#ff4d7e", { in: g, plain: true });
});
item("badge", "neck", function (m) {
  var g = m.chin(0.2, 0.1);
  m.band(TEAL, 0.035, 0.04, { rows: 1 });
  put(m.mesh(box(0.03, 0.2, 0.02), TEAL, { in: g }), 0, 0.14, 0);
  m.mesh(box(0.22, 0.27, 0.03), WHITE, { in: g });
  put(m.mesh(box(0.1, 0.1, 0.02), STEEL, { in: g, plain: true }), 0, 0.04, 0.02);
  put(m.mesh(box(0.14, 0.03, 0.02), INK, { in: g, plain: true }), 0, -0.07, 0.02);
});
item("whistle", "neck", function (m) {
  var g = m.chin(0.14, 0.1);
  m.band(INK, 0.03, 0.035, { rows: 1 });
  put(m.mesh(box(0.025, 0.14, 0.02), INK, { in: g }), 0, 0.08, 0);
  put(m.mesh(cyl(0.065, 0.065, 0.08, 8), YEL, { in: g }), -0.03, 0, 0, HALF);
  put(m.mesh(box(0.14, 0.05, 0.07), YEL, { in: g }), 0.06, 0.03, 0);
});
item("key", "neck", function (m) {
  var g = m.chin(0.13, 0.1);
  m.band("#8a5a34", 0.025, 0.03, { rows: 1 });
  put(m.mesh(box(0.025, 0.12, 0.02), "#8a5a34", { in: g }), 0, 0.09, 0);
  m.mesh(tor(0.06, 0.028, null, 6), GOLD, { in: g });
  put(m.mesh(box(0.04, 0.2, 0.03), GOLD, { in: g }), 0, -0.15, 0);
  put(m.mesh(box(0.08, 0.04, 0.03), GOLD, { in: g }), 0.04, -0.22, 0);
});
function collar(id, color, bell) {
  item(id, "neck", function (m) {
    var g = m.chin(0.1, 0.1);
    m.band(color, 0.06, 0.06, { rows: 1 });
    if (bell) { m.mesh(ico(0.11), GOLD, { in: g }); put(m.mesh(box(0.1, 0.025, 0.03), "#8a6a10", { in: g, plain: true }), 0, -0.04, 0.09); }
    else put(m.mesh(cyl(0.085, 0.085, 0.03, 8), GOLD, { in: g }), 0, 0.01, 0, HALF);
  });
}
collar("collar", RED);
scarf("stripyscarf", RED, WHITE);
collar("bell", BLUE, true);
function beads(id, n, size, colors, flat) {
  item(id, "neck", function (m) {
    m.around(m.neck, n, size * 0.9, function (p, i) { var b = put(m.mesh(ico(size), colors[i % colors.length]), p.x, p.y, p.z); if (flat) b.scale.y = 0.6; });
  });
}
beads("pearls", 16, 0.07, ["#f7f3ea"]);
item("medal", "neck", function (m) {
  var g = m.chin(0.22, 0.1);
  m.band(BLUE, 0.04, 0.045, { rows: 1 });
  put(m.mesh(box(0.09, 0.2, 0.025), BLUE, { in: g }), 0, 0.13, 0);
  put(m.mesh(box(0.03, 0.2, 0.03), WHITE, { in: g, plain: true }), 0, 0.13, 0.005);
  put(m.mesh(cyl(0.11, 0.11, 0.035, 8), GOLD, { in: g }), 0, 0, 0, HALF);
  put(m.mesh(star(0.06), "#fff3a0", { in: g, plain: true }), 0, 0, 0.025);
});
beads("lei", 12, 0.115, [PINK, YEL, WHITE, ORANGE], true);
item("cape", "neck", function (m) {
  m.band(GOLD, 0.045, 0.05, { rows: 1 });
  m.shell(m.neck - 0.06, Math.min(m.neck + 1.25, Math.acos(m.lowY)), function (t) { return 0.05 + 0.38 * t * t; }, RED, { rows: 5, az0: HALF + 0.15, az1: TAU - HALF - 0.15, seg: 8 });
  var g = m.chin(0, 0.09);
  m.mesh(ico(0.07), GOLD, { in: g });
  m.wide = Math.max(m.wide, m.girth(1.8, 2.6) + 0.42);
});
item("chain", "neck", function (m) {
  m.around(m.neck, 18, 0.06, function (p) { put(m.mesh(ico(0.055), GOLD), p.x, p.y, p.z); });
  var g = m.chin(0.17, 0.1);
  put(m.mesh(cyl(0.13, 0.13, 0.04, 8), GOLD, { in: g }), 0, 0, 0, HALF);
  put(m.mesh(star(0.075), "#fff3a0", { in: g, plain: true }), 0, 0, 0.03);
});
item("float", "neck", function (m) {
  var a = Math.min(m.neck + 0.25, 2.3), t = 0.17, Rf = m.girth(a - 0.3, a + 0.3) + t + m.slack, y = m.at(a, 0).y;
  for (var i = 0; i < 8; i++) m.stay(put(m.mesh(tor(Rf, t, TAU / 8, 2), i % 2 ? WHITE : RED), 0, y, 0, HALF, 0, i * TAU / 8));
  m.wide = Math.max(m.wide, Rf + t);
});
item("hoop", "neck", function (m) {
  var Rh = m.girth(1.1, 2.3) + 0.22, y = m.face(0, Math.max(-0.45, m.lowY + 0.2), 0).y, hoop = m.stay(put(m.mesh(tor(Rh, 0.045, null, 18), PINK), 0, y, 0, HALF));
  m.ticks.push(function (dt, t) {
    hoop.rotation.set(HALF + 0.11 * Math.sin(t * 4.5), 0.11 * Math.cos(t * 4.5), 0);
    hoop.position.y = y + 0.05 * Math.sin(t * 2.2);
    hoop.material.uniforms.uCol.value.setHSL((t * 0.2) % 1, 0.85, 0.62);
  });
  m.wide = Math.max(m.wide, Rh + 0.08);
});

/* ================= the second hundred =================
   Forty more for the head, and twenty more each for the eyes, the face and the neck. They are
   made and fitted the same ways as the first. */

// Something that stands on the very top of its head: a frame just clear of the skin there.
function topper(m) {
  m.bare();
  var g = m.group(), p = m.surf(0, 1, 0);
  g.position.set(p.x, p.y + 0.015, p.z);
  return g;
}
// A flat piece of a ring, lying level: from `r0` out to `r1`, `arc` wide, centred on the front.
function brim(r0, r1, arc, seg) { var g = new THREE.RingGeometry(r0, r1, seg || 6, 1, HALF - arc / 2, arc); g.rotateX(HALF); return g; }
// A cone that stands on its base, to be grown and swayed from there: a flame, a tentacle.
function spike(r, h, seg) { var g = cone(r, h, seg || 5); g.translate(0, h / 2, 0); return g; }

/* ----------------- on the head (40) ----------------- */
item("flatcap", "hat", function (m) {
  var a = m.capTo(0.78), p = m.at(a - 0.04, 0, 0.09);
  m.shell(0, a, function (t, u) { return 0.07 + 0.1 * Math.sin(Math.PI * t) * (0.5 + 0.5 * Math.cos(TAU * u)); }, "#7d7466", { rows: 4 });
  put(m.mesh(box(0.5, 0.045, 0.2), "#5f574b"), p.x, p.y - 0.01, p.z + 0.11, 0.3);
});
item("kerchief", "hat", function (m) {
  var a = m.capTo(0.9), k = m.group();
  m.shell(0, a, 0.07, "#e8556d", { rows: 3 });
  m.around(a * 0.55, 6, 0.08, function (p) { put(m.mesh(ico(0.05), WHITE), p.x, p.y, p.z); }, 0.5);
  k.position.copy(m.at(a, Math.PI, 0.12));
  [-1, 1].forEach(function (s) { put(m.mesh(cone(0.09, 0.26), "#e8556d", { in: k }), s * 0.1, -0.1, -0.04, 0, 0, Math.PI + s * 0.6).scale.z = 0.5; });
  m.mesh(ico(0.07), "#c93d55", { in: k });
});
item("nightcap", "hat", function (m) {
  var a = m.capTo(0.8), g = m.stay(m.group());
  m.shell(0, a, 0.075, "#6f8fd8");
  m.shell(a - 0.1, a + 0.03, puff(0.03, 0.11), WHITE, { rows: 2 });
  g.position.copy(m.at(0.22, HALF, 0.06));
  put(m.mesh(cyl(0.05, 0.2, 0.5, 6), "#6f8fd8", { in: g, soft: true }), 0.17, 0.03, 0, 0, 0, -1.9);
  var bob = put(m.mesh(ico(0.09), WHITE, { in: g, soft: true }), 0.43, -0.08, 0);
  m.ticks.push(function (dt, t) { bob.position.y = -0.08 + 0.02 * Math.sin(t * 2.4); });
});
item("tennisvisor", "hat", function (m) {
  var a = Math.min(0.8, m.brow), p = m.at(a - 0.03, 0, 0.08), g = m.group();
  m.shell(a - 0.2, a, puff(0.04, 0.09), WHITE, { rows: 2 });
  g.position.copy(p); g.rotation.x = 0.5;
  put(m.mesh(brim(p.z, p.z + 0.3, 1.6), TEAL, { in: g }), 0, 0, -p.z);
});
item("leaf", "hat", function (m) {
  var g = topper(m);
  put(m.mesh(cyl(0.03, 0.03, 0.2, 4), "#4faa3c", { in: g, soft: true }), 0, 0.04, 0);
  put(m.mesh(ico(0.2), GREEN, { in: g }), 0.15, 0.27, 0, 0, 0, -0.6).scale.set(0.55, 1.3, 0.3);
  m.ticks.push(function (dt, t) { g.rotation.z = 0.1 * Math.sin(t * 1.4); });
  m.top = Math.max(m.top, g.position.y + 0.52);
});
item("acorn", "hat", function (m) {
  var a = m.capTo(0.9), p = m.at(0, 0, 0.1);
  m.shell(0, a, function (t) { return 0.07 + 0.05 * t; }, "#8a5a34", { rows: 4, zig: 0.05 });
  put(m.mesh(cyl(0.035, 0.05, 0.2, 5), "#5a3a20", { soft: true }), p.x + 0.02, p.y + 0.07, p.z, 0, 0, -0.2);
  m.top = Math.max(m.top, p.y + 0.2);
});
item("saucepan", "hat", function (m) {
  var h = m.hat({ r: 0.42, R: 0.46, dome: 0.4, tall: 0.44, tilt: -0.1, liner: "#6f7682" });
  m.mesh(lathe([[0.46, 0], [0.44, 0.42], [0, 0.42]], 10), STEEL, { in: h });
  put(m.mesh(box(0.42, 0.05, 0.09), INK, { in: h }), 0.66, 0.3, 0);
});
item("sailor", "hat", function (m) {
  var h = m.hat({ r: 0.36, R: 0.5, dome: 0.26, tall: 0.3, tilt: 0.14, liner: "#cfcabb" });
  m.mesh(lathe([[0.38, 0], [0.5, 0.17], [0.38, 0.12], [0.36, 0.28], [0, 0.3]], 10), WHITE, { in: h });
  put(m.mesh(cyl(0.385, 0.385, 0.05, 10, true), BLUE, { in: h }), 0, 0.21, 0);
});
item("earmuffs", "hat", function (m) {
  m.clear(1, true);
  arch(m, STEEL, 0.05);
  [-1, 1].forEach(function (s) {
    var c = m.surf(s, 0.12, 0, 0.12);
    put(m.mesh(ico(0.26), "#ff9ec4"), c.x + s * 0.1, c.y, c.z).scale.x = 0.6;
    m.wide = Math.max(m.wide, Math.abs(c.x) + 0.3);
  });
});
item("cherry", "hat", function (m) {
  var g = topper(m);
  put(m.mesh(ico(0.17), "#d81e3a", { in: g }), 0, 0.17, 0);
  put(m.mesh(cyl(0.028, 0.028, 0.26, 4), "#4faa3c", { in: g, soft: true }), 0.04, 0.42, 0, 0, 0, -0.3);
  put(m.mesh(ico(0.08), GREEN, { in: g }), 0.15, 0.52, 0).scale.set(1.4, 0.4, 0.8);
  m.top = Math.max(m.top, g.position.y + 0.6);
});
item("candle", "hat", function (m) {
  var g = topper(m), flame = put(m.mesh(ico(0.07), "#ffb92e", { in: g, plain: true }), 0, 0.47, 0);
  put(m.mesh(cyl(0.06, 0.06, 0.34, 6), SKY, { in: g }), 0, 0.17, 0);
  put(m.mesh(cyl(0.065, 0.065, 0.05, 6, true), WHITE, { in: g }), 0, 0.14, 0);
  put(m.mesh(cyl(0.02, 0.02, 0.07, 3), INK, { in: g }), 0, 0.37, 0);
  m.ticks.push(function (dt, t) { var k = 1 + 0.2 * Math.sin(t * 13) * Math.sin(t * 7.3); flame.scale.set(0.8, 1.5 * k, 0.8); flame.position.x = 0.012 * Math.sin(t * 9); });
  m.ticks[m.ticks.length - 1](0, 0);
  m.top = Math.max(m.top, g.position.y + 0.62);
});
item("feather", "hat", function (m) {
  var a = m.brow - 0.06, g = m.stay(m.group());
  m.shell(a - 0.13, a, 0.06, "#b5651d", { rows: 1 });
  g.position.copy(m.at(a - 0.1, 1.9, 0.06)); g.rotation.z = -0.25;
  put(m.mesh(ico(0.2), RED, { in: g, soft: true }), 0, 0.34, 0).scale.set(0.5, 1.6, 0.2);
  put(m.mesh(cyl(0.025, 0.025, 0.56, 3), WHITE, { in: g, soft: true }), 0, 0.26, 0.045);
  m.top = Math.max(m.top, g.position.y + 0.7);
});
item("buns", "hat", function (m) {
  pair(m, 0.55, function (g, s) {
    g.rotation.z = -s * 0.5;
    put(m.mesh(ico(0.2), "#6b4a2e", { in: g, soft: true }), 0, 0.14, 0);
    put(m.mesh(tor(0.11, 0.035, null, 6), PINK, { in: g, soft: true }), 0, 0.02, 0, HALF);
  });
});
item("bearears", "hat", function (m) {
  pair(m, 0.62, function (g, s) {
    g.rotation.z = -s * 0.5;
    put(m.mesh(cyl(0.2, 0.2, 0.09, 8), "#9c6b43", { in: g, soft: true }), 0, 0.12, 0, HALF);
    put(m.mesh(cyl(0.11, 0.11, 0.1, 8), "#e8c49a", { in: g, soft: true }), 0, 0.11, 0.01, HALF);
  });
});
item("boppers", "hat", function (m) {
  m.clear(1, true);
  arch(m, PINK, 0.045);
  [-1, 1].forEach(function (s) {
    var g = m.stay(m.group());
    g.position.copy(m.at(0.4, s * HALF, 0.1));
    put(m.mesh(cyl(0.025, 0.025, 0.36, 3), STEEL, { in: g, soft: true }), 0, 0.18, 0);
    put(m.mesh(ico(0.09), s < 0 ? YEL : TEAL, { in: g }), 0, 0.4, 0);
    m.ticks.push(function (dt, t) { g.rotation.z = -s * 0.3 + 0.2 * Math.sin(t * 5 + s); });
    m.ticks[m.ticks.length - 1](0, 0);
    m.top = Math.max(m.top, g.position.y + 0.5);
  });
});
item("ricehat", "hat", function (m) {
  var h = m.hat({ r: 0.8, R: 0.84, dome: 0.36, cone: true, tall: 0.4, tilt: 0.06 });
  m.mesh(lathe([[0.84, 0], [0.02, 0.4], [0, 0.4]], 10), "#e3c97f", { in: h });
  m.mesh(lathe([[0.85, 0], [0.62, 0.115]], 10), "#c9a955", { in: h });
});
item("ushanka", "hat", function (m) {
  var a = m.capTo(0.84);
  m.shell(0, a, 0.085, "#6b4a2e");
  m.shell(a - 0.2, a, puff(0.1, 0.15), "#a98b6d", { rows: 2, az0: -0.9, az1: 0.9, seg: 5 });
  [-1, 1].forEach(function (s) { m.shell(a - 0.05, a + 0.6, puff(0.07, 0.13), "#a98b6d", { rows: 3, az0: s * HALF - 0.45, az1: s * HALF + 0.45, seg: 3 }); });
});
item("flowerpot", "hat", function (m) {
  var h = m.hat({ r: 0.4, R: 0.46, cav: function (rho) { return rho < 0.26 ? 0.42 : 0.42 * (0.4 - rho) / 0.14; }, tall: 0.9, tilt: -0.12, liner: "#8f4a2a" }), f = m.group(h);
  m.mesh(lathe([[0.46, 0], [0.46, 0.1], [0.42, 0.1], [0.29, 0.46], [0, 0.46]], 8), "#c8693f", { in: h });
  put(m.mesh(cyl(0.02, 0.02, 0.26, 4), "#4faa3c", { in: h }), 0, 0.59, 0);
  put(f, 0, 0.74, 0.02, 0.2);
  for (var i = 0; i < 5; i++) { var a = i * TAU / 5; put(m.mesh(ico(0.08), PINK, { in: f }), 0.11 * Math.cos(a), 0.11 * Math.sin(a), 0).scale.z = 0.4; }
  m.mesh(ico(0.07), YEL, { in: f }).position.z = 0.03;
  m.ticks.push(function (dt, t) { f.rotation.z = 0.15 * Math.sin(t * 1.3); });
});
item("teacup", "hat", function (m) {
  var h = m.hat({ R: 0.4, tall: 0.6, tilt: 0.1 }), steam = [];
  put(m.mesh(cyl(0.4, 0.3, 0.05, 10), WHITE, { in: h }), 0, 0.045, 0);
  put(m.mesh(cyl(0.26, 0.17, 0.27, 10), WHITE, { in: h }), 0, 0.205, 0);
  put(m.mesh(cyl(0.215, 0.215, 0.02, 10), "#a8632b", { in: h, plain: true }), 0, 0.335, 0);
  put(m.mesh(cyl(0.265, 0.26, 0.04, 10, true), TEAL, { in: h }), 0, 0.3, 0);
  put(m.mesh(tor(0.09, 0.03, Math.PI, 5), WHITE, { in: h }), 0.24, 0.2, 0, 0, 0, -HALF);
  for (var i = 0; i < 2; i++) steam.push(m.mesh(box(0.04, 0.1, 0.04), WHITE, { in: h, plain: true, door: true }));
  m.ticks.push(function (dt, t) {
    steam.forEach(function (s, i) { var k = (t * 0.6 + i * 0.5) % 1; s.position.set(i * 0.12 - 0.06 + 0.03 * Math.sin(t * 3 + i), 0.42 + 0.2 * k, 0); s.visible = k < 0.85; });
  });
  m.ticks[m.ticks.length - 1](0, 0.3);
});
item("pirate", "hat", function (m) {
  var h = m.hat({ r: 0.4, R: 0.5, dome: 0.3, tall: 0.56, liner: "#14161b" }), k = m.group(h);
  m.mesh(lathe([[0.44, 0], [0.4, 0.3], [0, 0.34]], 10), "#23262e", { in: h });
  [1, -1].forEach(function (s) { put(m.mesh(poly([[-1, 0], [-0.78, 0.4], [-0.3, 0.62], [0, 0.72], [0.3, 0.62], [0.78, 0.4], [1, 0]], 0.72), "#2f3340", { in: h }), 0, 0.02, s * 0.45, -s * 0.12); });
  put(k, 0, 0.27, 0.44);
  [-1, 1].forEach(function (s) { put(m.mesh(box(0.34, 0.045, 0.01), WHITE, { in: k, plain: true }), 0, -0.03, 0, 0, 0, s * 0.6); });
  put(m.mesh(disc(0.09, 7), WHITE, { in: k, plain: true }), 0, 0.03, 0.012);
  [-1, 1].forEach(function (s) { put(m.mesh(disc(0.025, 4), INK, { in: k, plain: true }), s * 0.036, 0.035, 0.024); });
});
item("sombrero", "hat", function (m) {
  var h = m.hat({ r: 0.32, R: 0.9, cav: function (rho) { return rho < 0.14 ? 0.5 : 0.5 * (0.32 - rho) / 0.18; }, tall: 0.56, tilt: -0.08, liner: "#b08a3c" });
  m.mesh(lathe([[0.36, 0], [0.74, 0], [0.9, 0.14]], 12), "#e3b95a", { in: h });
  m.mesh(lathe([[0.36, 0], [0.2, 0.5], [0, 0.54]], 10), "#e3b95a", { in: h });
  put(m.mesh(cyl(0.335, 0.365, 0.08, 10, true), RED, { in: h }), 0, 0.05, 0);
  put(m.mesh(cyl(0.255, 0.285, 0.06, 10, true), GREEN, { in: h }), 0, 0.28, 0);
  put(m.mesh(tor(0.9, 0.03, null, 12), RED, { in: h }), 0, 0.14, 0, HALF);
});
item("firehelmet", "hat", function (m) {
  var a = m.capTo(0.84), g;
  m.shell(0, a, 0.09, RED);
  m.shell(a - 0.06, a + 0.05, puff(0.08, 0.2), "#b02a37", { rows: 2 });
  m.shell(a - 0.05, a + 0.24, function (t) { return 0.1 + 0.25 * t; }, "#b02a37", { rows: 2, az0: Math.PI - 0.9, az1: Math.PI + 0.9, seg: 5 });
  g = m.onFace(0, Math.cos(a * 0.6), 0.115, 0.9);
  m.mesh(poly([[0, 1], [0.8, 0.5], [0.6, -0.8], [0, -1], [-0.6, -0.8], [-0.8, 0.5]], 0.14), GOLD, { in: g, plain: true });
});
item("pumpkin", "hat", function (m) {
  var a = m.capTo(0.9), p = m.at(0, 0, 0.1);
  for (var i = 0; i < 8; i++) m.shell(0, a, function (t, u) { return 0.06 + 0.08 * Math.sin(Math.PI * u) * Math.min(1, t * 3); }, i % 2 ? "#f08a1c" : ORANGE, { az0: i * TAU / 8, az1: (i + 1) * TAU / 8, seg: 2, rows: 3 });
  put(m.mesh(cyl(0.04, 0.07, 0.22, 5), "#4f7a2a", { soft: true }), p.x, p.y + 0.06, p.z, 0, 0, 0.25);
  m.top = Math.max(m.top, p.y + 0.22);
});
item("antlers", "hat", function (m) {
  pair(m, 0.5, function (g, s) {
    g.rotation.z = -s * 0.35;
    put(m.mesh(cyl(0.035, 0.05, 0.5, 5), "#a9794a", { in: g, soft: true }), 0, 0.22, 0);
    put(m.mesh(cyl(0.025, 0.035, 0.24, 4), "#a9794a", { in: g, soft: true }), s * 0.09, 0.3, 0, 0, 0, -s * 0.9);
    put(m.mesh(cyl(0.025, 0.035, 0.2, 4), "#a9794a", { in: g, soft: true }), -s * 0.07, 0.42, 0, 0, 0, s * 0.8);
  });
});
item("mohawk", "hat", function (m) {
  m.bare();
  var from = Math.min(0.72, m.brow - 0.25);
  for (var i = 0; i < 6; i++) {
    var t = from - i * 0.33, g = m.stay(m.group());
    g.position.copy(m.surf(0, Math.cos(t), Math.sin(t), -0.02)); g.rotation.x = t;
    put(m.mesh(cone(0.15, 0.5 - 0.06 * Math.abs(i - 2)), i % 2 ? "#ff4fd8" : PINK, { in: g, soft: true }), 0, 0.2, 0, 0, 0, (i % 2 ? 1 : -1) * 0.22).scale.x = 0.85;
  }
  m.top = Math.max(m.top, m.surf(0, 1, 0).y + 0.5);
});
item("pineapple", "hat", function (m) {
  var g = topper(m);
  for (var i = 0; i < 7; i++) { var a = i * TAU / 7, k = i % 2 ? 0.55 : 0.34; put(m.mesh(cone(0.1, 0.52, 4), i % 2 ? "#4faa3c" : GREEN, { in: g, soft: true }), 0.11 * Math.sin(a), 0.2, 0.11 * Math.cos(a), k * Math.cos(a), 0, -k * Math.sin(a)); }
  put(m.mesh(cone(0.1, 0.6), GREEN, { in: g, soft: true }), 0, 0.29, 0);
  m.top = Math.max(m.top, g.position.y + 0.6);
});
item("clover", "hat", function (m) {
  var g = topper(m), f = m.group(g);
  put(m.mesh(cyl(0.025, 0.025, 0.36, 4), "#3f8f3a", { in: g, soft: true }), 0, 0.12, 0);
  put(f, 0, 0.38, 0.02, 0.3);
  for (var i = 0; i < 4; i++) { var a = i * HALF + Math.PI / 4; put(m.mesh(heart(0.1), "#43b04a", { in: f }), 0.11 * Math.cos(a), 0.11 * Math.sin(a), 0, 0, 0, a - HALF); }
  m.ticks.push(function (dt, t) { g.rotation.z = 0.1 * Math.sin(t * 1.5); });
  m.top = Math.max(m.top, g.position.y + 0.62);
});
item("foil", "hat", function (m) {
  var h = m.hat({ r: 0.36, R: 0.44, dome: 0.5, cone: true, tall: 0.62, tilt: 0.12, liner: "#7c8494" });
  m.mesh(lathe([[0.45, 0], [0.31, 0.2], [0.25, 0.24], [0.1, 0.5], [0.07, 0.6], [0, 0.56]], 6), "#cfd6df", { in: h });
});
item("jester", "hat", function (m) {
  var a = m.capTo(0.8);
  m.shell(0, a, 0.075, RED, { az0: 0, az1: Math.PI, seg: 8 });
  m.shell(0, a, 0.075, PURPLE, { az0: Math.PI, az1: TAU, seg: 8 });
  m.shell(a - 0.06, a + 0.04, 0.09, GOLD, { rows: 1, zig: 0.07 });
  [-1, 1].forEach(function (s) {
    var g = m.stay(m.group());
    g.position.copy(m.at(0.45, s * HALF, 0.02));
    put(m.mesh(cyl(0.04, 0.2, 0.46, 6), s > 0 ? RED : PURPLE, { in: g, soft: true }), 0, 0.2, 0);
    put(m.mesh(ico(0.075), GOLD, { in: g }), 0, 0.46, 0);
    m.ticks.push(function (dt, t) { g.rotation.z = -s * (0.75 + 0.1 * Math.sin(t * 3 + s)); });
    m.ticks[m.ticks.length - 1](0, 0);
    m.top = Math.max(m.top, g.position.y + 0.42); m.wide = Math.max(m.wide, Math.abs(g.position.x) + 0.45);
  });
});
item("unicorn", "hat", function (m) {
  m.bare();
  var g = m.stay(m.group()), t = Math.min(0.45, m.brow - 0.3);
  g.position.copy(m.at(t, 0, -0.02)); g.rotation.x = t * 0.8;
  for (var i = 0; i < 4; i++) put(m.mesh(cyl(0.095 - i * 0.022, 0.11 - i * 0.022, 0.13, 6), i % 2 ? "#fff3a0" : GOLD, { in: g, soft: true }), 0, 0.05 + i * 0.12, 0);
  put(m.mesh(cone(0.03, 0.14, 6), "#fff3a0", { in: g, soft: true }), 0, 0.54, 0);
  m.top = Math.max(m.top, g.position.y + 0.62);
});
item("cake", "hat", function (m) {
  var h = m.hat({ R: 0.42, tall: 0.64, tilt: -0.08 }), flames = [], i;
  put(m.mesh(cyl(0.4, 0.4, 0.26, 10), "#e8b877", { in: h }), 0, 0.15, 0);
  put(m.mesh(cyl(0.42, 0.42, 0.09, 10), "#ff9ec4", { in: h }), 0, 0.3, 0);
  for (i = 0; i < 5; i++) { var a = i * TAU / 5 + 0.3; put(m.mesh(ico(0.075), "#ff9ec4", { in: h }), 0.4 * Math.sin(a), 0.23, 0.4 * Math.cos(a)).scale.y = 1.3; }
  for (i = 0; i < 3; i++) {
    var x = (i - 1) * 0.19, z = i === 1 ? 0.1 : 0;
    put(m.mesh(cyl(0.03, 0.03, 0.16, 4), i % 2 ? YEL : SKY, { in: h }), x, 0.42, z);
    flames.push(put(m.mesh(ico(0.045), "#ffb92e", { in: h, plain: true }), x, 0.55, z));
  }
  m.ticks.push(function (dt, t) { flames.forEach(function (f, n) { f.scale.set(0.8, 1.4 * (1 + 0.25 * Math.sin(t * 12 + n * 2)), 0.8); }); });
  m.ticks[m.ticks.length - 1](0, 0);
});
item("tiara", "hat", function (m) {
  var a = Math.min(0.8, m.brow - 0.1);
  m.shell(a - 0.08, a, 0.05, "#dfe6ee", { rows: 1, az0: -1.2, az1: 1.2, seg: 8 });
  [-2, -1, 0, 1, 2].forEach(function (i) {
    var az = i * 0.42, k = 1 - Math.abs(i) * 0.28, g = m.group();
    g.position.copy(m.at(a - 0.08, az, 0.075));
    g.quaternion.setFromUnitVectors(UP, new THREE.Vector3().fromArray(dir(a, az)).lerp(UP, 0.6).normalize());
    put(m.mesh(cone(0.085, 0.34 * k), "#dfe6ee", { in: g }), 0, 0.17 * k, 0);
    put(m.mesh(ico(0.055), i ? SKY : PINK, { in: g, plain: true }), 0, 0.06, 0.065);
    m.top = Math.max(m.top, g.position.y + 0.36);
  });
});
item("laurel", "hat", function (m) {
  var a = Math.min(0.8, m.brow - 0.08);
  m.around(a, 12, 0.13, function (p, i, az) {
    if (i === 0) return;
    var s = az > Math.PI ? -1 : 1, l = put(m.mesh(ico(0.17), i % 2 ? GOLD : "#d9a81e"), p.x, p.y + 0.04, p.z);
    l.quaternion.setFromUnitVectors(UP, new THREE.Vector3(-s * Math.cos(az), 0.9, s * Math.sin(az)).normalize());
    l.scale.set(0.55, 1.35, 0.55);
    m.top = Math.max(m.top, p.y + 0.3);
  });
});
item("knight", "hat", function (m) {
  var a = m.capTo(0.9), p = m.at(0, 0, 0.1), plume = m.group();
  m.shell(0, a, 0.09, STEEL);
  m.shell(a - 0.1, a + 0.03, puff(0.08, 0.14), "#7c8494", { rows: 2 });
  [-1, 1].forEach(function (s) { m.shell(a, a + 0.5, puff(0.07, 0.1), STEEL, { rows: 2, az0: s * HALF - 0.4, az1: s * HALF + 0.4, seg: 3 }); });
  plume.position.set(p.x, p.y, p.z);
  put(m.mesh(ico(0.22), RED, { in: plume }), 0, 0.14, -0.12).scale.set(0.35, 0.95, 1.5);
  m.ticks.push(function (dt, t) { plume.rotation.z = 0.08 * Math.sin(t * 1.8); });
  m.top = Math.max(m.top, p.y + 0.38);
});
item("nest", "hat", function (m) {
  var h = m.hat({ R: 0.46, tall: 0.6, tilt: 0.06 }), bird = m.group(h);
  put(m.mesh(tor(0.33, 0.09, null, 9), "#8a6a3c", { in: h }), 0, 0.1, 0, HALF);
  put(m.mesh(cyl(0.33, 0.27, 0.08, 9), "#6e5230", { in: h }), 0, 0.05, 0);
  [-1, 1].forEach(function (s) { put(m.mesh(ico(0.085), "#bfe8f0", { in: h }), s * 0.1 - 0.12, 0.2, 0.1).scale.y = 1.25; });
  put(bird, 0.12, 0.33, -0.02);
  m.mesh(ico(0.15), YEL, { in: bird });
  put(m.mesh(cone(0.05, 0.12, 4), ORANGE, { in: bird }), 0, 0.01, 0.16, HALF);
  [-1, 1].forEach(function (s) { put(m.mesh(ico(0.03), INK, { in: bird, plain: true }), s * 0.065, 0.06, 0.125); });
  m.ticks.push(function (dt, t) { bird.position.y = 0.33 + 0.04 * Math.abs(Math.sin(t * 3)); bird.rotation.z = 0.2 * Math.sin(t * 1.5); });
});
item("duck", "hat", function (m) {
  var h = m.hat({ R: 0.34, tall: 0.62, tilt: 0.08 }), g = m.group(h);
  g.rotation.y = 0.45;
  put(m.mesh(ico(0.26), YEL, { in: g }), 0, 0.21, 0).scale.set(1, 0.75, 1.2);
  put(m.mesh(ico(0.16), YEL, { in: g }), 0, 0.45, 0.1);
  put(m.mesh(cone(0.07, 0.15, 4), ORANGE, { in: g }), 0, 0.43, 0.28, HALF).scale.z = 0.5;
  put(m.mesh(cone(0.1, 0.2, 4), YEL, { in: g }), 0, 0.3, -0.3, -0.9);
  [-1, 1].forEach(function (s) { put(m.mesh(ico(0.028), INK, { in: g, plain: true }), s * 0.085, 0.5, 0.22); });
  m.ticks.push(function (dt, t) { g.rotation.z = 0.08 * Math.sin(t * 2); });
});
item("lightbulb", "hat", function (m) {
  var y = m.peak() + 0.36, g = m.stay(m.group()), rays = [], lit = new THREE.Color("#fff3a0"), dim = new THREE.Color("#8d949e");
  g.position.y = y;
  var glass = put(m.mesh(ico(0.2), "#fff3a0", { in: g, plain: true }), 0, 0.08, 0);
  put(m.mesh(cyl(0.11, 0.08, 0.13, 6), STEEL, { in: g }), 0, -0.14, 0);
  for (var i = 0; i < 5; i++) { var a = (i - 2) * 0.6; rays.push(put(m.mesh(box(0.04, 0.13, 0.04), YEL, { in: g, plain: true }), 0.37 * Math.sin(a), 0.08 + 0.37 * Math.cos(a), 0, 0, 0, -a)); }
  m.ticks.push(function (dt, t) {
    var on = t % 3.2 < 2.3;
    glass.material.uniforms.uCol.value.copy(on ? lit : dim);
    rays.forEach(function (r, n) { r.visible = on && Math.floor(t * 5 + n) % 4 !== 0; });
    g.position.y = y + 0.03 * Math.sin(t * 2);
  });
  m.top = Math.max(m.top, y + 0.44);
});
item("flame", "hat", function (m) {
  m.bare();
  var p = m.surf(0, 1, 0), g = m.stay(m.group()), tongues = [];
  g.position.set(p.x, p.y - 0.02, p.z);
  [[0, -0.03, 0.2, 0.62, "#ff4b1f"], [-0.14, 0, 0.13, 0.38, ORANGE], [0.15, 0, 0.13, 0.42, ORANGE], [0.02, 0.1, 0.12, 0.36, YEL]].forEach(function (f) {
    tongues.push(put(m.mesh(spike(f[2], f[3]), f[4], { in: g, plain: true, soft: true }), f[0], 0, f[1]));
  });
  m.ticks.push(function (dt, t) { tongues.forEach(function (c, i) { c.scale.y = 1 + 0.22 * Math.sin(t * (9 + i * 2.3) + i); c.rotation.z = 0.12 * Math.sin(t * (5 + i) + i * 2); }); });
  m.top = Math.max(m.top, p.y + 0.76);
});
item("rainbow", "hat", function (m) {
  var y = m.peak() + 0.16, g = m.stay(m.group()), bands = [];
  g.position.y = y;
  [0.5, 0.43, 0.36, 0.29].forEach(function (r) { bands.push(m.mesh(tor(r, 0.04, Math.PI, 10), WHITE, { in: g, plain: true })); });
  [-1, 1].forEach(function (s) {
    put(m.mesh(ico(0.13), "#e6ecf3", { in: g }), s * 0.38, 0, 0.03);
    put(m.mesh(ico(0.1), "#e6ecf3", { in: g }), s * 0.52, -0.02, 0.03);
    put(m.mesh(ico(0.09), "#b9c4d2", { in: g }), s * 0.29, -0.03, 0.08);
  });
  m.ticks.push(function (dt, t) {
    bands.forEach(function (b, i) { b.material.uniforms.uCol.value.setHSL((i * 0.16 + t * 0.12) % 1, 0.9, 0.6); });
    g.position.y = y + 0.025 * Math.sin(t * 1.8);
  });
  m.ticks[m.ticks.length - 1](0, 0);
  m.top = Math.max(m.top, y + 0.6);
});
item("galaxy", "hat", function (m) {
  var y = m.peak() + 0.42, g = m.stay(m.group()), disk = m.group(g), stars = [];
  g.position.y = y; g.rotation.set(0.5, 0, 0.18);
  m.mesh(ico(0.14), "#fff3a0", { in: disk, plain: true });
  for (var i = 0; i < 16; i++) {
    var k = Math.floor(i / 2) / 7, r = 0.2 + 0.5 * k, a = (i % 2) * Math.PI + k * 3.2;
    stars.push(put(m.mesh(new THREE.OctahedronGeometry(0.07 + 0.04 * (1 - k)), WHITE, { in: disk, plain: true }), r * Math.cos(a), 0, r * Math.sin(a)));
  }
  m.ticks.push(function (dt, t) {
    disk.rotation.y = t * 0.9;
    stars.forEach(function (s, n) {
      var k = 0.7 + 0.5 * Math.sin(t * 4 + n * 1.7);
      s.scale.set(k, k, k); s.material.uniforms.uCol.value.setHSL(0.62 + 0.22 * Math.sin(t * 0.4 + n * 0.35), 0.85, 0.72);
    });
    g.position.y = y + 0.03 * Math.sin(t * 1.6);
  });
  m.ticks[m.ticks.length - 1](0, 0);
  m.top = Math.max(m.top, y + 0.44);
});

/* ----------------- over the eyes (20) ----------------- */
/* A mask: a sheet on the skin round each eye, from the eye's edge to `grow` beyond it, which is a
   number or a function of how far outward and how far up the place is. The two meet in the middle. */
function mask(m, color, grow, o) {
  var e = m.eye, n = 14;
  [-1, 1].forEach(function (s) {
    var pos = [], idx = [], i;
    for (i = 0; i <= n; i++) {
      var c = Math.cos(i * TAU / n), up = Math.sin(i * TAU / n), k = typeof grow === "function" ? grow(c, up) : grow;
      var p = m.face(s * (e.x + c * (e.a + 0.025)), e.y + up * (e.b + 0.025), 0.05), q = m.face(s * Math.max(0, e.x + c * (e.a + k)), e.y + up * (e.b + k * 0.8), 0.05);
      pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
    }
    for (i = 0; i < n; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    m.mesh(geo, color, o);
  });
}
item("reading", "glasses", function (m) {
  both(m, function (l) { put(m.mesh(square(0.22), BROWN, { in: l.g }), 0, -l.ry * 0.55, 0).scale.set(l.rx * 1.25, l.ry * 0.6, l.rx); });
  bridge(m, BROWN, -(m.eye.b + 0.075) * 0.55);
});
item("browline", "glasses", function (m) {
  both(m, function (l) {
    put(m.mesh(tor(1, 0.12, Math.PI, 8), STEEL, { in: l.g }), 0, 0, 0, 0, 0, Math.PI).scale.set(l.rx, l.ry, l.rx);
    put(m.mesh(box(l.rx * 2.3, 0.1, 0.06), INK, { in: l.g }), 0, l.ry * 0.9, 0);
  });
  bridge(m, INK, (m.eye.b + 0.075) * 0.9);
});
item("hex", "glasses", function (m) {
  both(m, function (l) { m.mesh(tor(1, 0.18, null, 6), "#2f7d6b", { in: l.g }).scale.set(l.rx * 1.12, l.ry * 1.12, l.rx); });
  bridge(m, "#2f7d6b");
});
item("rosy", "glasses", function (m) {
  both(m, function (l) {
    m.mesh(disc(1, 10), "#ff8fc0", { in: l.g, plain: true, door: true }).scale.set(l.rx, l.ry, 1);
    m.mesh(tor(1, 0.12, null, 10), ROSE, { in: l.g }).scale.set(l.rx, l.ry, l.rx);
  });
  bridge(m, ROSE);
});
item("lennon", "glasses", function (m) {
  both(m, function (l) {
    var k = Math.max(l.rx, l.ry) * 0.92;
    m.mesh(disc(k, 10), "#2a2140", { in: l.g, plain: true });
    m.mesh(tor(k, k * 0.14, null, 10), GOLD, { in: l.g });
    put(m.mesh(disc(k * 0.2, 4), "#8f86b8", { in: l.g, plain: true }), -k * 0.35, k * 0.35, 0.012);
  });
  bridge(m, GOLD);
});
item("lashes", "glasses", function (m) {
  both(m, function (l) {
    [0.25, 0.7, 1.15].forEach(function (a) { put(m.mesh(box(0.04, 0.15, 0.02), INK, { in: l.g, plain: true }), l.s * Math.sin(a) * (l.rx + 0.02), Math.cos(a) * (l.ry + 0.02), 0, 0, 0, -l.s * a); });
  });
});
item("bandit", "glasses", function (m) {
  mask(m, "#23262e", function (c) { return 0.11 + 0.12 * Math.max(0, c); }, { plain: true });
  strap(m, "#23262e", 0.06);
});
item("swim", "glasses", function (m) {
  strap(m, BLUE, 0.045);
  both(m, function (l) {
    m.mesh(disc(1, 8), "#bfe8ff", { in: l.g, plain: true, door: true }).scale.set(l.rx * 1.02, l.ry * 0.9, 1);
    m.mesh(tor(1, 0.22, null, 8), BLUE, { in: l.g }).scale.set(l.rx * 1.08, l.ry * 0.95, l.rx * 1.2);
  });
  bridge(m, BLUE);
});
item("taped", "glasses", function (m) {
  both(m, function (l) { m.mesh(square(0.26), INK, { in: l.g }).scale.set(l.rx * 1.32, l.ry * 1.25, l.rx); });
  bridge(m, INK);
  bridge(m, WHITE).scale.set(0.6, 1.6, 1.4);
});
item("googly", "glasses", function (m) {
  both(m, function (l) {
    var k = Math.max(l.rx, l.ry) * 1.05, pupil = put(m.mesh(disc(k * 0.45, 8), INK, { in: l.g, plain: true }), 0, -k * 0.45, 0.012);
    m.mesh(disc(k, 10), WHITE, { in: l.g, plain: true });
    m.mesh(tor(k, k * 0.1, null, 10), STEEL, { in: l.g });
    m.ticks.push(function (dt, t) { var a = -HALF + 1.1 * Math.sin(t * 3.1 + l.s) * Math.sin(t * 0.63 + l.s * 0.4); pupil.position.set(k * 0.45 * Math.cos(a), k * 0.45 * Math.sin(a), 0.012); });
  });
});
item("snorkel", "glasses", function (m) {
  var e = m.eye, w = 2 * (Math.max(e.x, e.a + 0.09) + e.a) + 0.16, h = 2 * e.b + 0.18, p = m.face(0, e.y, 0.1), g = m.group();
  strap(m, INK, 0.06);
  g.position.set(p.x, p.y, p.z);
  m.mesh(new THREE.PlaneGeometry(w, h), "#9fe8ff", { in: g, plain: true, door: true });
  [-1, 1].forEach(function (s) {
    put(m.mesh(box(w + 0.07, 0.07, 0.09), YEL, { in: g }), 0, s * h / 2, 0);
    put(m.mesh(box(0.07, h, 0.09), YEL, { in: g }), s * w / 2, 0, 0);
  });
  put(m.mesh(cyl(0.045, 0.045, 0.7, 5), YEL, { in: g }), w / 2 + 0.1, 0.32, -0.12);
  put(m.mesh(cyl(0.055, 0.055, 0.12, 5), ORANGE, { in: g }), w / 2 + 0.1, 0.68, -0.12);
  m.top = Math.max(m.top, p.y + 0.76);
});
item("swirly", "glasses", function (m) {
  both(m, function (l) {
    var k = Math.max(l.rx, l.ry) * 1.05, sw = m.group(l.g);
    m.mesh(disc(k, 10), WHITE, { in: l.g, plain: true });
    m.mesh(tor(k, k * 0.12, null, 10), RED, { in: l.g });
    sw.position.z = 0.012;
    m.mesh(tor(k * 0.62, k * 0.1, Math.PI * 1.2, 8), INK, { in: sw, plain: true });
    m.mesh(tor(k * 0.28, k * 0.1, Math.PI * 1.2, 6), INK, { in: sw, plain: true }).rotation.z = Math.PI;
    m.ticks.push(function (dt, t) { sw.rotation.z = -l.s * t * 2.5; });
  });
  bridge(m, RED);
});
item("disguise", "glasses", function (m) {
  var e = m.eye, p = m.face(0, e.y - e.b * 0.7, 0.1);
  both(m, function (l) {
    m.mesh(tor(1, 0.2, null, 10), INK, { in: l.g }).scale.set(l.rx, l.ry, l.rx);
    put(m.mesh(box(l.rx * 1.7, 0.09, 0.05), INK, { in: l.g }), 0, l.ry + 0.08, 0, 0, 0, -l.s * 0.2);
  });
  bridge(m, INK);
  put(m.mesh(ico(0.13), "#f0b48a"), p.x, p.y - 0.03, p.z + 0.08).scale.set(0.85, 1.2, 1);
  [-1, 1].forEach(function (s) { put(m.mesh(cone(0.08, 0.3), INK), p.x + s * 0.15, p.y - 0.2, p.z + 0.03, 0, 0, -s * (HALF + 0.3)).scale.z = 0.6; });
});
item("flipups", "glasses", function (m) {
  both(m, function (l) {
    var flap = m.group(l.g);
    m.mesh(square(0.18), STEEL, { in: l.g }).scale.set(l.rx * 1.32, l.ry * 1.2, l.rx);
    put(flap, 0, l.ry * 0.9, 0.03, 1.15);
    put(m.mesh(new THREE.PlaneGeometry(1.9, 1.7), "#14161b", { in: flap, plain: true }), 0, l.ry * 0.85, 0).scale.set(l.rx, l.ry, 1);
  });
  bridge(m, STEEL);
});
item("hero", "glasses", function (m) {
  mask(m, RED, function (c, up) { return 0.09 + 0.17 * Math.pow(Math.max(0, c * 0.8 + up * 0.6), 3); });
});
item("ruby", "glasses", function (m) {
  var e = m.eye, p = m.face(0, e.y, 0.1), Rv = p.z, h = e.b * 1.1 + 0.07, a = 1.2;
  var glass = m.stay(put(m.mesh(cyl(Rv, Rv, h, 10, true, -a, 2 * a), "#ff2d46", { plain: true }), 0, p.y, 0));
  [-1, 1].forEach(function (s) { m.stay(put(m.mesh(cyl(Rv + 0.012, Rv + 0.012, 0.06, 10, true, -a, 2 * a), GOLD), 0, p.y + s * (h / 2 + 0.03), 0)); });
  m.ticks.push(function (dt, t) { glass.material.uniforms.uCol.value.setHSL(0.975, 1, 0.5 + 0.12 * Math.sin(t * 4)); });
});
item("nightvision", "glasses", function (m) {
  var glow = [];
  strap(m, "#3a3f4f", 0.06);
  both(m, function (l) {
    var k = Math.min(l.rx, l.ry) * 0.9;
    put(m.mesh(cyl(k, k * 1.1, 0.3, 8), DARK, { in: l.g }), 0, 0, 0.15, HALF);
    glow.push(put(m.mesh(disc(k * 0.8, 8), "#7dff6a", { in: l.g, plain: true }), 0, 0, 0.305));
  });
  bridge(m, DARK);
  m.ticks.push(function (dt, t) { glow.forEach(function (d) { d.material.uniforms.uCol.value.setHSL(0.31, 1, 0.6 + 0.1 * Math.sin(t * 5)); }); });
});
item("masquerade", "glasses", function (m) {
  var e = m.eye, f = m.group();
  mask(m, "#7b3fc4", function (c, up) { return 0.1 + 0.13 * Math.pow(Math.max(0, c * 0.7 + up * 0.7), 2); });
  both(m, function (l) { m.mesh(tor(1, 0.12, null, 10), GOLD, { in: l.g }).scale.set(l.rx - 0.04, l.ry - 0.04, l.rx * 0.5); });
  f.position.copy(m.face(Math.min(0.8, e.x + e.a + 0.1), e.y + e.b + 0.08, 0.1));
  [[-0.3, TEAL], [0.1, PINK], [0.5, YEL]].forEach(function (d) { put(m.mesh(ico(0.14), d[1], { in: f }), Math.sin(d[0]) * 0.17, Math.cos(d[0]) * 0.17, 0, 0, 0, -d[0]).scale.set(0.35, 1.3, 0.2); });
});
item("equalizer", "glasses", function (m) {
  var e = m.eye, cx = Math.max(e.x, e.a + 0.09), w = cx + e.a + 0.14, h = e.b + 0.1, p = m.face(0, e.y, 0.11), g = m.group(), bars = [], n = 9;
  g.position.set(p.x, p.y, p.z);
  m.mesh(box(2 * w, 2 * h, 0.04), "#14161b", { in: g, plain: true });
  for (var i = 0; i < n; i++) bars.push(put(m.mesh(box(1.2 * w / n, 1, 0.02), TEAL, { in: g, plain: true }), (i - (n - 1) / 2) * 1.9 * w / n, 0, 0.03));
  strap(m, "#14161b", 0.05);
  m.ticks.push(function (dt, t) {
    bars.forEach(function (b, i) {
      var k = Math.ceil((0.2 + 0.8 * Math.abs(Math.sin(t * (2.6 + (i * 7) % 5 * 0.7) + i * 1.3))) * 5) / 5;
      b.scale.y = 1.7 * h * k; b.position.y = -0.85 * h * (1 - k);
      b.material.uniforms.uCol.value.setHSL((i / n * 0.5 + t * 0.1) % 1, 0.9, 0.6);
    });
  });
  m.ticks[m.ticks.length - 1](0, 0);
});
item("blazing", "glasses", function (m) {
  var flames = [], rims = [];
  both(m, function (l) {
    m.mesh(disc(1), "#14161b", { in: l.g, plain: true }).scale.set(l.rx * 1.15, l.ry, 1);
    rims.push(m.mesh(tor(1, 0.12, null, 8), ORANGE, { in: l.g, plain: true }));
    rims[rims.length - 1].scale.set(l.rx * 1.17, l.ry * 1.02, l.rx);
    [[0.3, 0.26, YEL], [0.75, 0.34, ORANGE], [1.15, 0.4, "#ff4b1f"]].forEach(function (f) {
      flames.push(put(m.mesh(spike(0.075, f[1], 4), f[2], { in: l.g, plain: true }), l.s * Math.sin(f[0]) * l.rx * 1.1, Math.cos(f[0]) * l.ry * 0.95, -0.01, 0, 0, -l.s * (f[0] + 0.25)));
    });
    m.wide = Math.max(m.wide, l.g.position.x + l.rx + 0.45);
  });
  bridge(m, "#14161b");
  m.ticks.push(function (dt, t) {
    flames.forEach(function (c, i) { c.scale.set(0.9 + 0.2 * Math.sin(t * 11 + i), 0.75 + 0.4 * Math.abs(Math.sin(t * (6 + i * 1.7) + i * 2)), 1); });
    rims.forEach(function (r) { r.material.uniforms.uCol.value.setHSL(0.06 + 0.04 * Math.sin(t * 6), 1, 0.55); });
  });
  m.ticks[m.ticks.length - 1](0, 0);
});

/* ----------------- on the face (20) ----------------- */
item("scar", "face", function (m) {
  var e = m.eye, k = m.group(m.onFace(e.x + e.a * 0.5, e.y - e.b - 0.12, 0.04, 1));
  k.rotation.z = 0.5;
  m.mesh(box(0.04, 0.26, 0.02), "#b8506a", { in: k, plain: true });
  [-1, 0, 1].forEach(function (i) { put(m.mesh(box(0.11, 0.035, 0.02), "#b8506a", { in: k, plain: true }), 0, i * 0.08, 0); });
});
item("beautymark", "face", function (m) { var g = m.onFace(m.eye.x * 0.9, m.mouthY + 0.07, 0.04, 1); m.mesh(disc(0.05, 6), INK, { in: g, plain: true }); });
beard("goatee", "#3a2a20", 0.22, 0.2);
item("pencil", "face", function (m) {
  var g = m.onFace(0, m.mouthY + 0.085, 0.045, 0.9);
  [-1, 1].forEach(function (s) { put(m.mesh(box(0.17, 0.035, 0.025), INK, { in: g, plain: true }), s * 0.1, 0, 0, 0, 0, -s * 0.18); });
});
item("tongue", "face", function (m) {
  var g = m.onFace(0.03, m.mouthY - 0.03, 0.05, 0.7), k = m.group(g);
  put(m.mesh(box(0.15, 0.09, 0.02), "#ff6f91", { in: k, plain: true }), 0, -0.02, 0);
  put(m.mesh(disc(0.075, 8), "#ff6f91", { in: k, plain: true }), 0, -0.065, 0.01);
  put(m.mesh(box(0.022, 0.1, 0.02), "#d94f74", { in: k, plain: true }), 0, -0.05, 0.012);
  m.ticks.push(function (dt, t) { k.rotation.z = 0.14 * Math.sin(t * 2.6); });
});
item("warpaint", "face", function (m) {
  cheeks(m, function (g, s) { [0, 1].forEach(function (i) { put(m.mesh(box(0.2, 0.045, 0.02), i ? RED : BLUE, { in: g, plain: true }), 0, i * 0.075 - 0.03, 0, 0, 0, -s * 0.2); }); });
});
item("kiss", "face", function (m) {
  var e = m.eye, g = m.onFace(e.x + e.a * 0.9, e.y - e.b - 0.1, 0.04, 1);
  m.mesh(poly([[-1, 0], [-0.5, 0.45], [0, 0.25], [0.5, 0.45], [1, 0], [0.5, -0.5], [0, -0.6], [-0.5, -0.5]], 0.11), "#e0245e", { in: g, plain: true }).rotation.z = -0.35;
});
item("pacifier", "face", function (m) {
  var g = m.onFace(0, m.mouthY, 0.07, 0.8);
  put(m.mesh(cyl(0.12, 0.12, 0.035, 8), SKY, { in: g }), 0, 0, 0, HALF).scale.x = 1.3;
  put(m.mesh(ico(0.05), YEL, { in: g }), 0, 0, 0.05);
  put(m.mesh(tor(0.07, 0.02, null, 8), YEL, { in: g }), 0, -0.07, 0.08, 0.5);
});
item("wheat", "face", function (m) {
  var g = m.group();
  g.position.copy(m.face(0.05, m.mouthY, 0.04));
  put(m.mesh(cyl(0.025, 0.025, 0.5, 3), "#d9b44a", { in: g, soft: true }), 0.25, 0, 0.05, 0, 0, HALF);
  put(m.mesh(ico(0.07), "#e8c860", { in: g }), 0.54, 0, 0.06).scale.set(2, 0.8, 0.8);
  m.ticks.push(function (dt, t) { g.rotation.z = 0.25 + 0.06 * Math.sin(t * 2.4); });
  m.ticks[m.ticks.length - 1](0, 0);
});
item("milk", "face", function (m) {
  var y = m.mouthY + 0.04;
  m.patch(function (u, v) { var x = (u * 2 - 1) * 0.2; return [x, y + v * (0.03 + 0.05 * Math.sin(Math.PI * Math.min(1, Math.abs(x) / 0.2))), 0.035]; }, WHITE, { n: 4, plain: true });
});
item("rose", "face", function (m) {
  var g = m.group();
  g.position.copy(m.face(0, m.mouthY, 0.05)); g.rotation.z = 0.12;
  put(m.mesh(cyl(0.025, 0.025, 0.62, 3), "#3f8f3a", { in: g, soft: true }), 0.05, 0, 0.04, 0, 0, HALF);
  put(m.mesh(ico(0.095), "#d81e3a", { in: g }), 0.4, 0, 0.07);
  put(m.mesh(ico(0.05), "#ff6f91", { in: g, plain: true }), 0.4, 0.02, 0.13);
  put(m.mesh(ico(0.05), GREEN, { in: g }), 0.24, 0.04, 0.06).scale.set(1.6, 0.4, 0.8);
});
item("beak", "face", function (m) {
  var p = m.face(0, m.mouthY + 0.05, 0);
  put(m.mesh(ico(0.16), "#ffa726", { soft: true }), p.x, p.y, p.z + 0.06).scale.set(1.25, 0.45, 1.1);
  put(m.mesh(ico(0.13), "#e88a0c", { soft: true }), p.x, p.y - 0.06, p.z + 0.03).scale.set(1.2, 0.35, 1);
});
item("tusks", "face", function (m) {
  [-1, 1].forEach(function (s) { var g = m.onFace(s * 0.17, m.mouthY - 0.01, 0.03, 0.5); put(m.mesh(cone(0.045, 0.24, 5), "#f6f1e4", { in: g, soft: true }), s * 0.02, 0.09, 0.03, 0.25, 0, -s * 0.25); });
});
item("muttonchops", "face", function (m) {
  var e = m.eye, top = e.y + 0.02, low = Math.max(m.mouthY - 0.14, m.lowY), x0 = e.x + e.a + 0.1;
  [-1, 1].forEach(function (s) {
    m.patch(function (u, v) {
      var y = top + (low - top) * v, w = Math.sqrt(Math.max(0.05, 1 - y * y)), a = Math.min(lerp(x0, 0.32, v * v), 0.62 * w), b = Math.min(a + 0.22, 0.86 * w);
      return [s * lerp(a, b, u), y, 0.045 + 0.05 * Math.sin(Math.PI * u)];
    }, "#6b4a2e", { n: 5 });
  });
});
item("facemask", "face", function (m) {
  var top = m.mouthY + 0.13, low = Math.max(m.mouthY - 0.2, m.lowY), a = Math.acos(clamp(m.mouthY + 0.03, -1, 1));
  m.patch(function (u, v) { var y = top + (low - top) * v; return [(u * 2 - 1) * 0.34 * Math.sqrt(Math.max(0.05, 1 - y * y)), y, 0.05 + 0.03 * Math.sin(Math.PI * v)]; }, "#bfe3f0", { n: 5 });
  [-1, 1].forEach(function (s) { m.shell(a - 0.025, a + 0.025, 0.045, WHITE, { rows: 1, az0: s > 0 ? 0.36 : -1.5, az1: s > 0 ? 1.5 : -0.36, seg: 4 }); });
});
item("bone", "face", function (m) {
  var g = m.group();
  g.position.copy(m.face(0, m.mouthY, 0.08)); g.rotation.z = 0.1;
  put(m.mesh(cyl(0.035, 0.035, 0.44, 5), "#f6f1e4", { in: g }), 0, 0, 0.03, 0, 0, HALF);
  [-1, 1].forEach(function (s) { [-1, 1].forEach(function (k) { put(m.mesh(ico(0.055), "#f6f1e4", { in: g }), s * 0.23, k * 0.04, 0.03); }); });
});
item("bubblepipe", "face", function (m) {
  var g = m.group(), bubbles = [];
  g.position.copy(m.face(0.06, m.mouthY, 0.05));
  put(m.mesh(cyl(0.025, 0.025, 0.3, 4), BROWN, { in: g, soft: true }), 0.15, -0.04, 0.05, 0, 0, HALF - 0.25);
  put(m.mesh(cyl(0.09, 0.07, 0.13, 6), BROWN, { in: g }), 0.32, -0.05, 0.07);
  for (var i = 0; i < 3; i++) bubbles.push(m.mesh(ico(1), "#bfe8ff", { in: g, plain: true, door: true }));
  m.ticks.push(function (dt, t) {
    bubbles.forEach(function (b, n) { var k = (t * 0.35 + n / 3) % 1, r = 0.03 + 0.05 * k; b.scale.set(r, r, r); b.position.set(0.32 + 0.07 * Math.sin(t * 2 + n * 2) * k, 0.08 + 0.5 * k, 0.07); b.visible = k < 0.92; });
  });
  m.ticks[m.ticks.length - 1](0, 0.5);
});
item("tentacles", "face", function (m) {
  var arms = [];
  [-1.5, -0.5, 0.5, 1.5].forEach(function (i) {
    var g = m.stay(m.group()), len = 0.36 - 0.05 * Math.abs(i);
    g.position.copy(m.face(i * 0.09, m.mouthY - 0.05, 0.02));
    m.mesh(spike(0.055, len), i % 2 ? "#4fb59a" : "#3f9a82", { in: g, soft: true }).rotation.x = Math.PI;
    arms.push({ g: g, i: i });
  });
  m.ticks.push(function (dt, t) { arms.forEach(function (a) { a.g.rotation.set(-0.3 + 0.12 * Math.sin(t * 1.7 + a.i), 0, a.i * 0.14 + 0.2 * Math.sin(t * 2.1 + a.i * 1.3)); }); });
  m.ticks[m.ticks.length - 1](0, 0);
});
item("goldtooth", "face", function (m) {
  var g = m.onFace(0.05, m.mouthY - 0.05, 0.045, 0.8), tw = put(m.mesh(star(0.075), "#fff8d0", { in: g, plain: true }), 0.04, 0.03, 0.03);
  m.mesh(box(0.075, 0.1, 0.03), GOLD, { in: g });
  m.ticks.push(function (dt, t) { var k = Math.pow(Math.max(0, Math.sin(t * 2.2)), 3); tw.scale.set(k, k, k); tw.rotation.z = t * 1.5; tw.visible = k > 0.05; });
  m.ticks[m.ticks.length - 1](0, 0.7);
});
item("tune", "face", function (m) {
  var p = m.face(0.1, m.mouthY, 0.12), notes = [];
  for (var i = 0; i < 3; i++) {
    var g = m.stay(m.group());
    m.mesh(ico(0.075), WHITE, { in: g, plain: true }).scale.set(1.2, 0.85, 0.6);
    put(m.mesh(box(0.04, 0.26, 0.02), WHITE, { in: g, plain: true }), 0.07, 0.13, 0);
    put(m.mesh(box(0.13, 0.06, 0.02), WHITE, { in: g, plain: true }), 0.12, 0.24, 0, 0, 0, -0.3);
    notes.push(g);
  }
  m.ticks.push(function (dt, t) {
    notes.forEach(function (g, n) {
      var k = (t * 0.4 + n / 3) % 1, s = Math.max(0.01, Math.min(1, k * 5, (1 - k) * 5));
      g.position.set(p.x + 0.1 + 0.42 * k + 0.05 * Math.sin(t * 3 + n * 2), p.y + 0.1 * k + 0.5 * k * k, p.z);
      g.rotation.z = 0.3 * Math.sin(t * 2.5 + n); g.scale.set(s, s, s);
      g.children.forEach(function (c) { c.material.uniforms.uCol.value.setHSL((n / 3 + t * 0.12) % 1, 0.85, 0.62); });
    });
  });
  m.ticks[m.ticks.length - 1](0, 0.4);
});

/* ----------------- round the neck (20) ----------------- */
item("ribbon", "neck", function (m) {
  var g = m.chin(0.02, 0.1);
  m.band(PINK, 0.04, 0.045, { rows: 1 });
  [-1, 1].forEach(function (s) {
    put(m.mesh(cone(0.1, 0.17), PINK, { in: g }), s * 0.1, 0, 0, 0, 0, s * HALF).scale.z = 0.6;
    put(m.mesh(box(0.05, 0.2, 0.03), PINK, { in: g }), s * 0.055, -0.13, 0, 0, 0, s * 0.3);
  });
  m.mesh(box(0.07, 0.08, 0.07), "#c93d77", { in: g });
});
item("dogtag", "neck", function (m) {
  var g = m.chin(0.13, 0.1);
  m.band("#3f8f3a", 0.055, 0.055, { rows: 1 });
  m.mesh(box(0.16, 0.06, 0.03), "#dfe6ee", { in: g });
  [-1, 1].forEach(function (s) { [-1, 1].forEach(function (k) { put(m.mesh(ico(0.04), "#dfe6ee", { in: g }), s * 0.09, k * 0.03, 0); }); });
});
item("locket", "neck", function (m) {
  var g = m.chin(0.14, 0.1);
  m.band(GOLD, 0.02, 0.03, { rows: 1 });
  put(m.mesh(box(0.02, 0.1, 0.02), GOLD, { in: g }), 0, 0.1, 0);
  m.mesh(heart(0.09), "#ff4d7e", { in: g });
});
item("stripytie", "neck", function (m) {
  var g = m.chin(0);
  m.band(WHITE, 0.05, 0.045, { rows: 1 });
  m.mesh(box(0.11, 0.09, 0.07), RED, { in: g });
  put(m.mesh(cyl(0.05, 0.1, 0.34, 4), RED, { in: g }), 0, -0.2, 0.02, 0, Math.PI / 4).scale.z = 0.4;
  [0, 1, 2].forEach(function (i) { put(m.mesh(box(0.08 + i * 0.03, 0.035, 0.02), YEL, { in: g, plain: true }), 0, -0.11 - i * 0.09, 0.065, 0, 0, 0.4); });
});
item("neckerchief", "neck", function (m) {
  var g = m.chin(0.03, 0.09);
  m.band(YEL, 0.07, 0.06);
  m.mesh(box(0.08, 0.07, 0.07), BROWN, { in: g });
  [-1, 1].forEach(function (s) { put(m.mesh(cone(0.07, 0.24, 4), YEL, { in: g }), s * 0.06, -0.15, 0.01, 0, 0, s * 0.35).scale.z = 0.4; });
});
item("choker", "neck", function (m) {
  m.band("#23262e", 0.05, 0.05, { rows: 1 });
  m.around(m.neck, 10, 0.125, function (p, i, az) {
    put(m.mesh(cone(0.045, 0.13, 4), "#dfe6ee"), p.x, p.y, p.z).quaternion.setFromUnitVectors(UP, new THREE.Vector3().fromArray(dir(m.neck, az)));
  }, TAU / 20);
});
beads("candy", 14, 0.065, ["#ff9ec4", "#9fe8ff", "#fff3a0", "#b8f5a0", "#d7b8ff"]);
item("seashell", "neck", function (m) {
  var g = m.chin(0.14, 0.1);
  m.band("#c9a66b", 0.022, 0.03, { rows: 1 });
  put(m.mesh(box(0.02, 0.09, 0.02), "#c9a66b", { in: g }), 0, 0.1, 0);
  put(m.mesh(cyl(0.14, 0.14, 0.03, 6, false, -0.9, 1.8), "#ffc9b0", { in: g }), 0, 0.06, 0, HALF);
});
item("poloneck", "neck", function (m) {
  m.shell(m.neck - 0.1, Math.min(m.neck + 0.22, Math.acos(m.lowY)), puff(0.05, 0.1), "#2f6f6a", { rows: 3 });
  m.shell(m.neck - 0.13, m.neck - 0.01, puff(0.07, 0.14), "#3b8a83", { rows: 2 });
});
item("bolo", "neck", function (m) {
  var g = m.chin(0.03, 0.09);
  m.band(INK, 0.02, 0.03, { rows: 1 });
  put(m.mesh(cyl(0.065, 0.065, 0.035, 8), TEAL, { in: g }), 0, 0, 0, HALF).scale.z = 1.3;
  [-1, 1].forEach(function (s) {
    put(m.mesh(box(0.04, 0.24, 0.03), INK, { in: g }), s * 0.04, -0.15, 0, 0, 0, s * 0.12);
    put(m.mesh(box(0.05, 0.07, 0.04), STEEL, { in: g }), s * 0.055, -0.29, 0);
  });
});
item("mittens", "neck", function (m) {
  m.band(WHITE, 0.02, 0.03, { rows: 1 });
  [-1, 1].forEach(function (s) {
    var g = m.group();
    g.position.copy(m.face(s * 0.3, m.neckY - 0.03, 0.1));
    put(m.mesh(box(0.03, 0.14, 0.03), WHITE, { in: g }), 0, -0.03, 0);
    put(m.mesh(ico(0.1), RED, { in: g }), 0, -0.2, 0).scale.set(0.85, 1.15, 0.55);
    put(m.mesh(ico(0.045), RED, { in: g }), -s * 0.09, -0.19, 0);
    put(m.mesh(box(0.15, 0.05, 0.08), WHITE, { in: g }), 0, -0.1, 0);
    m.ticks.push(function (dt, t) { g.rotation.z = 0.1 * Math.sin(t * 2 + s); });
  });
});
item("camera", "neck", function (m) {
  var g = m.chin(0.2, 0.1), flash = put(m.mesh(star(0.09), WHITE, { in: g, plain: true }), -0.09, 0.07, 0.07);
  m.band(INK, 0.03, 0.035, { rows: 1 });
  [-1, 1].forEach(function (s) { put(m.mesh(box(0.025, 0.2, 0.02), INK, { in: g }), s * 0.12, 0.14, 0, 0, 0, -s * 0.25); });
  m.mesh(box(0.3, 0.19, 0.1), DARK, { in: g });
  put(m.mesh(cyl(0.07, 0.07, 0.08, 8), STEEL, { in: g }), 0, -0.005, 0.08, HALF);
  put(m.mesh(disc(0.045, 8), SKY, { in: g, plain: true }), 0, -0.005, 0.125);
  put(m.mesh(box(0.07, 0.04, 0.06), RED, { in: g }), 0.09, 0.11, 0);
  flash.visible = false;
  m.ticks.push(function (dt, t) { flash.visible = t % 4.5 < 0.14; });
});
item("ruff", "neck", function (m) {
  m.shell(m.neck - 0.08, m.neck + 0.08, function (t, u) { return 0.06 + 0.2 * Math.sin(Math.PI * t) * (Math.round(u * 32) % 2 ? 1 : 0.45); }, WHITE, { rows: 2, seg: 32 });
});
item("boa", "neck", function (m) {
  var p = m.face(0.32, m.neckY - 0.05, 0.16);
  m.around(m.neck, 13, 0.14, function (q, i) { put(m.mesh(ico(0.12 + 0.02 * (i % 2)), i % 2 ? "#ff7ad1" : "#d94fb0"), q.x, q.y, q.z).rotation.set(i, i * 2, 0); });
  [0, 1, 2].forEach(function (i) { put(m.mesh(ico(0.1 - i * 0.015), i % 2 ? "#d94fb0" : "#ff7ad1"), p.x + 0.03 * i, p.y - 0.12 * (i + 1), p.z); });
});
item("stethoscope", "neck", function (m) {
  var g = m.chin(0.05, 0.1);
  m.band(DARK, 0.03, 0.04, { rows: 1 });
  [-1, 1].forEach(function (s) { put(m.mesh(box(0.04, 0.17, 0.03), DARK, { in: g }), s * 0.045, -0.06, 0, 0, 0, -s * 0.57); });
  put(m.mesh(box(0.04, 0.14, 0.03), DARK, { in: g }), 0, -0.2, 0);
  put(m.mesh(cyl(0.08, 0.08, 0.035, 8), STEEL, { in: g }), 0, -0.3, 0.01, HALF);
  put(m.mesh(disc(0.05, 8), "#dfe6ee", { in: g, plain: true }), 0, -0.3, 0.03);
});
item("fairylights", "neck", function (m) {
  var bulbs = [], cols = [RED, YEL, GREEN, BLUE, PINK].map(function (c) { return new THREE.Color(c); });
  m.band("#2f5d3a", 0.02, 0.035, { rows: 1 });
  m.around(m.neck, 12, 0.09, function (p, i) { var b = put(m.mesh(ico(0.06), "#ffffff", { plain: true }), p.x, p.y - 0.04, p.z); b.scale.y = 1.4; bulbs.push({ mesh: b, i: i }); });
  m.ticks.push(function (dt, t) { bulbs.forEach(function (b) { b.mesh.material.uniforms.uCol.value.copy(cols[b.i % 5]).multiplyScalar(Math.floor(t * 2.5 + b.i * 0.5) % 3 ? 1 : 0.4); }); });
  m.ticks[m.ticks.length - 1](0, 0);
});
item("amulet", "neck", function (m) {
  var g = m.chin(0.16, 0.1);
  m.around(m.neck, 20, 0.05, function (p) { put(m.mesh(ico(0.035), GOLD), p.x, p.y, p.z); });
  put(m.mesh(cyl(0.12, 0.12, 0.03, 6), GOLD, { in: g }), 0, 0, 0, HALF);
  var gem = put(m.mesh(new THREE.OctahedronGeometry(0.085), "#7df9ff", { in: g, plain: true }), 0, 0, 0.03), ring = put(m.mesh(tor(0.17, 0.02, null, 10), "#7df9ff", { in: g, plain: true, door: true }), 0, 0, 0.02);
  gem.scale.z = 0.5;
  m.ticks.push(function (dt, t) {
    var k = 0.5 + 0.5 * Math.sin(t * 2.4);
    gem.material.uniforms.uCol.value.setHSL(0.5 + 0.08 * k, 1, 0.55 + 0.25 * k); gem.rotation.z = t * 0.8;
    ring.scale.set(0.8 + 0.5 * k, 0.8 + 0.5 * k, 1);
  });
  m.ticks[m.ticks.length - 1](0, 0);
});
item("mantle", "neck", function (m) {
  var g = m.chin(0, 0.19);
  m.shell(m.neck - 0.1, m.neck + 0.12, puff(0.07, 0.16), "#f6f1e4", { rows: 2 });
  m.around(m.neck + 0.01, 9, 0.17, function (p) { put(m.mesh(ico(0.04), INK, { plain: true }), p.x, p.y, p.z); }, 0.35);
  m.shell(m.neck + 0.06, Math.min(m.neck + 1.25, Math.acos(m.lowY)), function (t) { return 0.06 + 0.4 * t * t; }, "#a3122a", { rows: 5, az0: HALF + 0.1, az1: TAU - HALF - 0.1, seg: 8 });
  m.mesh(ico(0.07), GOLD, { in: g });
  m.wide = Math.max(m.wide, m.girth(1.8, 2.6) + 0.42);
});
item("snake", "neck", function (m) {
  var g = m.group(), tongue;
  for (var i = 0; i < 12; i++) m.band([RED, YEL, INK, YEL][i % 4], 0.07, 0.11, { az0: i * TAU / 12, az1: (i + 1) * TAU / 12, seg: 2 });
  g.position.copy(m.face(0.38, m.neckY + 0.02, 0.2));
  put(m.mesh(cyl(0.075, 0.09, 0.24, 6), RED, { in: g }), 0, 0.07, 0, 0, 0, -0.3);
  put(m.mesh(cyl(0.08, 0.08, 0.06, 6), YEL, { in: g }), 0.03, 0.14, 0, 0, 0, -0.3);
  put(m.mesh(ico(0.13), INK, { in: g }), 0.06, 0.25, 0.03).scale.set(1, 0.75, 1.25);
  [-1, 1].forEach(function (s) { put(m.mesh(ico(0.035), YEL, { in: g, plain: true }), 0.06 + s * 0.07, 0.29, 0.13); });
  tongue = put(m.mesh(box(0.035, 0.035, 0.12), RED, { in: g, plain: true }), 0.06, 0.22, 0.23);
  m.ticks.push(function (dt, t) { tongue.visible = t % 2.2 < 0.35; g.rotation.z = 0.08 * Math.sin(t * 1.6); });
});
item("wings", "neck", function (m) {
  [-1, 1].forEach(function (s) {
    // hung well round its back, so that a pair lifted off it is still a pair of wings
    var g = m.stay(m.group()), p = m.at(1.3, s * 2.85, 0.02);
    g.position.copy(p);
    [[1.4, 0.5, 0.27], [1.2, 0.22, 0.23], [1.0, -0.06, 0.19]].forEach(function (f, i) {
      put(m.mesh(ico(1), i ? "#e6ecf3" : WHITE, { in: g, soft: true }), s * f[0] / 2 * Math.cos(f[1]), f[0] / 2 * Math.sin(f[1]), 0, 0, 0, s * f[1]).scale.set(f[0] / 2, f[2], 0.05);
    });
    m.ticks.push(function (dt, t) { g.rotation.y = s * (0.2 + 0.3 * Math.sin(t * 6)); });
    m.wide = Math.max(m.wide, Math.abs(p.x) + 1.28);
  });
});

/* ================= what one creature has on ================= */
/* Kept on the creature as `orb.worn`, which the core calls: after each update, so that what moves
   moves; after its size or seed changes, since everything was fitted to the body it had; and when
   the creature goes. */
function Worn(orb) {
  this.orb = orb; this.maker = null; this.sig = ""; this.outfit = null; this.gift = null;
  this.keep();
}
// What grows on its head, and the room it leaves itself, as the creature made them: kept so that a hat's changes can be undone.
Worn.prototype.keep = function () {
  var o = this.orb, u = o.uB, b = u.uBump.value;
  this.base = { fill: o.fill, rest: o.rest, top: u.uTop.value.w, bumps: [b[0].clone(), b[1].clone()] };
};
Worn.prototype.restore = function () {
  var u = this.orb.uB, b = this.base;
  u.uTop.value.w = b.top; u.uBump.value[0].copy(b.bumps[0]); u.uBump.value[1].copy(b.bumps[1]);
};
// The creature already leaves room above its head for ears and antennae; a hat asks for more, and
// something wide asks for room at the sides.
Worn.prototype.room = function () {
  var o = this.orb, b = this.base, m = this.maker;
  if (!m) { o.fill = b.fill; o.rest = b.rest; return; }
  var top = Math.max(-b.rest / (0.34 * b.fill), m ? m.top - 1 : 0);
  o.fill = Math.min(b.fill, 0.95 / (1 + top * 0.8), m && m.wide ? 0.94 / m.wide : 9);
  o.rest = -top * 0.34 * o.fill;
};
Worn.prototype.off = function () {
  var m = this.maker;
  if (m) { this.orb.body.remove(m.root); m.free(); }
  this.maker = null; this.sig = ""; this.outfit = null;
  this.restore(); this.room();
};
Worn.prototype.put = function (outfit) {
  outfit = outfit || {};
  var sig = SLOTS.map(function (s) { return ITEMS[outfit[s]] === s ? outfit[s] : ""; }).join("/");
  if (this.sig === sig && this.maker) return;
  this.off();
  if (sig === "///") return;
  var m = new Maker(this.orb);
  SLOTS.forEach(function (s) { if (ITEMS[outfit[s]] === s) MAKE[outfit[s]](m); });
  m.settle();
  this.orb.body.add(m.root);
  this.maker = m; this.sig = sig; this.outfit = outfit;
  this.room();
};
Worn.prototype.tick = function (dt, t) {
  var m = this.maker;
  if (m) for (var i = 0; i < m.ticks.length; i++) m.ticks[i](dt, t);
  if (this.gift) this.gift.tick(dt, t);
};
Worn.prototype.fit = function () {
  var was = this.outfit;
  this.keep();
  if (this.maker) { this.orb.body.remove(this.maker.root); this.maker.free(); this.maker = null; }
  if (was) this.put(was); else this.room();
};
Worn.prototype.dispose = function () {
  if (this.gift) this.gift.dispose();
  this.off();
};
function wornOf(orb) { return orb.worn || (orb.worn = new Worn(orb)); }

// Put these on a creature, in place of whatever it wore: `{ hat, glasses, face, neck }`, each the id of a thing or nothing.
function dress(orb, outfit) {
  // a creature that wears nothing and never has is left as it is
  if (!orb.worn && !SLOTS.some(function (s) { return outfit && ITEMS[outfit[s]] === s; })) return;
  wornOf(orb).put(outfit);
}
// Take everything off.
function strip(orb) { if (orb.worn) orb.worn.off(); }
/* How far the deepest corner of anything it wears is inside its body, in body radii; nothing is
   when this is zero or less. It is measured against the body at rest. */
function audit(orb) { var m = orb.worn && orb.worn.maker; return m ? m.sunk(m.root) : -9; }

/* ================= a box, and the opening of it =================
   Shown on a creature's own stage in place of the creature, so that it is drawn by the same
   renderer at the same low resolution. Shut, it rocks now and then, as the egg does. Opened, it
   plays one short timeline, as the hatch does: it rattles, and jolts once for each rarity up to
   the one inside, the light at its seam stepping up through their colors; it gathers itself; and
   it bursts: the lid is blown off, the walls fall open, confetti and rings fly, and what was
   inside rises into a beam of light and hangs there. The rarer the thing, the longer the wait. */
var GROUND = -0.6, FLOAT = 0.3, JOLT_EVERY = 0.42, FIRST_JOLT = 0.3, GATHER = 0.6, SHOWN_AFTER = 0.9;
function Gift(orb, o) {
  o = o || {};
  var self = this, m = this.m = new Maker(orb), W = 0.3, H = 0.4, T = 0.03;
  this.orb = orb; this.phase = "shut";
  this.onPop = o.onPop || null; this.onShown = o.onShown || null;
  this.T = 0; this.clock = 0; this.popAt = 0; this.tiers = []; this.jolt = 0;
  this.wait = 1.2; this.rockT = 9; this.rockA = 0;
  this.hop = { y: 0, v: 0 }; this.lidAt = { x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, off: false };
  this.rise = { x: 0, v: 0 }; this.item = null;
  // on the stage itself, since the creature is not drawn while a box is
  var stage = this.stage = new THREE.Group();
  orb.scene.add(stage);
  put(m.mesh(disc(0.5, 10), "#06090b", { in: stage, plain: true, door: true }), 0, GROUND - 0.03, -0.2).scale.y = 0.22;
  // seen a little from above, and from a corner, so that it is plainly a box
  var root = this.root = m.group(stage);
  root.rotation.set(0.3, 0.62, 0);
  put(m.mesh(box(2 * W, T, 2 * W), "#1f8a80", { in: root }), 0, T / 2, 0);
  this.glow = put(m.mesh(box(2 * W - 0.03, 0.02, 2 * W - 0.03), "#ffffff", { in: root, plain: true }), 0, T + 0.012, 0);
  this.glow.visible = false;
  this.walls = [[0, W, 0], [W, 0, HALF], [0, -W, Math.PI], [-W, 0, -HALF]].map(function (p) {
    // each wall turns about its bottom edge, and falls outward
    var hinge = m.group(root), leaf = m.group(hinge);
    hinge.position.set(p[0], 0, p[1]); hinge.rotation.y = p[2];
    put(m.mesh(box(2 * W, H, T), TEAL, { in: leaf }), 0, H / 2, 0);
    put(m.mesh(box(0.13, H, T + 0.014), YEL, { in: leaf }), 0, H / 2, 0);
    return { leaf: leaf, a: 0, v: 0 };
  });
  var lid = this.lid = m.group(root);
  lid.position.y = H;
  put(m.mesh(box(2 * W + 0.07, 0.09, 2 * W + 0.07), TEAL, { in: lid }), 0, 0.045, 0);
  put(m.mesh(box(0.13, 0.1, 2 * W + 0.08), YEL, { in: lid }), 0, 0.045, 0);
  put(m.mesh(box(2 * W + 0.08, 0.1, 0.13), YEL, { in: lid }), 0, 0.045, 0);
  [-1, 1].forEach(function (s) { put(m.mesh(cone(0.11, 0.2), YEL, { in: lid }), s * 0.12, 0.19, 0, 0, 0, s * HALF).scale.z = 0.6; });
  put(m.mesh(box(0.08, 0.1, 0.08), "#e0a81c", { in: lid }), 0, 0.19, 0);
  // the light that leaks out between the box and its lid before it opens
  this.seam = put(m.mesh(box(2 * W + 0.035, 0.05, 2 * W + 0.035), "#ffffff", { in: root, plain: true }), 0, H, 0);
  this.seam.visible = false;
  // only the far half of the beam, so that it is behind what it lights
  this.beam = m.mesh(cyl(0.66, 0.2, 1.7, 10, true, HALF, Math.PI), "#ffffff", { in: stage, plain: true, door: true });
  this.beam.geometry.translate(0, 0.85, 0);
  this.beam.position.y = GROUND + 0.16; this.beam.visible = false;
  this.rings = [0, 1, 2].map(function () {
    var r = put(m.mesh(tor(1, 0.03, null, 16), "#ffffff", { in: stage, plain: true, door: true }), 0, GROUND + 0.05, 0, HALF - 0.3);
    r.visible = false;
    return r;
  });
  var bit = box(0.06, 0.02, 0.045);
  m.trash.push(bit);
  this.inks = ["#ffffff", "#ffffff", YEL, PINK, TEAL].map(function (c) { return m.ink(c, {}); });
  this.bits = [];
  for (var i = 0; i < 36; i++) {
    var mesh = new THREE.Mesh(bit, this.inks[i % 5]);
    mesh.renderOrder = 1.5; mesh.frustumCulled = false; mesh.visible = false;
    stage.add(mesh);
    this.bits.push({ mesh: mesh, v: new THREE.Vector3(), r: new THREE.Vector3() });
  }
  this.stars = [0, 1, 2, 3, 4, 5].map(function () {
    var s = m.mesh(new THREE.OctahedronGeometry(0.045), "#fff3a0", { in: stage, plain: true });
    s.visible = false;
    return s;
  });
  this.show = m.group(stage);
  this.show.visible = false;
  this.place(0, 0);
}
// Where the box is: on the ground, lifted by a hop, rolled about its base.
Gift.prototype.place = function (roll, squash) {
  var r = this.root;
  r.position.set(-Math.sin(roll) * 0.2, GROUND + this.hop.y, 0);
  r.rotation.z = roll;
  r.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
};
// The box was pressed, and what is inside is not known yet: it rattles until `open` or `calm`.
Gift.prototype.shake = function () { if (this.phase === "shut") this.phase = "shake"; };
Gift.prototype.calm = function () { if (this.phase === "shake") this.phase = "shut"; };
/* Open it on a thing: `id` of the thing, and `tiers`, the colors of the rarities from the
   commonest up to and including its own. */
Gift.prototype.open = function (o) {
  if (this.phase !== "shut" && this.phase !== "shake") return;
  var orb = this.orb, made = this.item = new Maker(orb), worn = wornOf(orb);
  // the thing is made to fit this creature, then lifted off it to be shown by itself
  if (MAKE[o.id]) MAKE[o.id](made);
  made.settle();
  worn.restore();
  var lo = new THREE.Vector3(9, 9, 9), hi = new THREE.Vector3(-9, -9, -9), M = new THREE.Matrix4(), v = new THREE.Vector3();
  made.root.traverse(function (n) {
    if (!n.isMesh) return;
    M.identity();
    for (var q = n; q && q !== made.root; q = q.parent) { q.updateMatrix(); M.premultiply(q.matrix); }
    var pos = n.geometry.attributes.position;
    for (var i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); lo.min(v); hi.max(v); }
  });
  // shown at one size whatever it is: a pair of teeth as large as a top hat
  var mid = lo.clone().add(hi).multiplyScalar(0.5), half = Math.max(hi.x - lo.x, hi.y - lo.y, 0.14) / 2;
  made.root.position.copy(mid).negate();
  this.show.add(made.root);
  this.size = 0.36 / half;
  this.tiers = o.tiers && o.tiers.length ? o.tiers : ["#9aa3ad"];
  this.inks[0].uniforms.uCol.value.set(this.tiers[this.tiers.length - 1]);
  this.inks[1].uniforms.uCol.value.set(this.tiers[this.tiers.length - 1]);
  this.T = 0; this.phase = "open";
  this.popAt = FIRST_JOLT + (this.tiers.length - 1) * JOLT_EVERY + GATHER;
  // with less motion asked for, it is simply open
  if (orb.reduced) { this.T = this.popAt; this.pop(); }
};
Gift.prototype.light = function (color) {
  var self = this;
  [this.seam, this.glow, this.beam].concat(this.rings).forEach(function (mesh) { mesh.material.uniforms.uCol.value.set(color); });
  this.beam.material.uniforms.uCol.value.lerp(new THREE.Color("#ffffff"), 0.45);
  self.seam.visible = this.phase === "open";
};
Gift.prototype.pop = function () {
  var calm = this.orb.reduced, l = this.lidAt;
  this.phase = "burst"; this.jolt = calm ? 0 : 1.6; this.hop.v = calm ? 0 : 1.5;
  this.light(this.tiers[this.tiers.length - 1]);
  this.seam.visible = false; this.glow.visible = true; this.beam.visible = true; this.show.visible = true;
  l.off = true; l.vy = 5.4; l.vx = -1.7; l.vr = 8;
  this.rise.x = 0; this.rise.v = calm ? 0 : 4;
  if (calm) { this.lid.visible = false; this.walls.forEach(function (w) { w.a = 1.72; }); this.rise.x = 1; }
  else this.bits.forEach(function (b, i) {
    var a = i * 2.39996, up = 2.2 + 2.6 * ((i * 7) % 10) / 10, out = 0.5 + 1.3 * ((i * 3) % 10) / 10;
    b.mesh.visible = true; b.mesh.position.set(0, GROUND + 0.3, 0.05);
    b.v.set(Math.cos(a) * out, up, Math.sin(a) * out * 0.5); b.r.set(3 + i % 5, 2 + i % 7, 4 + i % 3);
  });
  if (this.onPop) this.onPop();
};
Gift.prototype.tick = function (dt) {
  var self = this, prev = this.T, T = (this.T += dt), c = (this.clock += dt), calm = this.orb.reduced;
  var at = function (x) { return prev < x && T >= x; }, roll = 0, squash = 0, hop = this.hop, l = this.lidAt, i;
  this.jolt *= decay(dt, 0.12);
  if (this.phase === "shut") {
    this.wait -= dt; this.rockT += dt;
    if (this.wait <= 0 && !calm) {
      this.wait = 1.8 + Math.random() * 2; this.rockT = 0; this.rockA = Math.random() < 0.5 ? -0.12 : 0.12;
      if (Math.random() < 0.5) { hop.v += 1.5; l.vy += 0.9; }
    }
    roll = this.rockA * Math.sin(this.rockT * TAU * 3) * Math.exp(-this.rockT * 2.6);
  } else if (this.phase === "shake") {
    roll = calm ? 0 : 0.035 * Math.sin(c * 40);
  } else if (this.phase === "open") {
    var grow = clamp(T / this.popAt, 0, 1);
    roll = (0.03 + 0.07 * grow) * Math.sin(c * 42) + this.jolt * 0.13 * Math.sin(c * 61);
    // one jolt for each rarity up to the one inside, and the light at the seam takes its color
    for (i = 0; i < this.tiers.length; i++) if (at(FIRST_JOLT + i * JOLT_EVERY)) {
      this.jolt = 1; hop.v += 1.3 + 0.25 * i; l.vy += 1.3 + 0.3 * i;
      this.light(this.tiers[i]);
    }
    this.seam.scale.y = 1 + 2.5 * this.jolt + 1.5 * grow;
    squash = -0.24 * smooth(this.popAt - 0.3, this.popAt - 0.04, T);
    if (at(this.popAt)) this.pop();
  }
  if (this.phase === "burst" || this.phase === "shown") {
    var since = T - this.popAt;
    roll = this.jolt * 0.1 * Math.sin(c * 55);
    if (!calm) {
      this.walls.forEach(function (w, n) {
        if (since < n * 0.05) return;
        for (var k = 0; k < 3; k++) { w.v += (-2 * 0.32 * 15 * w.v - 225 * (w.a - 1.72)) * dt / 3; w.a += w.v * dt / 3; }
      });
      this.bits.forEach(function (b) {
        if (!b.mesh.visible) return;
        b.v.y -= 4.4 * dt; b.v.multiplyScalar(decay(dt, 2.2));
        b.mesh.position.addScaledVector(b.v, dt);
        b.mesh.rotation.x += b.r.x * dt; b.mesh.rotation.y += b.r.y * dt; b.mesh.rotation.z += b.r.z * dt;
        if (b.mesh.position.y < -1.3 || since > 3.5) b.mesh.visible = false;
      });
      this.rings.forEach(function (r, n) {
        var k = (since - n * 0.13) / 0.75;
        r.visible = k > 0 && k < 1;
        if (r.visible) { var s = lerp(0.3, 0.72 + 0.11 * n, 1 - (1 - k) * (1 - k)); r.scale.set(s, s, 1 + 1.5 * (1 - k)); }
      });
      for (i = 0; i < 3; i++) { this.rise.v += (-2 * 0.5 * 9 * this.rise.v - 81 * (this.rise.x - 1)) * dt / 3; this.rise.x += this.rise.v * dt / 3; }
    }
    this.walls.forEach(function (w) { w.leaf.rotation.x = w.a; });
    var k = clamp(this.rise.x, 0, 1.4), sway = calm ? 0.3 : 0.55 * Math.sin(c * 1.3), size = this.size * lerp(0.15, 1, clamp(k, 0, 1.15));
    this.show.position.set(0, lerp(GROUND + 0.22, FLOAT, k) + (calm ? 0 : 0.025 * Math.sin(c * 2.1)), 0.15);
    this.show.rotation.set(0, sway, 0);
    this.show.scale.set(size, size, size);
    this.beam.scale.set(1 + (calm ? 0 : 0.06 * Math.sin(c * 5)), smooth(0, 0.22, since + (calm ? 1 : 0)), 1);
    // the rarer things have stars about them
    this.stars.forEach(function (s, n) {
      var a = n * TAU / 6 + c * 0.5, tw = 0.6 + 0.5 * Math.sin(c * 6 + n * 2.3);
      s.visible = self.tiers.length > 2 && since > 0.5;
      s.position.set(0.62 * Math.cos(a), FLOAT + 0.42 * Math.sin(a * 2 + n), 0.2);
      s.scale.set(tw, tw * 1.4, tw);
    });
    if (this.item) for (i = 0; i < this.item.ticks.length; i++) this.item.ticks[i](dt, c);
    if (this.phase === "burst" && since >= (calm ? 0 : SHOWN_AFTER)) { this.phase = "shown"; if (this.onShown) this.onShown(); }
  }
  // the lid: it hops with each jolt and lands again, until it is blown off for good
  l.vy -= (l.off ? 9 : 30) * dt; l.y += l.vy * dt;
  if (l.off) { l.x += l.vx * dt; l.r += l.vr * dt; if (l.y < -3) this.lid.visible = false; }
  else if (l.y < 0) { l.y = 0; l.vy = 0; }
  this.lid.position.set(l.x, 0.4 + l.y, 0);
  this.lid.rotation.set(l.r * 0.6, 0, l.r);
  hop.v -= 28 * dt; hop.y += hop.v * dt;
  if (hop.y < 0) { hop.y = 0; hop.v = 0; }
  this.place(roll, squash);
};
Gift.prototype.dispose = function () {
  var orb = this.orb;
  orb.scene.remove(this.stage);
  this.m.free();
  if (this.item) this.item.free();
  if (orb.worn && orb.worn.gift === this) orb.worn.gift = null;
  orb.hidden = false;
};
/* Show a box on this creature's stage, in its place, until the box is disposed of.
   `onPop` is called as it bursts, `onShown` once what was inside hangs in the light. */
function unwrap(orb, options) {
  var worn = wornOf(orb);
  if (worn.gift) worn.gift.dispose();
  orb.hidden = true;
  return (worn.gift = new Gift(orb, options));
}

return { SLOTS: SLOTS, ITEMS: ITEMS, dress: dress, strip: strip, audit: audit, unwrap: unwrap };
}

export { AgentOrbWardrobe }
