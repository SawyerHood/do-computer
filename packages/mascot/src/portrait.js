/* ================================================================
   The app's picture: a creature on the island it hatched on
   ================================================================

   What the app is known by on a desktop: the island of the first run (sky.js) with a creature
   (orb-core.js) standing on it, or its egg. Both are drawn by their own code, one pixel of each
   to one pixel of the picture, and nothing is done to either. `scripts/icons.mjs` makes the
   app's own icons with this, and the desktop app's window makes its owner's with it, so the
   two are the same picture of different creatures.

   AgentOrbPortrait(core, sky)            -> { island, tile, framed, HOURS }
   island({ grid, hour, zoom })           the island in a square `grid` pixels across, at an hour of its morning
                                          (HOURS.night, .first, .sunrise, .day), or null where it cannot be drawn.
                                          `zoom` under 1 stands further back, for a picture whose corners are cut off
   tile(island, { seed, color, egg,       a creature at rest on that island, or its egg, as a canvas the island's
                  dress })                size. `dress(orb)` puts on it what it wears
   framed(tile, { scale, round, inset })  the tile with each pixel `scale` across, its corners rounded by `round` of
                                          its side, in `inset` pixels of clear room: the shape a desktop wants

   It asks the page for canvases and for nothing else.
*/
function AgentOrbPortrait(core, sky) {
  var HOURS = { night: 0, first: 1, sunrise: 2, day: 3 };
  // The scene is drawn this many times as tall as the picture, so that there is sky over the
  // creature, and the creature with this much of the picture's side.
  var TALL = 2.1, BODY = 0.8, GROUND = 0.8;

  function canvasOf(side) {
    var canvas = document.createElement('canvas');
    canvas.width = side; canvas.height = side;
    return canvas;
  }

  function island(opts) {
    var grid = opts.grid, zoom = opts.zoom || 1;
    var tall = Math.round(grid * TALL * zoom);
    var drawn = document.createElement('canvas');
    var scene = sky.create(drawn, { reduced: true });
    if (!scene) return null;
    var egg;
    try {
      scene.resize(grid * sky.PIXEL, tall * sky.PIXEL);
      // The egg is down, and the view has come to rest on it.
      scene.land();
      scene.dawn(opts.hour == null ? HOURS.sunrise : opts.hour, true);
      scene.clear(null);
      for (var step = 0; step < 240; step++) scene.step(1 / 30);
      scene.render();
      egg = scene.egg();
      // The square of it that has the ground four fifths of the way down, or its top.
      var top = Math.max(0, Math.round(egg.y / sky.PIXEL - grid * GROUND));
      var picture = canvasOf(grid);
      picture.getContext('2d').drawImage(drawn, 0, -top);
      return {
        grid: grid, picture: picture, body: Math.round(grid * BODY * zoom),
        ground: { x: Math.round(egg.x / sky.PIXEL), y: Math.round(egg.y / sky.PIXEL) - top }
      };
    } finally {
      scene.dispose();
      // The scene had a graphics context of its own. It is given back now, not whenever the
      // page next clears up after itself: a page is allowed only so many.
      var gl = drawn.getContext('webgl2') || drawn.getContext('webgl');
      var lose = gl && gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  }

  function tile(where, opts) {
    var grid = where.grid, side = where.body;
    var drawn = document.createElement('canvas');
    var orb = new core.Orb(drawn, { seed: opts.seed, color: opts.color, size: 96, pixelRatio: 1, dark: true, reduced: true, notice: false });
    try {
      if (opts.egg) orb.setState('egg');
      else if (opts.dress) opts.dress(orb);
      // Its shadow is drawn here, on the grass.
      orb.shadow = 0;
      // It is let live for a while, to take up its pose.
      for (var step = 0; step < 90; step++) orb.update(1 / 30);
      orb.showPoints = false;
      // The drawing code picks how many pixels it draws from the size it is shown at, so the
      // size that gives this many is looked for.
      var found = false;
      for (var css = side; css <= side * 5 && !found; css++) { orb.resize(css); found = orb.px === side; }
      orb.update(1 / 30);
      orb.render();

      var out = canvasOf(grid), to = out.getContext('2d');
      to.drawImage(where.picture, 0, 0);
      var px = drawn.width, body = drawn.getContext('2d').getImageData(0, 0, px, px).data;
      var left = px, right = -1;
      for (var y = 0; y < px; y++) for (var x = 0; x < px; x++) {
        if (body[(y * px + x) * 4 + 3] >= 128) { if (x < left) left = x; if (x > right) right = x; }
      }
      if (right >= 0) {
        // Its shadow: whole in its middle, a checker at its rim. It is the shadow of its body:
        // a ring about it reaches further out than it does.
        var image = to.getImageData(0, 0, grid, grid);
        var wide = Math.min(right - left + 1, px * 0.66);
        var rx = wide * 0.36, ry = Math.max(2, wide * 0.06);
        for (y = 0; y < grid; y++) for (x = 0; x < grid; x++) {
          var far = Math.hypot((x + 0.5 - where.ground.x) / rx, (y - 0.5 - where.ground.y) / ry);
          if (far < 0.72 || (far < 1 && (x + y) % 2 === 0)) {
            var at = (y * grid + x) * 4;
            image.data[at] *= 0.55; image.data[at + 1] *= 0.55; image.data[at + 2] *= 0.55;
          }
        }
        to.putImageData(image, 0, 0);
      }
      to.drawImage(drawn, where.ground.x - Math.round(px / 2), Math.round(where.ground.y - orb.stance().ground * px));
      return out;
    } finally {
      orb.dispose();
    }
  }

  function framed(small, opts) {
    var scale = opts.scale || 1, inset = opts.inset || 0, side = small.width * scale;
    var out = canvasOf(side + inset * 2), to = out.getContext('2d');
    to.imageSmoothingEnabled = false;
    if (opts.round > 0) {
      to.beginPath();
      to.roundRect(inset, inset, side, side, side * opts.round);
      to.clip();
    }
    to.drawImage(small, inset, inset, side, side);
    return out;
  }

  return { island: island, tile: tile, framed: framed, HOURS: HOURS };
}

// scripts/icons.mjs drops this line: there this is one plain script on an empty page.
export { AgentOrbPortrait }
