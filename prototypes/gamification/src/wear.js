/* Things a creature can wear, for the gamification mock-up: a hundred of them, in four places
   (on the head, over the eyes, on the face, round the neck) and five rarities. Each is a few
   low-poly shapes hung on the creature's body, so it moves, squashes and turns with it, and is
   drawn at the same low resolution with the same snapped vertices, flat tones and dither.

   Wear.dress(orb, { hat, glasses, face, neck })   put these on, in place of whatever it wore
   Wear.strip(orb)                                 take everything off and free it
   Wear.audit(orb)                                 how far the deepest thing sits inside its body
   Wear.ITEMS, Wear.SLOTS, Wear.RARITIES           what there is

   Nothing is placed by a fixed number. Every creature is grown from a seed, so each thing is
   fitted to the body it is put on, in one of three ways:
   - a stiff hat is lowered onto the head until some part of its underside touches (Maker.hat);
   - a soft one (a beanie, a scarf, a beard) is made out of the skin itself, lifted a little
     (Maker.shell, Maker.patch);
   - anything else stands off a point of the skin (Maker.at, Maker.face).
   Ears, a horn or an antenna in a hat's way fold out from under it or go under it (Maker.clear).

   This is a mock-up's shortcut: it reads the orb's own uniforms (the body's shape, where the eyes
   are) and wraps its update. Built for real, this belongs inside packages/mascot. */
var Wear = (function () {
"use strict";
var THREE = window.THREE;
if (!THREE) return null;
var TAU = Math.PI * 2, HALF = Math.PI / 2;
var FRONT = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);
var SLOTS = ["hat", "glasses", "face", "neck"];
var RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];
var C = "common", U = "uncommon", R = "rare", E = "epic", L = "legendary";
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
Maker.prototype.mesh = function (geo, color, o) {
  o = o || {};
  var u = this.orb.uB;
  var mat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(color) }, uPlain: { value: o.plain ? 1 : 0 }, uDoor: { value: o.door ? 1 : 0 }, uSnap: u.uSnap, uFade: u.uFade },
    vertexShader: VERT, fragmentShader: FRAG, extensions: { derivatives: true }, transparent: true, side: THREE.DoubleSide
  });
  var m = new THREE.Mesh(geo, mat);
  // after the body, before its rings and motes
  m.renderOrder = 1.5; m.frustumCulled = false;
  // soft: meant to go into the skin (a lining, the root of a horn), so not counted as sunk into it
  m.userData.soft = !!o.soft;
  (o.in || this.root).add(m);
  this.trash.push(geo, mat);
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
    try { verts = Wear.core.Stage.body(o.css < 40 ? Math.min(g.poly, 2) : o.css < 100 ? Math.min(g.poly, 3) : g.poly).userData.body; } catch (e) { verts = null; }
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

var ITEMS = {}, ORDER = [];
function item(id, slot, name, rarity, make) { ITEMS[id] = { id: id, slot: slot, name: name, rarity: rarity, make: make }; ORDER.push(id); }

/* ================= on the head (41) =================
   A stiff hat is open underneath, like a real one: a brim is a ring and a crown has no floor, so
   that the top of the head can be inside the hat without being inside any part of it. */
