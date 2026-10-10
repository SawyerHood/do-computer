// The app's icon as a character on the island it hatched on: the creature and the island both
// drawn by the app's own code, one pixel of each to one pixel of the icon, and nothing done to
// either. Every agent of cast.mjs at every hour of the island's morning, written into one page.
//   node build.mjs
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { here, withPage } from "./browser.mjs"
import { CAST } from "./cast.mjs"

/** The hours of the first run's sky. */
const SKIES = [
  { id: "0", name: "Night", note: "before the egg lands" },
  { id: "1", name: "First light", note: "as it cracks" },
  { id: "2", name: "Sunrise", note: "as it is named" },
  { id: "3", name: "Day", note: "once it is out" },
]

/** Runs in the page. */
async function draw({ cast, grid }) {
  const Core = AgentOrbCore(THREE)
  const Wardrobe = AgentOrbWardrobe(THREE, Core)
  const Sky = AgentOrbSky(THREE)
  const canvasOf = (w, h = w) => Object.assign(document.createElement("canvas"), { width: w, height: h })

  // The island: the scene is drawn tall, so that there is sky over the creature, and the icon
  // is the square of it that has the ground four fifths of the way down.
  const tall = Math.round(grid * 2.1)
  const skies = []
  for (let phase = 0; phase < 4; phase++) {
    const canvas = canvasOf(8)
    const sky = Sky.create(canvas, { reduced: true })
    sky.resize(grid * Sky.PIXEL, tall * Sky.PIXEL)
    sky.land()
    sky.dawn(phase, true)
    sky.clear(null)
    for (let step = 0; step < 240; step++) sky.step(1 / 30)
    sky.render()
    const egg = sky.egg()
    const top = Math.max(0, Math.round(egg.y / Sky.PIXEL - grid * 0.8))
    const picture = canvasOf(grid)
    picture.getContext("2d").drawImage(canvas, 0, -top)
    skies.push({ picture, ground: { x: Math.round(egg.x / Sky.PIXEL), y: Math.round(egg.y / Sky.PIXEL) - top } })
    sky.dispose()
  }

  /** A creature at rest, or asleep and grey, in what it has on, with no shadow of its own. */
  function creature(who, asleep) {
    const canvas = canvasOf(8)
    const orb = new Core.Orb(canvas, { seed: who.seed, color: asleep ? "#737c80" : who.color, size: 96, pixelRatio: 1, dark: true, reduced: true, notice: false })
    if (who.outfit) Wardrobe.dress(orb, who.outfit)
    orb.setState(asleep ? "asleep" : "idle")
    orb.shadow = 0
    for (let step = 0; step < 90; step++) orb.update(1 / 30)
    orb.showPoints = false
    /** Its picture drawn with `side` pixels, and the box around what is in it. */
    const at = (side) => {
      for (let css = side; css <= side * 5; css++) {
        orb.resize(css)
        if (orb.px !== side) continue
        orb.update(1 / 30)
        orb.render()
        const data = canvas.getContext("2d").getImageData(0, 0, side, side).data
        let [left, top, right, bottom] = [side, side, -1, -1]
        for (let y = 0; y < side; y++)
          for (let x = 0; x < side; x++)
            if (data[(y * side + x) * 4 + 3] >= 128) [left, top, right, bottom] = [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)]
        const copy = canvasOf(side)
        copy.getContext("2d").drawImage(canvas, 0, 0)
        return { picture: copy, left, top, wide: right - left + 1, tall: bottom - top + 1, ground: orb.stance().ground * side }
      }
      return null
    }
    return { at, dispose: () => orb.dispose() }
  }

  /** The creature standing on the island, as large as it is there. */
  function tile(it, sky) {
    const out = canvasOf(grid)
    const to = out.getContext("2d")
    to.drawImage(sky.picture, 0, 0)
    const body = it.at(Math.round(grid * 0.8))
    // Its shadow on the grass: whole in its middle, a checker at its rim.
    const image = to.getImageData(0, 0, grid, grid)
    const [rx, ry] = [body.wide * 0.36, Math.max(2, body.wide * 0.06)]
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) {
        const far = Math.hypot((x + 0.5 - sky.ground.x) / rx, (y + 0.5 - sky.ground.y - 1) / ry)
        if (far < 0.72 || (far < 1 && (x + y) % 2 === 0)) for (let k = 0; k < 3; k++) image.data[(y * grid + x) * 4 + k] *= 0.55
      }
    to.putImageData(image, 0, 0)
    to.drawImage(body.picture, sky.ground.x - Math.round(body.picture.width / 2), Math.round(sky.ground.y - body.ground))
    return out.toDataURL("image/png")
  }

  /** The creature alone, as large as fits `size` pixels: what a tray and a tab show. */
  function sprite(it, size) {
    for (let side = size * 2; side >= 8; side--) {
      const body = it.at(side)
      if (body === null || body.wide > size || body.tall > size) continue
      const out = canvasOf(size)
      out.getContext("2d").drawImage(body.picture, Math.round((size - body.wide) / 2) - body.left, Math.round((size - body.tall) / 2) - body.top)
      return out.toDataURL("image/png")
    }
    return null
  }

  const drawn = {}
  for (const who of cast) {
    const [awake, asleep] = [creature(who, false), creature(who, true)]
    drawn[who.id] = {
      tiles: skies.map((sky) => tile(awake, sky)),
      asleep: tile(asleep, skies[0]),
      16: sprite(awake, 16),
      32: sprite(awake, 32),
      off16: sprite(asleep, 16),
      off32: sprite(asleep, 32),
    }
    awake.dispose()
    asleep.dispose()
  }
  return drawn
}

const GRID = 128
const icons = await withPage((page) => page.evaluate(draw, { cast: CAST, grid: GRID }))
const data = { icons, grid: GRID, skies: SKIES, cast: CAST.map(({ id, name, note }) => ({ id, name, note })) }
const page = readFileSync(path.join(here, "page.html"), "utf8").replace("/*DATA*/", `const DATA = ${JSON.stringify(data)}`)
writeFileSync(path.join(here, "index.html"), page)
console.log(`index.html ${page.length} bytes`)
