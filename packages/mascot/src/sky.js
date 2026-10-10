/* ================================================================
   The sky a first egg comes down out of, and the island it lands on
   ================================================================

   One small three.js scene for the first run: a night sky, clouds, an island floating over a
   floor of cloud, and the light an egg comes down in. It is drawn small and shown large, three
   CSS pixels to one of its own, as the creature is; lit at each corner and not across a face,
   every corner on a whole pixel, and what is see-through as a pattern of holes: the look of the
   consoles the creature comes from.

   It draws no egg. The egg is a creature of orb-core.js in a canvas of its own, which the host
   lays over this one where `egg()` says it stands.

   AgentOrbSky(THREE)                     -> { create, PIXEL }
   create(canvas, { reduced })            the scene drawn into `canvas`, or null where WebGL is not to be had
   sky.resize(width, height)              the size it is shown at, in CSS pixels
   sky.step(seconds)   sky.render()       one step of it, and its picture
   sky.fall()                             the egg starts at the top of the sky and comes down; sky.onLand = fn
   sky.land()                             it is down at once (also what a wish for less motion gets)
   sky.falling                            whether it is still on its way
   sky.dawn(0..3, now)                    how far the night has gone: 0 night, 3 the sun is up. `now` is at once
   sky.clear(top)                         keep the egg and the island's top above this many pixels from the top
                                          of the picture, by standing back and looking higher; null for all the room
   sky.egg()                              { x, y, lean, turn, part, heading, shadow }: where the ground under the egg
                                          is, how it leans in degrees and how far it has spun about its long axis in
                                          radians, how much of the height it is tall now and when the view has
                                          settled, and how much of its shadow to draw
   sky.chips(hex)   sky.confetti(hexes)   bits of shell, and what goes up when it is out
   sky.glow(0..1)   sky.flash(0..1)       a moment of light about the egg, and over the whole sky
   sky.bump(speed)                        the island dips under something
   sky.dispose()
*/
function AgentOrbSky(THREE) {
  var T3 = THREE, TAU = Math.PI * 2;
  var K = 3, FALL = 7.6, HIGH = 46, FAR = 10.5, TALL = 6.42, EGG = 0.25, TOP = 0.375, SPINS = 6;
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function smooth(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function pick(list, r) { return list[Math.floor((r || Math.random)() * list.length)]; }
  function seeded(seed) { return function () { seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // The night, and three steps toward morning. Everything between two of them is mixed.
  var PH = [
    { zen: '#05071a', mid: '#0e1a3c', hor: '#1b5560', amb: '#44548c', sun: '#8fb4ff', si: 0.55, stars: 1, day: 0, fog: '#123040', puff: '#8890b4' },
    { zen: '#080c26', mid: '#182a52', hor: '#2c7a80', amb: '#52629a', sun: '#a8c4ff', si: 0.6, stars: 0.85, day: 0.12, fog: '#1c4a58', puff: '#98a0c2' },
    { zen: '#141a40', mid: '#3a4a7c', hor: '#d98a6a', amb: '#76709a', sun: '#ffc8a0', si: 0.75, stars: 0.4, day: 0.5, fog: '#8a6a70', puff: '#e6ccd0' },
    { zen: '#2c66a6', mid: '#6cbccb', hor: '#ffe0b0', amb: '#828aa8', sun: '#fff0d0', si: 0.62, stars: 0, day: 1, fog: '#cfe0d8', puff: '#ffffff' }
  ];
  var BAYER = 'float b2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }\nfloat bayer(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }\n';
  var SPARKS = 260;

  // A shape made a triangle at a time, each with a colour of its own.
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
    g.setAttribute('position', new T3.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new T3.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    return g;
  };
  function at(x, y, z, sx, sy, sz, ry) {
    return new T3.Matrix4().compose(new T3.Vector3(x, y, z), new T3.Quaternion().setFromEuler(new T3.Euler(0, ry || 0, 0)), new T3.Vector3(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));
  }
  function shades(list, r) { var cols = list.map(function (h) { return new T3.Color(h); }); return function () { return pick(cols, r); }; }

  function islandGeo() {
    var r = seeded(7), bag = new Bag(), N = 9;
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
    var grass = shades(['#58a85f', '#4c9a58', '#66b568'], r), lip = shades(['#2f7350', '#2a6848'], r), rock = shades(['#7b6a5c', '#6b5b50', '#8a7868', '#5d4f48'], r);
    for (var i = 0; i < rings.length - 1; i++) for (var k = 0; k < N; k++) {
      var k2 = (k + 1) % N, a = pts[i][k], b = pts[i][k2], c = pts[i + 1][k], d = pts[i + 1][k2];
      var col = i < 3 ? grass : i === 3 ? lip : rock;
      if (i % 2) { bag.tri(a, b, d, col()); bag.tri(a, d, c, col()); }
      else { bag.tri(a, b, c, col()); bag.tri(b, d, c, col()); }
    }
    // three little trees at the back, some stones, tufts of grass and a few flowers
    var leaf = shades(['#2f8060', '#2a7358', '#37906a'], r), bark = shades(['#6b4a3a', '#5f4234'], r), tuft = shades(['#3f8a52', '#74c070'], r), petal = shades(['#ffffff', '#f6b7c8', '#ffe08a'], r);
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
    var r = seeded(40 + n), bag = new Bag();
    bag.add(new T3.IcosahedronGeometry(0.34, 0), at(0, 0, 0, 1.2, 0.8, 1, r() * 3), shades(['#7b6a5c', '#6b5b50', '#8a7868'], r));
    bag.add(new T3.ConeGeometry(0.3, 0.14, 6), at(0, 0.22, 0, 1.1, 1, 0.9), shades(['#58a85f', '#4c9a58'], r));
    return bag.geo();
  }
  function cloudGeo(r) {
    var bag = new Bag(), n = 3 + Math.floor(r() * 3), white = function () { return new T3.Color('#ffffff'); };
    for (var i = 0; i < n; i++) {
      var s = 0.75 + r() * 0.75, mid = 1 - Math.abs(i - (n - 1) / 2) / n;
      bag.add(new T3.IcosahedronGeometry(1, 1), at((i - (n - 1) / 2) * 1.05 + (r() - 0.5) * 0.4, (r() - 0.3) * 0.3, (r() - 0.5) * 0.6, s * 1.25, s * (0.6 + mid * 0.45), s, r() * 3), white);
    }
    // a flat underside, as a cloud has
    for (var k = 1; k < bag.p.length; k += 3) if (bag.p[k] < -0.28) bag.p[k] = -0.28;
    return bag.geo();
  }

  function create(canvas, opts) {
    opts = opts || {};
    var gl;
    try { gl = new T3.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: 'low-power' }); } catch (e) { return null; }
    gl.setPixelRatio(1);
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
    var snap = { value: new T3.Vector2(160, 100) };
    // every corner drawn on a whole pixel, so that what moves shivers a little as it goes
    function ps1(mat) {
      mat.onBeforeCompile = function (s) {
        s.uniforms.uSnap = snap;
        s.vertexShader = 'uniform vec2 uSnap;\n' + s.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;');
      };
      return mat;
    }
    var world = new T3.Scene();
    world.fog = new T3.Fog(0x123040, 15, 62);
    var cam = new T3.PerspectiveCamera(34, 1, 0.1, 300);
    var amb = new T3.AmbientLight(0xffffff, 1), sun = new T3.DirectionalLight(0xffffff, 0.6);
    world.add(amb, sun);
    var owned = [];
    function keep(mesh) { owned.push(mesh); return mesh; }

    // the sky: one colour into the next with height, stars where it is dark, and a low sun at the end
    var skyU = { uFog: { value: world.fog.color }, uZen: { value: new T3.Color() }, uMid: { value: new T3.Color() }, uHor: { value: new T3.Color() }, uCamY: { value: 0 }, uStars: { value: 1 }, uDay: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uFlash: { value: 0 } };
    var dome = keep(new T3.Mesh(new T3.PlaneGeometry(2, 2), new T3.ShaderMaterial({
      uniforms: skyU, depthTest: false, depthWrite: false, fog: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'precision highp float; varying vec2 vUv; uniform vec3 uFog, uZen, uMid, uHor; uniform float uCamY, uStars, uDay, uTime, uAspect, uFlash;\n' + BAYER +
        'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
        'void main(){\n' +
        '  float alt = vUv.y + uCamY * 0.035;\n' +
        '  vec3 col = mix(uFog, uHor, smoothstep(0.5, 0.7, alt));\n' +
        '  col = mix(col, uMid, smoothstep(0.68, 1.02, alt));\n' +
        '  col = mix(col, uZen, smoothstep(0.95, 1.9, alt));\n' +
        '  vec2 sp = vec2((vUv.x - 0.5) * uAspect - 0.4, (alt - mix(0.58, 0.78, uDay)) * 1.25);\n' +
        '  col += vec3(1.0, 0.86, 0.62) * exp(-dot(sp, sp) * 7.0) * uDay * 0.75;\n' +
        '  col = mix(col, vec3(1.0, 0.97, 0.86), step(dot(sp, sp), 0.0042) * smoothstep(0.55, 1.0, uDay));\n' +
        '  vec2 g = floor(gl_FragCoord.xy + vec2(0.0, floor(uCamY * 5.0)));\n' +
        '  float h = hash(g);\n' +
        '  float tw = 0.55 + 0.45 * sin(uTime * (1.0 + fract(h * 91.0) * 3.0) + h * 600.0);\n' +
        '  col += step(0.9962, h) * tw * uStars * smoothstep(0.72, 1.05, alt) * vec3(0.85, 0.95, 1.0);\n' +
        '  col += uFlash;\n' +
        '  col = floor(col * 30.0 + bayer(gl_FragCoord.xy)) / 30.0;\n' +
        '  gl_FragColor = vec4(col, 1.0);\n}'
    })));
    dome.frustumCulled = false; dome.renderOrder = -10;
    world.add(dome);

    var land = ps1(new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide }));
    var isle = keep(new T3.Mesh(islandGeo(), land));
    world.add(isle);
    var stones = [];
    [[-3.0, -0.7, 0.5], [3.2, -0.15, -0.9], [2.5, -1.7, 0.9], [-2.4, -2.0, -0.6]].forEach(function (p, i) {
      var m = keep(new T3.Mesh(stoneGeo(i), land));
      m.userData = { x: p[0], y: p[1], z: p[2], ph: i * 1.7 };
      m.scale.setScalar(i === 3 ? 0.6 : 1 - i * 0.15);
      stones.push(m); world.add(m);
    });

    // clouds: some in the sky it falls through, some about the island, and a floor of them far below
    var r = seeded(11), clouds = [];
    var puff = ps1(new T3.MeshLambertMaterial({ vertexColors: true, side: T3.DoubleSide }));
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
    var beamU = { uA: { value: 0 }, uCol: { value: new T3.Color('#8fd8d2') } };
    var beam = keep(new T3.Mesh(new T3.CylinderGeometry(1.5, 0.8, 44, 12, 1, true), new T3.ShaderMaterial({
      uniforms: beamU, fog: false,
      vertexShader: 'varying vec3 vN; varying float vH; void main(){ vN = normalize(normalMatrix * normal); vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'precision highp float; varying vec3 vN; varying float vH; uniform float uA; uniform vec3 uCol;\n' + BAYER +
        'void main(){ float a = uA * (0.42 - 0.3 * vH) * pow(abs(vN.z), 1.6); if (a < bayer(gl_FragCoord.xy) + 0.03) discard; gl_FragColor = vec4(uCol, 1.0); }'
    })));
    var glowU = { uA: { value: 0 }, uCol: { value: new T3.Color('#b4ece4') } };
    var glow = keep(new T3.Mesh(new T3.CircleGeometry(1.6, 16), new T3.ShaderMaterial({
      uniforms: glowU, fog: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'precision highp float; varying vec2 vUv; uniform float uA; uniform vec3 uCol;\n' + BAYER +
        'void main(){ float r = length(vUv - 0.5) * 2.0; float a = uA * (1.0 - r) * (1.0 - r) * 1.3; if (a < bayer(gl_FragCoord.xy) + 0.03) discard; gl_FragColor = vec4(uCol, 1.0); }'
    })));
    world.add(beam, glow);

    // sparks: what the egg trails as it falls, the dust it lands in, its chips of shell, and the rest
    var pp = new Float32Array(SPARKS * 3), pc = new Float32Array(SPARKS * 3), pv = new Float32Array(SPARKS * 3), pl = new Float32Array(SPARKS), pg = new Float32Array(SPARKS), pn = 0;
    var sparkGeo = new T3.BufferGeometry(), tint = new T3.Color();
    sparkGeo.setAttribute('position', new T3.BufferAttribute(pp, 3));
    sparkGeo.setAttribute('color', new T3.BufferAttribute(pc, 3));
    var sparks = keep(new T3.Points(sparkGeo, new T3.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false })));
    sparks.frustumCulled = false;
    world.add(sparks);
    for (i = 0; i < SPARKS; i++) pp[i * 3 + 1] = -999;
    function spark(x, y, z, vx, vy, vz, life, grav, hex) {
      if (sky.calm) return;
      var n = pn++ % SPARKS;
      tint.set(hex);
      pp[n * 3] = x; pp[n * 3 + 1] = y; pp[n * 3 + 2] = z;
      pv[n * 3] = vx; pv[n * 3 + 1] = vy; pv[n * 3 + 2] = vz;
      pc[n * 3] = tint.r; pc[n * 3 + 1] = tint.g; pc[n * 3 + 2] = tint.b;
      pl[n] = life; pg[n] = grav;
    }

    // how things stand
    var W = { t: 0, fallT: 0, alt: 0, sway: 0, lean: 0, turn: 0, eggY: 0.1, phase: 0, phaseTo: 0, beam: 0, glow: 0, flash: 0, dip: 0, dipV: 0, acc: 0, fly: 0, w: 1, h: 1 };
    // how much of the height the egg takes and how far down the island's top is: now, and where they are heading
    var L = { part: EGG, top: TOP, partTo: EGG, topTo: TOP };
    var c1 = new T3.Color(), c2 = new T3.Color(), v3 = new T3.Vector3();
    function mix(into, a, b, k) { into.copy(c1.set(a)).lerp(c2.set(b), k); }
    function palette(p) {
      var n = Math.min(PH.length - 2, Math.floor(p)), k = clamp(p - n, 0, 1), a = PH[n], b = PH[n + 1];
      mix(skyU.uZen.value, a.zen, b.zen, k); mix(skyU.uMid.value, a.mid, b.mid, k); mix(skyU.uHor.value, a.hor, b.hor, k);
      mix(amb.color, a.amb, b.amb, k); mix(puff.color, a.puff, b.puff, k); mix(sun.color, a.sun, b.sun, k); mix(world.fog.color, a.fog, b.fog, k);
      sun.intensity = lerp(a.si, b.si, k);
      sun.position.set(lerp(-3, 4, p / 3), lerp(6, 3.5, p / 3), 5.5);
      skyU.uStars.value = lerp(a.stars, b.stars, k); skyU.uDay.value = lerp(a.day, b.day, k);
    }
    function touchDown() {
      sky.falling = false; W.alt = 0; W.sway = 0; W.lean = 0; W.turn = 0;
      if (!sky.calm) W.dipV = -1.7;
      for (var n = 0; n < 26; n++) { var a = Math.random() * TAU, v = 1 + Math.random() * 1.6; spark(Math.cos(a) * 0.6, isle.position.y + 0.15, Math.sin(a) * 0.5, Math.cos(a) * v, 0.5 + Math.random() * 1.3, Math.sin(a) * v, 0.45 + Math.random() * 0.45, 3.5, pick(['#e8f4e0', '#bcd8b0', '#ffffff'])); }
      var told = sky.onLand;
      if (told) told();
    }

    var sky = {
      falling: false,
      calm: !!opts.reduced,
      onLand: null,
      resize: function (width, height) {
        W.w = Math.max(1, width); W.h = Math.max(1, height);
        var rw = Math.max(2, Math.round(W.w / K)), rh = Math.max(2, Math.round(W.h / K));
        gl.setSize(rw, rh, false);
        cam.aspect = W.w / W.h; cam.updateProjectionMatrix();
        snap.value.set(rw / 2, rh / 2); skyU.uAspect.value = W.w / W.h;
      },
      fall: function () {
        if (sky.calm) { touchDown(); return; }
        sky.falling = true; W.fallT = 0; W.alt = HIGH; W.beam = 1; W.glow = 0.75;
      },
      land: function () {
        if (sky.falling) { W.fallT = FALL; return; }
        W.alt = 0; W.beam = 0; W.glow = 0;
      },
      dawn: function (phase, now) {
        W.phaseTo = clamp(phase, 0, PH.length - 1);
        if (now || sky.calm) W.phase = W.phaseTo;
      },
      clear: function (top) {
        if (top == null) { L.partTo = EGG; L.topTo = TOP; return; }
        var y = Math.min(TOP * W.h, top - 30);
        L.topTo = y / W.h; L.partTo = clamp((y - 14) / W.h, 0.08, EGG);
      },
      egg: function () {
        v3.set(W.sway, W.eggY, 0).project(cam);
        return { x: (v3.x * 0.5 + 0.5) * W.w, y: (-v3.y * 0.5 + 0.5) * W.h, lean: W.lean, turn: W.turn, part: L.part, heading: L.partTo, shadow: 1 - smooth(0, 2.5, W.alt) };
      },
      chips: function (hex) {
        for (var n = 0; n < 12; n++) spark((Math.random() - 0.5) * 0.7, W.eggY + 0.6 + Math.random() * 0.6, 0.4, (Math.random() - 0.5) * 3.4, 1.2 + Math.random() * 2.2, Math.random(), 0.6 + Math.random() * 0.4, 8, pick(['#f4efe6', '#ffffff', hex || '#ffffff']));
      },
      confetti: function (hexes) {
        var cols = (hexes || []).concat(['#ffffff', '#ffe08a', '#7fd6cf']);
        for (var n = 0; n < 110; n++) spark((Math.random() - 0.5) * 0.5, W.eggY + 0.8, 0.3, (Math.random() - 0.5) * 7, 3 + Math.random() * 5, (Math.random() - 0.5) * 3, 1.3 + Math.random() * 1.3, 7, pick(cols));
      },
      glow: function (k) { if (!sky.calm) W.glow = Math.max(W.glow, k); },
      flash: function (k) { if (!sky.calm) W.flash = Math.max(W.flash, k); },
      bump: function (speed) { if (!sky.calm) W.dipV -= speed; },
      step: function (dt) {
        W.t += dt;
        W.phase += (W.phaseTo - W.phase) * (1 - Math.exp(-dt * 0.9));
        palette(W.phase);
        var ease = sky.calm ? 1 : 1 - Math.exp(-dt * 6);
        L.part += (L.partTo - L.part) * ease; L.top += (L.topTo - L.top) * ease;
        var u = 1;
        if (sky.falling) {
          W.fallT += dt;
          u = Math.min(1, W.fallT / FALL);
          W.alt = HIGH * Math.pow(1 - u, 1.8);
          W.sway = Math.sin(W.t * 1.3) * 0.32 * (1 - u);
          W.lean = Math.sin(W.t * 2.1) * 6 * (1 - u * u);
          // it spins as it comes, slower the nearer it is, and is down with its front to the front
          W.turn = SPINS * TAU * Math.pow(1 - u, 1.4);
          // it leaves a trail above it as it comes
          W.acc += dt * 30;
          while (W.acc > 1) {
            W.acc--;
            var a = Math.random() * TAU, r0 = 0.25 + Math.random() * 0.5;
            spark(W.sway + Math.cos(a) * r0, W.eggY + 0.5 + Math.random() * 1.4, Math.sin(a) * r0 * 0.5 - 0.2, Math.cos(a) * 0.5, 1 + Math.random() * 1.6, 0, 0.6 + Math.random() * 0.7, 0, pick(['#ffffff', '#bfeee8', '#7fd6cf', '#ffe9b0']));
          }
          if (u >= 1) touchDown();
        } else {
          // specks of light about the island, fewer as the day comes
          W.fly += dt * (1.6 - W.phase * 0.4);
          if (W.fly > 1) {
            W.fly = 0;
            var b = Math.random() * TAU, rr = 2.2 + Math.random() * 2.2;
            spark(Math.cos(b) * rr, -1 + Math.random() * 3, Math.sin(b) * rr * 0.6 - 0.5, (Math.random() - 0.5) * 0.2, 0.12 + Math.random() * 0.2, 0, 2.5 + Math.random() * 2, 0, pick(['#bfeee8', '#ffe9b0', '#7fd6cf']));
          }
        }
        // the island floats, and dips under what lands on it
        W.dipV += (-70 * W.dip - 7 * W.dipV) * dt; W.dip += W.dipV * dt;
        isle.position.y = (sky.calm ? 0 : Math.sin(W.t * 0.9) * 0.05) + W.dip;
        for (var n = 0; n < stones.length; n++) { var m = stones[n], d = m.userData; m.position.set(d.x, d.y + Math.sin(W.t * 0.7 + d.ph) * 0.12 + W.dip * 0.3, d.z); m.rotation.y = W.t * 0.15 + d.ph; }
        for (n = 0; n < clouds.length; n++) { var c = clouds[n], e = c.userData; c.position.x += e.v * dt; if (c.position.x > e.span) c.position.x = -e.span; else if (c.position.x < -e.span) c.position.x = e.span; }
        W.eggY = isle.position.y + 0.1 + W.alt;

        // nearer or further, higher or lower, so that the egg and the top of the island are clear of what is under them
        var far = EGG / L.part, cy = W.alt + lerp(-4.9, 0.1 - (0.5 - L.top) * TALL * far, smooth(0.02, 0.5, u));
        cam.position.set(0, cy + 2.4 * far, FAR * far); cam.lookAt(0, cy, 0);
        skyU.uCamY.value = cy; skyU.uTime.value = W.t;
        W.beam += ((sky.falling ? 1 : 0) - W.beam) * (1 - Math.exp(-dt * 2.2));
        W.glow += ((sky.falling ? 0.75 : 0) - W.glow) * (1 - Math.exp(-dt * 2.6));
        W.flash *= Math.exp(-dt * 3.2);
        beamU.uA.value = W.beam; glowU.uA.value = W.glow; skyU.uFlash.value = W.flash;
        beam.visible = W.beam > 0.03; glow.visible = W.glow > 0.03;
        beam.position.set(W.sway, W.eggY + 22, 0);
        glow.position.set(W.sway, W.eggY + 0.8, -0.4); glow.quaternion.copy(cam.quaternion);

        for (n = 0; n < SPARKS; n++) {
          if (pl[n] <= 0) continue;
          pl[n] -= dt;
          if (pl[n] <= 0) { pp[n * 3 + 1] = -999; continue; }
          pv[n * 3 + 1] -= pg[n] * dt;
          pp[n * 3] += pv[n * 3] * dt; pp[n * 3 + 1] += pv[n * 3 + 1] * dt; pp[n * 3 + 2] += pv[n * 3 + 2] * dt;
        }
        sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true;
      },
      render: function () { gl.render(world, cam); },
      dispose: function () {
        for (var n = 0; n < owned.length; n++) { owned[n].geometry.dispose(); owned[n].material.dispose(); }
        for (n = 0; n < shapes.length; n++) shapes[n].dispose();
        puff.dispose();
        gl.dispose();
      }
    };
    sky.resize(canvas.clientWidth || 960, canvas.clientHeight || 600);
    palette(0);
    sky.step(0);
    return sky;
  }

  return { create: create, PIXEL: K };
}

export { AgentOrbSky }