function partyHat(id, name, rar, c1, c2) {
  item(id, "hat", name, rar, function (m) {
    var h = m.hat({ r: 0.32, R: 0.42, dome: 0.64, cone: true, tall: 0.86, tilt: -0.16, liner: c2 });
    m.mesh(lathe([[0.36, 0], [0.02, 0.72], [0, 0.72]], 10), c1, { in: h });
    put(m.mesh(tor(0.37, 0.05, null, 12), c2, { in: h }), 0, 0.05, 0, HALF);
    put(m.mesh(ico(0.1), c2, { in: h }), 0, 0.76, 0);
  });
}
function beanie(id, name, rar, c1, c2, stripes) {
  item(id, "hat", name, rar, function (m) {
    var a = m.capTo(1.0), p = m.at(0, 0, 0.19);
    if (stripes) { m.shell(0, a * 0.5, 0.075, c1); m.shell(a * 0.5, a, 0.075, c2); } else m.shell(0, a, 0.075, c1);
    m.shell(a - 0.14, a + 0.04, puff(0.03, 0.14), stripes ? c1 : c2, { rows: 2 });
    put(m.mesh(ico(stripes ? 0.2 : 0.14), c2), p.x, p.y + (stripes ? 0.1 : 0.04), p.z);
    m.top = Math.max(m.top, p.y + 0.3);
  });
}
function cap(id, name, rar, c1, c2, back) {
  item(id, "hat", name, rar, function (m) {
    var a = m.capTo(0.8), s = back ? -1 : 1, p = m.at(a - 0.05, back ? Math.PI : 0, 0.08), t = m.at(0, 0, 0.13);
    m.shell(0, a, 0.075, c1);
    put(m.mesh(box(0.54, 0.05, 0.34), c2), p.x, p.y - 0.01, p.z + s * 0.2, s * 0.28);
    put(m.mesh(ico(0.05), c2), t.x, t.y, t.z);
  });
}
function crown(id, name, rar, c, jewel) {
  item(id, "hat", name, rar, function (m) {
    var h = m.hat({ r: 0.33, R: 0.44, cav: function (rho) { return rho < 0.24 ? Infinity : 0.2; }, tall: 0.44, tilt: 0.1, liner: c });
    put(m.mesh(cyl(0.37, 0.34, 0.2, 10, true), c, { in: h }), 0, 0.1, 0);
    for (var i = 0; i < 5; i++) { var a = i * TAU / 5; put(m.mesh(cone(0.09, 0.2), c, { in: h }), 0.35 * Math.sin(a), 0.3, 0.35 * Math.cos(a)); }
    if (jewel) put(m.mesh(ico(0.065), jewel, { in: h }), 0, 0.1, 0.4);
  });
}
partyHat("party", "Party hat", C, PINK, YEL);
partyHat("party2", "Teal party hat", C, TEAL, WHITE);
beanie("beanie", "Beanie", C, "#d9534f", WHITE);
beanie("beanie2", "Blue beanie", C, BLUE, YEL);
beanie("bobble", "Bobble hat", C, GREEN, WHITE, true);
item("sprout", "hat", "Sprout", C, function (m) {
  m.bare();
  var g = m.group(), p = m.surf(0, 1, 0);
  g.position.set(p.x, p.y - 0.03, p.z);
  put(m.mesh(cyl(0.035, 0.035, 0.3, 4), "#4faa3c", { in: g, soft: true }), 0, 0.15, 0);
  [-1, 1].forEach(function (s) { put(m.mesh(ico(0.17), "#86e052", { in: g }), s * 0.17, 0.32, 0, 0, 0, s * 0.5).scale.set(1.35, 0.4, 0.8); });
  m.ticks.push(function (dt, t) { g.rotation.z = 0.12 * Math.sin(t * 1.7); });
  m.top = Math.max(m.top, p.y + 0.5);
});
item("cone", "hat", "Traffic cone", C, function (m) {
  var h = m.hat({ r: 0.35, R: 0.64, cav: function (rho) { return 0.07 + 0.78 * (1 - rho / 0.35); }, tall: 0.95, tilt: 0.08, liner: "#c9560a" });
  put(m.mesh(lathe([[0.52, 0], [0.64, 0], [0.64, 0.07], [0.52, 0.07]], 4), ORANGE, { in: h }), 0, 0, 0, 0, Math.PI / 4);
  put(m.mesh(lathe([[0.38, 0], [0.07, 0.85], [0, 0.85]], 8), ORANGE, { in: h }), 0, 0.07, 0);
  put(m.mesh(cyl(0.192, 0.264, 0.2, 8, true), WHITE, { in: h }), 0, 0.52, 0);
});
cap("cap", "Cap", C, RED, WHITE);
cap("backcap", "Backwards cap", C, BLUE, INK, true);
item("beret", "hat", "Beret", C, function (m) {
  var a = m.capTo(0.72), p = m.at(0, 0, 0.1);
  m.shell(0, a, function (t) { return 0.06 + 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.15)); }, "#a8323e", { rows: 4 });
  put(m.mesh(cyl(0.025, 0.025, 0.1, 4), "#a8323e"), p.x, p.y + 0.04, p.z);
});
item("bow", "hat", "Bow", C, function (m) {
  var h = m.hat({ R: 0.42, tall: 0.4, lean: 0.12 });
  [-1, 1].forEach(function (s) { put(m.mesh(cone(0.2, 0.3), PINK, { in: h }), s * 0.2, 0.2, 0, 0, 0, s * HALF).scale.z = 0.6; });
  put(m.mesh(box(0.12, 0.16, 0.12), "#c93d77", { in: h }), 0, 0.2, 0);
});
item("paperhat", "hat", "Paper hat", C, function (m) {
  var h = m.hat({ r: 0.24, R: 0.52, dome: 0.4, cone: true, tall: 0.48, liner: "#cfcabb" });
  put(m.mesh(lathe([[0.5, 0], [0.02, 0.44], [0, 0.44]], 4), WHITE, { in: h }), 0, 0, 0, 0, Math.PI / 4).scale.z = 0.72;
  put(m.mesh(lathe([[0.52, 0], [0.43, 0.09]], 4), STEEL, { in: h }), 0, 0, 0, 0, Math.PI / 4).scale.z = 0.74;
});
item("bucket", "hat", "Bucket hat", C, function (m) {
  var h = m.hat({ r: 0.4, R: 0.66, cav: function (rho) { return rho < 0.32 ? 0.46 : rho < 0.4 ? 0.16 : 0.16 * (0.66 - rho) / 0.26; }, tall: 0.5, tilt: -0.08, liner: "#5e7d49" });
  put(m.mesh(cyl(0.42, 0.66, 0.16, 10, true), "#8fb573", { in: h }), 0, 0.08, 0);
  m.mesh(lathe([[0.42, 0.16], [0.34, 0.46], [0, 0.46]], 10), "#8fb573", { in: h });
});
item("straw", "hat", "Straw hat", C, function (m) {
  var h = m.hat({ r: 0.4, R: 0.74, dome: 0.33, tall: 0.36, tilt: 0.1, liner: "#b89b55" });
  m.mesh(lathe([[0.42, 0], [0.74, 0], [0.74, 0.05], [0.42, 0.05]], 12), "#e8cf8a", { in: h });
  m.mesh(lathe([[0.42, 0.05], [0.4, 0.33], [0, 0.33]], 10), "#e8cf8a", { in: h });
  put(m.mesh(cyl(0.435, 0.435, 0.09, 10, true), RED, { in: h }), 0, 0.11, 0);
});
item("sweatband", "hat", "Sweatband", C, function (m) {
  m.shell(m.brow - 0.24, m.brow - 0.04, puff(0.04, 0.1), RED, { rows: 2 });
  m.shell(m.brow - 0.17, m.brow - 0.11, 0.105, WHITE, { rows: 1 });
});
crown("papercrown", "Paper crown", C, ROSE);
item("eggshell", "hat", "Eggshell", C, function (m) {
  var a = m.capTo(0.84);
  m.shell(0, a - 0.1, 0.08, "#f6f1e4", { rows: 3, zig: 0.1 });
});
item("tophat", "hat", "Top hat", U, function (m) {
  var h = m.hat({ r: 0.4, R: 0.66, dome: 0.61, tall: 0.62, tilt: 0.12, liner: "#2b2e3a" });
  m.mesh(lathe([[0.44, 0], [0.66, 0], [0.66, 0.06], [0.44, 0.06]], 10), DARK, { in: h });
  m.mesh(lathe([[0.44, 0.06], [0.42, 0.61], [0, 0.61]], 10), DARK, { in: h });
  put(m.mesh(cyl(0.46, 0.46, 0.12, 10, true), TEAL, { in: h }), 0, 0.15, 0);
});
item("bowler", "hat", "Bowler", U, function (m) {
  var h = m.hat({ r: 0.4, R: 0.62, cav: function (rho) { return 0.05 + 0.34 * Math.sqrt(Math.max(0, 1 - rho * rho / 0.16)); }, tall: 0.46, tilt: -0.1, liner: "#2b2e3a" });
  m.mesh(lathe([[0.42, 0], [0.62, 0], [0.62, 0.05], [0.42, 0.05]], 10), DARK, { in: h });
  put(m.mesh(ball(0.42), DARK, { in: h }), 0, 0.05, 0).scale.y = 0.9;
  put(m.mesh(cyl(0.435, 0.435, 0.08, 10, true), STEEL, { in: h }), 0, 0.1, 0);
});
item("cowboy", "hat", "Cowboy hat", U, function (m) {
  var h = m.hat({ r: 0.31, R: 0.84, cav: function (rho) { return rho < 0.2 ? 0.44 : 0.44 * (0.31 - rho) / 0.11; }, tall: 0.5, tilt: 0.08, liner: "#7d5430" });
  put(m.mesh(cyl(0.84, 0.56, 0.14, 10, true), "#b07a48", { in: h }), 0, 0.07, 0);
  m.mesh(lathe([[0.36, 0], [0.56, 0]], 10), "#b07a48", { in: h });
  m.mesh(lathe([[0.4, 0], [0.27, 0.44], [0, 0.44]], 8), "#b07a48", { in: h }).scale.z = 0.85;
  put(m.mesh(cyl(0.385, 0.41, 0.07, 8, true), "#5a3a20", { in: h }), 0, 0.045, 0).scale.z = 0.85;
});
item("fez", "hat", "Fez", U, function (m) {
  var h = m.hat({ r: 0.32, R: 0.36, cav: function (rho) { return rho < 0.24 ? 0.42 : 0.42 * (0.32 - rho) / 0.08; }, tall: 0.46, tilt: 0.14, liner: "#8f1d2a" });
  m.mesh(lathe([[0.34, 0], [0.26, 0.42], [0, 0.42]], 10), "#c62b3b", { in: h });
  put(m.mesh(box(0.3, 0.03, 0.03), GOLD, { in: h }), 0.15, 0.435, 0);
  put(m.mesh(box(0.035, 0.22, 0.035), GOLD, { in: h }), 0.31, 0.33, 0);
  put(m.mesh(ico(0.05), GOLD, { in: h }), 0.31, 0.2, 0);
});
item("chef", "hat", "Chef's hat", U, function (m) {
  var h = m.hat({ r: 0.34, R: 0.38, dome: 0.22, tall: 0.86, tilt: -0.08, liner: "#cfcabb" });
  put(m.mesh(cyl(0.36, 0.36, 0.34, 10, true), WHITE, { in: h }), 0, 0.17, 0);
  put(m.mesh(ico(0.47), WHITE, { in: h }), 0, 0.54, 0).scale.y = 0.68;
});
item("hardhat", "hat", "Hard hat", U, function (m) {
  var a = m.capTo(0.86), p = m.at(0, 0, 0.13);
  m.shell(0, a, 0.09, YEL);
  m.shell(a - 0.05, a + 0.06, puff(0.07, 0.2), YEL, { rows: 2, az0: -1.1, az1: 1.1, seg: 6 });
  put(m.mesh(box(0.1, 0.06, 0.5), "#e0b020"), p.x, p.y + 0.03, p.z);
});
item("headphones", "hat", "Headphones", U, function (m) {
  m.clear(1, true);
  var pos = [], idx = [], n = 12, i;
  for (i = 0; i <= n; i++) { var t = -1.4 + 2.8 * i / n, p = m.surf(Math.sin(t), Math.cos(t), 0, 0.1); pos.push(p.x, p.y, p.z + 0.08, p.x, p.y, p.z - 0.08); m.top = Math.max(m.top, p.y); }
  for (i = 0; i < n; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
  var geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  m.mesh(geo, DARK);
  [-1, 1].forEach(function (s) {
    var c = m.surf(s, 0.12, 0, 0.12), g = m.group();
    g.position.set(c.x + s * 0.06, c.y, c.z);
    put(m.mesh(cyl(0.27, 0.27, 0.17, 8), TEAL, { in: g }), 0, 0, 0, 0, 0, HALF);
    put(m.mesh(cyl(0.19, 0.19, 0.06, 8), DARK, { in: g }), s * 0.1, 0, 0, 0, 0, HALF);
    m.wide = Math.max(m.wide, Math.abs(c.x) + 0.3);
  });
});
item("mortarboard", "hat", "Mortarboard", U, function (m) {
  var h = m.hat({ r: 0.34, R: 0.4, dome: 0.17, tall: 0.26, tilt: 0.1, liner: "#1d2028" });
  m.mesh(lathe([[0.38, 0], [0.36, 0.17]], 10), "#2f3340", { in: h });
  put(m.mesh(box(0.86, 0.04, 0.86), "#2f3340", { in: h }), 0, 0.19, 0, 0, Math.PI / 4);
  put(m.mesh(box(0.4, 0.025, 0.025), YEL, { in: h }), 0.2, 0.225, 0.1, 0, -0.5);
  put(m.mesh(box(0.035, 0.2, 0.035), YEL, { in: h }), 0.4, 0.13, 0.2);
});
item("daisy", "hat", "Daisy", U, function (m) {
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
item("catears", "hat", "Cat ears", U, function (m) {
  pair(m, 0.6, function (g, s) {
    g.rotation.z = -s * 0.45;
    put(m.mesh(cone(0.22, 0.36), "#3a3f4f", { in: g, soft: true }), 0, 0.16, 0).scale.z = 0.7;
    put(m.mesh(cone(0.12, 0.22), ROSE, { in: g, soft: true }), 0, 0.13, 0.09).scale.z = 0.5;
  });
});
item("devilhorns", "hat", "Little horns", U, function (m) {
  pair(m, 0.52, function (g, s) {
    g.rotation.z = -s * 0.3;
    put(m.mesh(cyl(0.06, 0.1, 0.16, 5), RED, { in: g, soft: true }), 0, 0.07, 0);
    put(m.mesh(cone(0.06, 0.18, 5), RED, { in: g, soft: true }), -s * 0.03, 0.23, 0, 0, 0, s * 0.35);
  });
});
item("wizard", "hat", "Wizard hat", R, function (m) {
  var h = m.hat({ r: 0.4, R: 0.78, cav: function (rho) { return rho < 0.18 ? 0.5 : 0.05 + 0.45 * (0.4 - rho) / 0.22; }, tall: 0.95, tilt: -0.1, liner: "#4a31a3" });
  m.mesh(lathe([[0.44, 0], [0.78, 0], [0.78, 0.05], [0.44, 0.05]], 10), PURPLE, { in: h });
  put(m.mesh(cyl(0.2, 0.44, 0.5, 7, true), PURPLE, { in: h }), 0, 0.3, 0);
  put(m.mesh(cyl(0.01, 0.21, 0.42, 7), PURPLE, { in: h }), 0.07, 0.74, 0, 0, 0, -0.35);
  put(m.mesh(cyl(0.455, 0.47, 0.09, 7, true), YEL, { in: h }), 0, 0.1, 0);
  put(m.mesh(ico(0.07), YEL, { in: h }), 0.15, 0.94, 0);
});
item("propeller", "hat", "Propeller cap", R, function (m) {
  var a = m.capTo(0.7), p = m.at(0, 0, 0.08), cols = [RED, YEL, BLUE, GREEN], blades = m.group();
  for (var i = 0; i < 4; i++) m.shell(0, a, 0.075, cols[i], { az0: i * HALF, az1: (i + 1) * HALF, seg: 3 });
  put(m.mesh(cyl(0.035, 0.035, 0.16, 4), YEL, { soft: true }), p.x, p.y + 0.07, p.z);
  blades.position.set(p.x, p.y + 0.17, p.z);
  m.mesh(box(0.7, 0.035, 0.13), YEL, { in: blades });
  m.ticks.push(function (dt) { blades.rotation.y += dt * 9; });
  m.top = Math.max(m.top, p.y + 0.22);
});
item("viking", "hat", "Viking helmet", R, function (m) {
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
item("santa", "hat", "Santa hat", R, function (m) {
  var h = m.hat({ r: 0.33, R: 0.52, cav: function (rho) { return rho < 0.19 ? 0.5 : 0.09 + 0.4 * (0.33 - rho) / 0.14; }, tall: 0.8, tilt: 0.1, liner: WHITE });
  put(m.mesh(tor(0.43, 0.09, null, 12), WHITE, { in: h }), 0, 0.09, 0, HALF);
  put(m.mesh(cyl(0.22, 0.42, 0.42, 8, true), RED, { in: h }), 0, 0.3, 0);
  put(m.mesh(cyl(0.03, 0.23, 0.42, 8), RED, { in: h }), 0.17, 0.61, 0, 0, 0, -0.95);
  put(m.mesh(ico(0.1), WHITE, { in: h }), 0.38, 0.72, 0);
});
item("bunny", "hat", "Bunny ears", R, function (m) {
  pair(m, 0.36, function (g, s) {
    g.rotation.z = -s * 0.16;
    put(m.mesh(ico(0.15), WHITE, { in: g, soft: true }), 0, 0.42, 0).scale.set(1, 3, 0.55);
    put(m.mesh(ico(0.08), ROSE, { in: g, soft: true }), 0, 0.44, 0.06).scale.set(1, 3.6, 0.4);
    if (s > 0) m.ticks.push(function (dt, t) { g.rotation.z = -0.16 - 0.5 * Math.max(0, Math.sin(t * 0.9) - 0.8); });
    m.top = Math.max(m.top, g.position.y + 0.9);
  });
});
item("mushroom", "hat", "Mushroom cap", R, function (m) {
  var h = m.hat({ r: 0.82, R: 0.88, cav: function (rho) { return 0.5 * Math.sqrt(Math.max(0, 1 - rho * rho / 0.6724)) - 0.02; }, tall: 0.54, tilt: 0.06 });
  m.mesh(ball(0.86), "#e23b3b", { in: h }).scale.y = 0.6;
  [[0, 0.5, 0.1, 0.13], [0.5, 0.33, 0.35, 0.11], [-0.45, 0.36, 0.4, 0.1], [0.1, 0.2, 0.78, 0.09], [-0.55, 0.3, -0.3, 0.1], [0.55, 0.3, -0.35, 0.1]].forEach(function (s) {
    put(m.mesh(ico(s[3]), WHITE, { in: h, soft: true }), s[0], s[1], s[2]).scale.y = 0.5;
  });
  m.wide = Math.max(m.wide, 0.9);
});
item("frog", "hat", "Frog hat", R, function (m) {
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
crown("crown", "Crown", E, GOLD, RED);
item("halo", "hat", "Halo", E, function (m) {
  var y = m.peak() + 0.26, ring = put(m.mesh(tor(0.4, 0.055, null, 10), "#ffd95a"), 0, y, 0, HALF - 0.22);
  m.stay(ring);
  m.ticks.push(function (dt, t) { ring.position.y = y + 0.035 * Math.sin(t * 2.2); });
  m.top = Math.max(m.top, y + 0.14);
});
item("cloud", "hat", "Rain cloud", E, function (m) {
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
item("spacehelmet", "hat", "Space helmet", E, function (m) {
  var top = m.peak(), low = m.surf(0, -1, 0).y, cy = (top + low) / 2 + 0.06, Rb = top - cy + 0.14;
  for (var a = 0.1; a < 3.1; a += 0.1) for (var i = 0; i < 16; i++) { var p = m.at(a, i * TAU / 16); Rb = Math.max(Rb, Math.sqrt(p.x * p.x + (p.y - cy) * (p.y - cy) + p.z * p.z) + 0.14); }
  m.stay(put(m.mesh(tor(Rb, 0.035, null, 20), "#d7efff"), 0, cy, 0));
  m.stay(put(m.mesh(new THREE.SphereGeometry(Rb, 5, 3, 0.45, 0.75, 0.55, 0.6), WHITE, { plain: true, door: true }), 0, cy, 0));
  var cut = Math.acos(clamp((low + 0.2 - cy) / Rb, -1, 1));
  m.stay(put(m.mesh(tor(Rb * Math.sin(cut), 0.09, null, 14), STEEL), 0, cy + Rb * Math.cos(cut), 0, HALF));
  m.top = Math.max(m.top, cy + Rb + 0.04); m.wide = Math.max(m.wide, Rb + 0.06);
});
item("ufo", "hat", "Visitor", L, function (m) {
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
item("starcrown", "hat", "Crown of stars", L, function (m) {
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
function frames(id, name, rar, color, sq, t) {
  item(id, "glasses", name, rar, function (m) {
    both(m, function (l) { m.mesh(sq ? square(t || 0.2) : tor(1, t || 0.2, null, 10), color, { in: l.g }).scale.set(l.rx * (sq ? 1.32 : 1), l.ry * (sq ? 1.25 : 1), l.rx); });
    bridge(m, color);
  });
}
frames("round", "Round glasses", C, INK);
frames("wire", "Wire rims", C, GOLD, false, 0.12);
frames("square", "Square glasses", C, "#c8452f", true);
frames("thick", "Thick frames", C, INK, true, 0.3);
item("halfmoon", "glasses", "Half-moons", C, function (m) {
  both(m, function (l) { put(m.mesh(tor(1, 0.16, Math.PI, 8), GOLD, { in: l.g }), 0, -l.ry * 0.25, 0, 0, 0, Math.PI).scale.set(l.rx, l.ry * 0.8, l.rx); });
  bridge(m, GOLD, -0.08);
});
item("sleepmask", "glasses", "Sleep mask", C, function (m) {
  var e = m.eye, w = Math.max(e.x, e.a + 0.09) + e.a + 0.12, h = e.b + 0.07;
  m.patch(function (u, v) { var x = (u * 2 - 1) * w, k = 1 - 0.35 * Math.pow(Math.abs(u * 2 - 1), 3); return [x, e.y + (v * 2 - 1) * h * k, 0.06]; }, "#5b4bb5", { n: 6 });
  [-1, 1].forEach(function (s) { var g = m.onFace(s * Math.max(e.x, e.a + 0.09), e.y - 0.02, 0.08, 0.6); put(m.mesh(tor(0.09, 0.022, Math.PI, 5), "#cfc7ff", { in: g, plain: true }), 0, 0, 0, 0, 0, Math.PI); });
  strap(m, "#3f338a");
});
item("shades", "glasses", "Shades", C, function (m) {
  both(m, function (l) {
    m.mesh(disc(1), "#14161b", { in: l.g, plain: true }).scale.set(l.rx * 1.15, l.ry, 1);
    put(m.mesh(new THREE.PlaneGeometry(0.5, 0.16), "#5d6678", { in: l.g, plain: true }), -0.07 * 1.15, l.ry * 0.3, 0.015, 0, 0, 0.7).scale.set(l.rx * 1.6, l.rx * 1.6, 1);
  });
  bridge(m, "#14161b");
});
item("eyepatch", "glasses", "Eye patch", C, function (m) {
  var l = lens(m, 1);
  m.mesh(disc(1, 7), "#14161b", { in: l.g, plain: true }).scale.set(l.rx * 1.1, l.ry * 1.05, 1);
  strap(m, "#14161b", 0.035);
  var e = m.eye, p = m.face(0, e.y + 0.02, 0.07);
  put(m.mesh(box(Math.max(0.12, 2 * (l.cx - l.rx) + 0.3), 0.05, 0.03), "#14161b"), p.x - 0.1, p.y, p.z);
});
item("aviators", "glasses", "Aviators", U, function (m) {
  both(m, function (l) {
    m.mesh(disc(1, 7), "#6b4a2a", { in: l.g, plain: true, door: true }).scale.set(l.rx * 1.18, l.ry * 1.05, 1);
    m.mesh(tor(1, 0.1, null, 7), GOLD, { in: l.g }).scale.set(l.rx * 1.2, l.ry * 1.07, l.rx);
  });
  bridge(m, GOLD, 0.02); bridge(m, GOLD, 0.11);
});
item("monocle", "glasses", "Monocle", U, function (m) {
  var l = lens(m, 1);
  m.mesh(tor(1, 0.2, null, 10), GOLD, { in: l.g }).scale.set(l.rx, l.ry, l.rx);
  put(m.mesh(box(0.035, 0.5, 0.035), GOLD, { in: l.g }), l.rx * 0.85, -l.ry - 0.2, 0);
});
item("threed", "glasses", "3D glasses", U, function (m) {
  both(m, function (l) {
    m.mesh(square(0.24), WHITE, { in: l.g }).scale.set(l.rx * 1.36, l.ry * 1.28, l.rx);
    put(m.mesh(new THREE.PlaneGeometry(1.8, 1.7), l.s < 0 ? "#ff3b4e" : "#27d3e6", { in: l.g, plain: true, door: true }), 0, 0, -0.01).scale.set(l.rx, l.ry, 1);
  });
  bridge(m, WHITE);
});
item("hearts", "glasses", "Heart shades", U, function (m) {
  both(m, function (l) { var k = Math.max(l.rx, l.ry) * 1.15; m.mesh(heart(k), "#ff4d7e", { in: l.g, plain: true }); put(m.mesh(disc(k * 0.16, 5), "#ffc2d4", { in: l.g, plain: true }), -k * 0.45, k * 0.45, 0.012); });
  bridge(m, "#ff4d7e");
});
item("cateye", "glasses", "Cat-eye glasses", U, function (m) {
  both(m, function (l) {
    m.mesh(square(0.2), TEAL, { in: l.g }).scale.set(l.rx * 1.32, l.ry * 1.15, l.rx);
    put(m.mesh(cone(0.07, 0.2), TEAL, { in: l.g }), l.s * l.rx * 1.05, l.ry * 0.95, 0, 0, 0, -l.s * 0.8);
  });
  bridge(m, TEAL);
});
item("shutter", "glasses", "Shutter shades", U, function (m) {
  both(m, function (l) {
    m.mesh(square(0.16), "#ff4fd8", { in: l.g }).scale.set(l.rx * 1.36, l.ry * 1.2, l.rx);
    for (var i = -1; i <= 1; i++) put(m.mesh(box(l.rx * 1.9, l.ry * 0.2, 0.03), "#ff4fd8", { in: l.g }), 0, i * l.ry * 0.5, 0);
  });
  bridge(m, "#ff4fd8");
});
function visor(id, name, rar, color, holo) {
  item(id, "glasses", name, rar, function (m) {
    var e = m.eye, p = m.face(0, e.y, 0.1), Rv = p.z, h = 2 * e.b + 0.14, a = 1.15;
    var glass = m.stay(put(m.mesh(cyl(Rv, Rv, h, 10, true, -a, 2 * a), color, { plain: true, door: true }), 0, p.y, 0));
    [-1, 1].forEach(function (s) { m.stay(put(m.mesh(cyl(Rv + 0.012, Rv + 0.012, 0.055, 10, true, -a, 2 * a), INK), 0, p.y + s * h / 2, 0)); });
    if (holo) m.ticks.push(function (dt, t) { glass.material.uniforms.uCol.value.setHSL((t * 0.25) % 1, 0.9, 0.62); });
  });
}
visor("visor", "Visor", R, "#35d0c0");
item("stars", "glasses", "Star shades", R, function (m) {
  both(m, function (l) { var k = Math.max(l.rx, l.ry) * 1.3; m.mesh(star(k), YEL, { in: l.g, plain: true }); put(m.mesh(star(k * 0.55), "#fff3a0", { in: l.g, plain: true, door: true }), 0, 0, 0.012); });
  bridge(m, YEL);
});
item("pixel", "glasses", "Pixel shades", R, function (m) {
  var e = m.eye, cx = Math.max(e.x, e.a + 0.09), w = cx + e.a + 0.14, p = m.face(0, e.y, 0.11), u = 0.075, g = m.group();
  g.position.set(p.x, p.y, p.z);
  put(m.mesh(box(2 * w, u, 0.04), "#14161b", { in: g, plain: true }), 0, e.b * 0.6, 0);
  [-1, 1].forEach(function (s) {
    [[1, 0], [0.74, 1], [0.44, 2]].forEach(function (r) { put(m.mesh(box((e.a * 2 + 0.16) * r[0], u, 0.04), "#14161b", { in: g, plain: true }), s * cx, e.b * 0.6 - u * (r[1] + 1), 0); });
    put(m.mesh(box(u * 0.9, u * 0.9, 0.045), WHITE, { in: g, plain: true }), s * cx - e.a * 0.5, e.b * 0.6 - u, 0);
  });
});
item("goggles", "glasses", "Goggles", R, function (m) {
  strap(m, "#3a3f4f", 0.07);
  both(m, function (l) {
    m.mesh(disc(1, 8), "#7fe3ff", { in: l.g, plain: true, door: true }).scale.set(l.rx * 1.05, l.ry * 1.05, 1);
    m.mesh(tor(1, 0.3, null, 8), ORANGE, { in: l.g }).scale.set(l.rx * 1.12, l.ry * 1.12, l.rx * 1.4);
  });
  bridge(m, "#3a3f4f");
});
item("vr", "glasses", "Headset", R, function (m) {
  var e = m.eye, w = 2 * (Math.max(e.x, e.a + 0.09) + e.a) + 0.2, h = 2 * e.b + 0.16, p = m.face(0, e.y, 0.03);
  strap(m, "#3a3f4f", 0.06);
  put(m.mesh(box(w, h, 0.3), WHITE), p.x, p.y, p.z + 0.15);
  put(m.mesh(box(w * 0.8, h * 0.55, 0.02), "#14161b", { plain: true }), p.x, p.y, p.z + 0.31);
  var led = put(m.mesh(box(0.05, 0.05, 0.02), GREEN, { plain: true }), p.x + w * 0.42, p.y + h * 0.36, p.z + 0.31);
  m.ticks.push(function (dt, t) { led.visible = t % 1.4 < 1; });
});
visor("holo", "Holo visor", E, "#ff66cc", true);

/* ================= on the face (20) ================= */
function cheeks(m, fn) { var e = m.eye; [-1, 1].forEach(function (s) { fn(m.onFace(s * (e.x + e.a * 0.9), e.y - e.b - 0.06, 0.04, 1), s); }); }
function nose(m, out) { var e = m.eye; return m.face(0, e.y - e.b * 0.8, out == null ? 0.05 : out); }
item("blush", "face", "Rosy cheeks", C, function (m) { cheeks(m, function (g) { m.mesh(disc(0.1), ROSE, { in: g, plain: true }).scale.x = 1.35; }); });
item("freckles", "face", "Freckles", C, function (m) {
  cheeks(m, function (g) { [[-0.07, 0.03], [0.06, 0.04], [0, -0.04]].forEach(function (d) { put(m.mesh(disc(0.034, 4), "#8a5a34", { in: g, plain: true }), d[0], d[1], 0); }); });
});
item("nose", "face", "Red nose", C, function (m) { var p = nose(m, 0.1); put(m.mesh(ico(0.09), RED), p.x, p.y, p.z); });
function tache(id, name, rar, color, curl) {
  item(id, "face", name, rar, function (m) {
    var p = m.face(0, m.mouthY + 0.075, 0.06);
    [-1, 1].forEach(function (s) {
      put(m.mesh(cone(0.07, 0.3), color), p.x + s * 0.15, p.y - 0.01 + (curl ? 0.02 : 0), p.z, 0, 0, -s * (HALF + (curl ? -0.45 : 0.3))).scale.z = 0.6;
      if (curl) put(m.mesh(ico(0.045), color), p.x + s * 0.3, p.y + 0.09, p.z);
    });
  });
}
tache("moustache", "Moustache", C, "#4a3426");
item("bandage", "face", "Plaster", C, function (m) {
  var g = m.onFace(-0.4, 0.5, 0.04, 1);
  [-1, 1].forEach(function (s) { put(m.mesh(box(0.34, 0.11, 0.03), "#f1d9b5", { in: g, plain: true }), 0, 0, 0, 0, 0, s * Math.PI / 4); });
});
item("sweat", "face", "Sweat drop", C, function (m) {
  var e = m.eye, g = m.group(), p = m.face(0.6, e.y + e.b + 0.1, 0.09);
  g.position.copy(p);
  m.mesh(ico(0.075), SKY, { in: g });
  put(m.mesh(cone(0.06, 0.13, 5), SKY, { in: g }), 0, 0.09, 0);
  m.ticks.push(function (dt, t) { g.position.y = p.y - 0.05 * ((t * 0.5) % 1); });
});
item("starsticker", "face", "Star sticker", C, function (m) { var e = m.eye, g = m.onFace(-(e.x + e.a * 0.9), e.y - e.b - 0.08, 0.04, 1); m.mesh(star(0.13), YEL, { in: g, plain: true }).rotation.z = 0.2; });
item("heartsticker", "face", "Heart sticker", C, function (m) { var e = m.eye, g = m.onFace(e.x + e.a * 0.9, e.y - e.b - 0.08, 0.04, 1); m.mesh(heart(0.1), "#ff4d7e", { in: g, plain: true }).rotation.z = -0.2; });
item("brows", "face", "Bushy brows", C, function (m) {
  var e = m.eye;
  [-1, 1].forEach(function (s) { var g = m.onFace(s * e.x, e.y + e.b + 0.09, 0.05, 0.9); m.mesh(box(e.a * 1.7, 0.075, 0.04), "#3a2a20", { in: g }).rotation.z = -s * 0.22; });
});
item("buckteeth", "face", "Buck teeth", C, function (m) {
  var g = m.onFace(0, m.mouthY - 0.055, 0.04, 0.8);
  [-1, 1].forEach(function (s) { put(m.mesh(box(0.06, 0.09, 0.03), WHITE, { in: g, plain: true }), s * 0.034, 0, 0); });
});
item("carrot", "face", "Carrot nose", U, function (m) { var p = nose(m, 0); put(m.mesh(cone(0.075, 0.42, 6), ORANGE, { soft: true }), p.x, p.y, p.z + 0.19, HALF); });
item("snout", "face", "Snout", U, function (m) {
  var p = nose(m, 0.01);
  put(m.mesh(cyl(0.13, 0.14, 0.12, 8), ROSE, { soft: true }), p.x, p.y, p.z + 0.05, HALF).scale.x = 1.2;
  [-1, 1].forEach(function (s) { put(m.mesh(disc(0.035, 5), "#b8506a", { plain: true }), p.x + s * 0.06, p.y, p.z + 0.115); });
});
item("whiskers", "face", "Whiskers", U, function (m) {
  var p = nose(m, 0.06), e = m.eye;
  put(m.mesh(ico(0.05), ROSE), p.x, p.y, p.z);
  [-1, 1].forEach(function (s) {
    var g = m.onFace(s * (e.x + e.a * 0.5), e.y - e.b - 0.07, 0.07, 1);
    [-1, 0, 1].forEach(function (k) { put(m.mesh(box(0.3, 0.03, 0.03), INK, { in: g, plain: true }), s * 0.13, k * 0.06, 0, 0, 0, s * k * 0.22); });
  });
});
tache("curly", "Curly moustache", U, "#2b2118", true);
item("fangs", "face", "Fangs", U, function (m) {
  [-1, 1].forEach(function (s) { var g = m.onFace(s * 0.075, m.mouthY - 0.05, 0.04, 0.8); m.mesh(cone(0.04, 0.13), WHITE, { in: g, plain: true }).rotation.z = Math.PI; });
});
item("lollipop", "face", "Lollipop", U, function (m) {
  var p = m.face(0.04, m.mouthY, 0.05), g = m.group(), sweet = m.group(g);
  g.position.copy(p); g.rotation.z = -0.5;
  put(m.mesh(cyl(0.022, 0.022, 0.3, 4), WHITE, { in: g, soft: true }), 0.15, 0, 0.03, 0, 0, HALF);
  put(sweet, 0.36, 0, 0.05);
  put(m.mesh(cyl(0.14, 0.14, 0.05, 8), PINK, { in: sweet }), 0, 0, 0, HALF);
  put(m.mesh(disc(0.07, 6), WHITE, { in: sweet, plain: true }), 0, 0, 0.03);
  m.ticks.push(function (dt, t) { sweet.rotation.z = t * 1.5; });
});
function beard(id, name, rar, color, long, wide) {
  item(id, "face", name, rar, function (m) {
    var top = m.mouthY - 0.03, low = Math.max(top - long, m.lowY);
    m.patch(function (u, v) {
      var y = top + (low - top) * v, x = (u * 2 - 1) * wide * (1 - 0.55 * v * v);
      return [clamp(x, -0.9, 0.9) * Math.sqrt(Math.max(0.05, 1 - y * y)), y, 0.045 + 0.06 * Math.sin(Math.PI * Math.min(1, v * 1.1))];
    }, color, { n: 6 });
    if (wide > 0.6) { var p = m.face(0, m.mouthY + 0.075, 0.06); [-1, 1].forEach(function (s) { put(m.mesh(cone(0.075, 0.32), color), p.x + s * 0.16, p.y, p.z, 0, 0, -s * (HALF + 0.3)).scale.z = 0.6; }); }
  });
}
beard("beard", "Beard", U, "#6b4a2e", 0.36, 0.5);
item("bubblegum", "face", "Bubblegum", R, function (m) {
  var p = m.face(0, m.mouthY, 0.02), b = m.mesh(ico(1), "#ff8fd0", { soft: true });
  m.ticks.push(function (dt, t) { var k = (t * 0.45) % 1, r = k < 0.85 ? 0.05 + 0.2 * k : 0.02; b.scale.set(r, r, r); b.position.set(p.x, p.y, p.z + r * 0.9); });
  m.ticks[m.ticks.length - 1](0, 1.3);
});
item("blower", "face", "Party blower", R, function (m) {
  var p = m.face(0.02, m.mouthY, 0.04), g = m.group(), tube = m.mesh(cyl(0.05, 0.04, 1, 5), YEL, { in: g, soft: true }), tip = m.mesh(ico(0.08), PINK, { in: g });
  g.position.copy(p); g.rotation.set(0, -0.45, -HALF - 0.12);
  m.ticks.push(function (dt, t) {
    var k = 0.14 + 0.42 * Math.pow(Math.max(0, Math.sin(t * 2.2)), 0.6);
    tube.scale.y = k; tube.position.y = k / 2; tip.position.y = k;
  });
  m.ticks[m.ticks.length - 1](0, 0.7);
});
beard("bigbeard", "Wise beard", R, "#f1ede2", 0.62, 0.85);

/* ================= round the neck (19) ================= */
function bowtie(id, name, rar, c1, c2) {
  item(id, "neck", name, rar, function (m) {
    var g = m.onFace(0, Math.max(m.mouthY - 0.2, -0.62), 0.07, 0.6);
    [-1, 1].forEach(function (s) { put(m.mesh(cone(0.14, 0.24), c1, { in: g }), s * 0.14, 0, 0, 0, 0, s * HALF).scale.z = 0.6; });
    m.mesh(box(0.09, 0.11, 0.09), c2, { in: g });
  });
}
function scarf(id, name, rar, c1, c2) {
  item(id, "neck", name, rar, function (m) {
    if (c2) for (var i = 0; i < 8; i++) m.band(i % 2 ? c2 : c1, 0.12, 0.12, { az0: i * TAU / 8, az1: (i + 1) * TAU / 8, seg: 2 });
    else m.band(c1, 0.12, 0.12);
    var p = m.face(0.3, m.neckY - 0.02, 0.13);
    put(m.mesh(box(0.2, 0.3, 0.08), c1), p.x, p.y - 0.16, p.z + 0.02, 0, 0, -0.14);
    put(m.mesh(box(0.2, 0.06, 0.085), c2 || WHITE), p.x + 0.02, p.y - 0.27, p.z + 0.02, 0, 0, -0.14);
  });
}
bowtie("bowtie", "Bow tie", C, RED, "#b02a37");
bowtie("bowtie2", "Dotty bow tie", C, TEAL, WHITE);
scarf("scarf", "Scarf", C, TEAL);
item("necktie", "neck", "Necktie", C, function (m) {
  var g = m.chin(0);
  m.band(WHITE, 0.05, 0.045, { rows: 1 });
  m.mesh(box(0.11, 0.09, 0.07), BLUE, { in: g });
  put(m.mesh(cyl(0.05, 0.1, 0.34, 4), BLUE, { in: g }), 0, -0.2, 0.02, 0, Math.PI / 4).scale.z = 0.4;
});
item("bandana", "neck", "Bandana", C, function (m) {
  var g = m.chin(0.04, 0.07);
  m.band(RED, 0.08, 0.06);
  put(m.mesh(cone(0.26, 0.34, 3), RED, { in: g }), 0, -0.12, 0.03, 0, 0, Math.PI).scale.z = 0.25;
  [[-0.08, -0.06], [0.07, -0.1], [0, -0.2]].forEach(function (d) { put(m.mesh(disc(0.03, 4), WHITE, { in: g, plain: true }), d[0], d[1], 0.075); });
});
item("bib", "neck", "Bib", C, function (m) {
  var top = m.neckY + 0.07, low = Math.max(top - 0.42, m.lowY);
  m.band(WHITE, 0.04, 0.04, { rows: 1 });
  m.patch(function (u, v) { var y = top + (low - top) * v; return [(u * 2 - 1) * 0.36 * (1 - 0.3 * v * v) * Math.sqrt(Math.max(0.05, 1 - y * y)), y, 0.05]; }, WHITE, { n: 5 });
  var g = m.onFace(0, (top + low) / 2, 0.065, 1);
  m.mesh(heart(0.07), "#ff4d7e", { in: g, plain: true });
});
item("badge", "neck", "Name badge", C, function (m) {
  var g = m.chin(0.2, 0.1);
  m.band(TEAL, 0.035, 0.04, { rows: 1 });
  put(m.mesh(box(0.03, 0.2, 0.02), TEAL, { in: g }), 0, 0.14, 0);
  m.mesh(box(0.22, 0.27, 0.03), WHITE, { in: g });
  put(m.mesh(box(0.1, 0.1, 0.02), STEEL, { in: g, plain: true }), 0, 0.04, 0.02);
  put(m.mesh(box(0.14, 0.03, 0.02), INK, { in: g, plain: true }), 0, -0.07, 0.02);
});
item("whistle", "neck", "Whistle", C, function (m) {
  var g = m.chin(0.14, 0.1);
  m.band(INK, 0.03, 0.035, { rows: 1 });
  put(m.mesh(box(0.025, 0.14, 0.02), INK, { in: g }), 0, 0.08, 0);
  put(m.mesh(cyl(0.065, 0.065, 0.08, 8), YEL, { in: g }), -0.03, 0, 0, HALF);
  put(m.mesh(box(0.14, 0.05, 0.07), YEL, { in: g }), 0.06, 0.03, 0);
});
item("key", "neck", "Key on a string", C, function (m) {
  var g = m.chin(0.13, 0.1);
  m.band("#8a5a34", 0.025, 0.03, { rows: 1 });
  put(m.mesh(box(0.025, 0.12, 0.02), "#8a5a34", { in: g }), 0, 0.09, 0);
  m.mesh(tor(0.06, 0.028, null, 6), GOLD, { in: g });
  put(m.mesh(box(0.04, 0.2, 0.03), GOLD, { in: g }), 0, -0.15, 0);
  put(m.mesh(box(0.08, 0.04, 0.03), GOLD, { in: g }), 0.04, -0.22, 0);
});
function collar(id, name, rar, color, bell) {
  item(id, "neck", name, rar, function (m) {
    var g = m.chin(0.1, 0.1);
    m.band(color, 0.06, 0.06, { rows: 1 });
    if (bell) { m.mesh(ico(0.11), GOLD, { in: g }); put(m.mesh(box(0.1, 0.025, 0.03), "#8a6a10", { in: g, plain: true }), 0, -0.04, 0.09); }
    else put(m.mesh(cyl(0.085, 0.085, 0.03, 8), GOLD, { in: g }), 0, 0.01, 0, HALF);
  });
}
collar("collar", "Collar", C, RED);
scarf("stripyscarf", "Stripy scarf", U, RED, WHITE);
collar("bell", "Bell collar", U, BLUE, true);
function beads(id, name, rar, n, size, colors, flat) {
  item(id, "neck", name, rar, function (m) {
    m.around(m.neck, n, size * 0.9, function (p, i) { var b = put(m.mesh(ico(size), colors[i % colors.length]), p.x, p.y, p.z); if (flat) b.scale.y = 0.6; });
  });
}
beads("pearls", "Pearls", U, 16, 0.07, ["#f7f3ea"]);
item("medal", "neck", "Medal", U, function (m) {
  var g = m.chin(0.22, 0.1);
  m.band(BLUE, 0.04, 0.045, { rows: 1 });
  put(m.mesh(box(0.09, 0.2, 0.025), BLUE, { in: g }), 0, 0.13, 0);
  put(m.mesh(box(0.03, 0.2, 0.03), WHITE, { in: g, plain: true }), 0, 0.13, 0.005);
  put(m.mesh(cyl(0.11, 0.11, 0.035, 8), GOLD, { in: g }), 0, 0, 0, HALF);
  put(m.mesh(star(0.06), "#fff3a0", { in: g, plain: true }), 0, 0, 0.025);
});
beads("lei", "Lei", U, 12, 0.115, [PINK, YEL, WHITE, ORANGE], true);
item("cape", "neck", "Cape", R, function (m) {
  m.band(GOLD, 0.045, 0.05, { rows: 1 });
  m.shell(m.neck - 0.06, Math.min(m.neck + 1.25, Math.acos(m.lowY)), function (t) { return 0.05 + 0.38 * t * t; }, RED, { rows: 5, az0: HALF + 0.15, az1: TAU - HALF - 0.15, seg: 8 });
  var g = m.chin(0, 0.09);
  m.mesh(ico(0.07), GOLD, { in: g });
  m.wide = Math.max(m.wide, m.girth(1.8, 2.6) + 0.42);
});
item("chain", "neck", "Gold chain", R, function (m) {
  m.around(m.neck, 18, 0.06, function (p) { put(m.mesh(ico(0.055), GOLD), p.x, p.y, p.z); });
  var g = m.chin(0.17, 0.1);
  put(m.mesh(cyl(0.13, 0.13, 0.04, 8), GOLD, { in: g }), 0, 0, 0, HALF);
  put(m.mesh(star(0.075), "#fff3a0", { in: g, plain: true }), 0, 0, 0.03);
});
item("float", "neck", "Pool float", R, function (m) {
  var a = Math.min(m.neck + 0.25, 2.3), t = 0.17, Rf = m.girth(a - 0.3, a + 0.3) + t + m.slack, y = m.at(a, 0).y;
  for (var i = 0; i < 8; i++) m.stay(put(m.mesh(tor(Rf, t, TAU / 8, 2), i % 2 ? WHITE : RED), 0, y, 0, HALF, 0, i * TAU / 8));
  m.wide = Math.max(m.wide, Rf + t);
});
item("hoop", "neck", "Hula hoop", E, function (m) {
  var Rh = m.girth(1.1, 2.3) + 0.22, y = m.face(0, Math.max(-0.45, m.lowY + 0.2), 0).y, hoop = m.stay(put(m.mesh(tor(Rh, 0.045, null, 18), PINK), 0, y, 0, HALF));
  m.ticks.push(function (dt, t) {
    hoop.rotation.set(HALF + 0.11 * Math.sin(t * 4.5), 0.11 * Math.cos(t * 4.5), 0);
    hoop.position.y = y + 0.05 * Math.sin(t * 2.2);
    hoop.material.uniforms.uCol.value.setHSL((t * 0.2) % 1, 0.85, 0.62);
  });
  m.wide = Math.max(m.wide, Rh + 0.08);
});

/* The creature already leaves room above its head for ears and antennae; a hat asks for more, and
   something wide asks for room at the sides. */
function room(orb) {
  var b = orb._base, w = orb._wear;
  if (!b) return;
  var top = Math.max(-b.rest / (0.34 * b.fill), w ? w.top - 1 : 0);
  orb.fill = Math.min(b.fill, 0.95 / (1 + top * 0.8), w && w.wide ? 0.94 / w.wide : 9);
  orb.rest = -top * 0.34 * orb.fill;
}
// What grows on its head, as the creature itself made it: kept so that a hat's changes can be undone.
function keep(orb) {
  var u = orb.uB, b = u.uBump.value;
  orb._base = { fill: orb.fill, rest: orb.rest, top: u.uTop.value.w, bumps: [b[0].clone(), b[1].clone()] };
}
function restore(orb) {
  var u = orb.uB, b = orb._base;
  u.uTop.value.w = b.top; u.uBump.value[0].copy(b.bumps[0]); u.uBump.value[1].copy(b.bumps[1]);
}
function hook(orb) {
  if (orb._base) return;
  keep(orb);
  var update = orb.update, lod = orb._lod;
  orb.update = function (dt) {
    update.call(this, dt);
    var w = this._wear;
    if (w) for (var i = 0; i < w.ticks.length; i++) w.ticks[i](dt, this.t);
  };
  // its size or its seed changed: what it wore was fitted to the old body
  orb._lod = function () { lod.call(this); keep(this); var was = this._outfit; if (was) { this._wearing = null; dress(this, was); } };
}
function strip(orb) {
  var w = orb._wear;
  if (!w) return;
  orb.body.remove(w.root);
  w.trash.forEach(function (x) { x.dispose(); });
  orb._wear = null; orb._wearing = ""; orb._outfit = null;
  restore(orb); room(orb);
}
function dress(orb, outfit) {
  outfit = outfit || {};
  var sig = SLOTS.map(function (s) { return ITEMS[outfit[s]] ? outfit[s] : ""; }).join("/");
  if (orb._wearing === sig) return;
  hook(orb);
  strip(orb);
  var m = new Maker(orb);
  SLOTS.forEach(function (s) { var it = ITEMS[outfit[s]]; if (it) it.make(m); });
  m.settle();
  orb.body.add(m.root);
  orb._wear = m; orb._wearing = sig; orb._outfit = outfit;
  room(orb);
}

/* How far the deepest corner of anything it wears is inside its body, in body radii; nothing is
   when this is zero or less. */
function audit(orb) { return orb._wear ? orb._wear.sunk(orb._wear.root) : -9; }

return { ITEMS: ITEMS, ORDER: ORDER, SLOTS: SLOTS, RARITIES: RARITIES, dress: dress, strip: strip, audit: audit, core: null };
})();
