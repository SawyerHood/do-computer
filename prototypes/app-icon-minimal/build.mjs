// Quieter pictures for the desktop app's icon: the owner's creature as the app draws it, on
// something calmer than the island. Each is drawn on the icon's own grid of pixels, with its
// colors taken from the creature's own, so every agent gets its own tile. Writes each icon as
// a PNG, and a sheet of them all at the sizes a Dock shows.
//   node build.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { withPage } from "../app-icon/browser.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))

/** Lookalikes, not anyone's real agent: a seed is searched for that has one ring. */
const CAST = [
  { id: "rose", color: "#c0607a", rings: 1, outfit: { hat: "beanie", glasses: "wire" } },
  { id: "teal", color: "#3b9d9d", seed: "agt_ct5dka" },
  { id: "plum", color: "#7d5a9a", seed: "agt_1qjbcpj", outfit: { hat: "wizard" } },
]

const VARIANTS = [
  { id: "now", name: "Today", note: "the island at sunrise" },
  { id: "charcoal", name: "Charcoal", note: "flat dark, same for everyone" },
  { id: "paper", name: "Paper", note: "flat off-white" },
  { id: "deep", name: "Deep tint", note: "its own color, darkened" },
  { id: "pastel", name: "Pastel tint", note: "its own color, lightened" },
  { id: "fade", name: "Dusk fade", note: "the sunrise sky alone, no land" },
  { id: "horizon", name: "Horizon", note: "two flat bands: sky and ground" },
  { id: "spot", name: "Spotlight", note: "charcoal, a disc of its color" },
  { id: "close", name: "Close-up", note: "deep tint, the face fills it" },
]

/** Runs in the page. */
async function draw({ cast, variants, grid }) {
  /* eslint-disable no-undef */
  const Core = AgentOrbCore(THREE)
  const Wardrobe = AgentOrbWardrobe(THREE, Core)
  const Sky = AgentOrbSky(THREE)
  /* eslint-enable no-undef */
  const canvasOf = (w, h = w) => Object.assign(document.createElement("canvas"), { width: w, height: h })
  const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
  const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t))
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

  // Today's island, as packages/mascot/src/portrait.js draws it.
  function island() {
    const tall = Math.round(grid * 2.1)
    const canvas = canvasOf(8)
    const sky = Sky.create(canvas, { reduced: true })
    sky.resize(grid * Sky.PIXEL, tall * Sky.PIXEL)
    sky.land()
    sky.dawn(2, true)
    sky.clear(null)
    for (let step = 0; step < 240; step++) sky.step(1 / 30)
    sky.render()
    const egg = sky.egg()
    const top = Math.max(0, Math.round(egg.y / Sky.PIXEL - grid * 0.8))
    const picture = canvasOf(grid)
    picture.getContext("2d").drawImage(canvas, 0, -top)
    sky.dispose()
    return picture
  }

  /** The creature drawn with `side` pixels, and where its feet are. */
  function creature(who, side) {
    const canvas = canvasOf(8)
    const orb = new Core.Orb(canvas, { seed: who.seed, color: who.color, size: 96, pixelRatio: 1, dark: true, reduced: true, notice: false })
    if (who.outfit) Wardrobe.dress(orb, who.outfit)
    orb.shadow = 0
    for (let step = 0; step < 90; step++) orb.update(1 / 30)
    orb.showPoints = false
    for (let size = side; size <= side * 5; size++) {
      orb.resize(size)
      if (orb.px === side) break
    }
    orb.update(1 / 30)
    orb.render()
    const px = canvas.width
    const copy = canvasOf(px)
    copy.getContext("2d").drawImage(canvas, 0, 0)
    const data = copy.getContext("2d").getImageData(0, 0, px, px).data
    let [left, right, top, bottom] = [px, -1, px, -1]
    for (let y = 0; y < px; y++)
      for (let x = 0; x < px; x++)
        if (data[(y * px + x) * 4 + 3] >= 128) [left, right, top, bottom] = [Math.min(left, x), Math.max(right, x), Math.min(top, y), Math.max(bottom, y)]
    const ground = orb.stance().ground * px
    orb.dispose()
    return { picture: copy, px, wide: Math.min(right - left + 1, px * 0.66), top, bottom, ground }
  }

  /** A fill of the whole tile: `at(x, y)` answers each pixel's color. */
  function fill(to, at) {
    const image = to.getImageData(0, 0, grid, grid)
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) {
        const c = at(x, y)
        image.data.set([c[0], c[1], c[2], 255], (y * grid + x) * 4)
      }
    to.putImageData(image, 0, 0)
  }

  /** One of two colors by an ordered dither, as the island's own sky is banded. */
  const dither = (x, y, t) => (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16 < t

  /** Its shadow on the ground: whole in its middle, a checker at its rim. */
  function shadow(to, body, gx, gy, dark) {
    const image = to.getImageData(0, 0, grid, grid)
    const [rx, ry] = [body.wide * 0.36, Math.max(2, body.wide * 0.06)]
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) {
        const far = Math.hypot((x + 0.5 - gx) / rx, (y - 0.5 - gy) / ry)
        if (far < 0.72 || (far < 1 && (x + y) % 2 === 0)) for (let k = 0; k < 3; k++) image.data[(y * grid + x) * 4 + k] *= dark
      }
    to.putImageData(image, 0, 0)
  }

  function tile(kind, who, body, big, scene) {
    const out = canvasOf(grid)
    const to = out.getContext("2d")
    const own = rgb(who.color)
    const [black, white, coal] = [[0, 0, 0], [255, 255, 255], [28, 31, 34]]
    const [gx, gy] = [Math.round(grid / 2), Math.round(grid * 0.8)]
    let dark = 0.6
    if (kind === "now") to.drawImage(scene, 0, 0)
    if (kind === "charcoal") fill(to, () => coal)
    if (kind === "paper") {
      fill(to, () => [243, 239, 231])
      dark = 0.86
    }
    if (kind === "deep" || kind === "close") fill(to, () => mix(own, [20, 18, 26], 0.68))
    if (kind === "pastel") {
      fill(to, () => mix(own, white, 0.78))
      dark = 0.86
    }
    if (kind === "fade") {
      // Four flat bands of the sunrise, each breaking into the next by dither.
      const bands = [[66, 72, 122], [120, 106, 140], [186, 130, 130], [236, 170, 124]]
      fill(to, (x, y) => {
        const at = (y / grid) * (bands.length - 1)
        const low = Math.min(bands.length - 2, Math.floor(at))
        return dither(x, y, at - low) ? bands[low + 1] : bands[low]
      })
      dark = 0.7
    }
    if (kind === "horizon") {
      const [sky, land] = [mix(own, [232, 226, 220], 0.82), mix(own, [70, 80, 84], 0.8)]
      const line = Math.round(grid * 0.7)
      fill(to, (x, y) => (y < line ? sky : land))
      dark = 0.72
    }
    if (kind === "spot") {
      const disc = mix(own, coal, 0.62)
      fill(to, (x, y) => (Math.hypot(x + 0.5 - grid / 2, y + 0.5 - grid * 0.5) < grid * 0.39 ? disc : coal))
    }
    if (kind === "close") {
      // The face fills the tile: it stands lower than the picture goes, and has no ground.
      const it = big
      const middle = (it.top + it.bottom) / 2
      to.drawImage(it.picture, Math.round(grid / 2 - it.px / 2), Math.round(grid * 0.53 - middle))
      return out
    }
    shadow(to, body, gx, gy, dark)
    to.drawImage(body.picture, gx - Math.round(body.px / 2), Math.round(gy - body.ground))
    return out
  }

  /** As a Mac wants it: each pixel 8 across, corners rounded, in clear room. */
  function framed(small) {
    const [scale, inset] = [8, 100]
    const side = small.width * scale
    const out = canvasOf(side + inset * 2)
    const to = out.getContext("2d")
    to.imageSmoothingEnabled = false
    to.beginPath()
    to.roundRect(inset, inset, side, side, side * 0.225)
    to.clip()
    to.drawImage(small, inset, inset, side, side)
    return out.toDataURL("image/png")
  }

  const scene = island()
  const drawn = {}
  for (const who of cast) {
    if (who.seed === undefined)
      for (let n = 0; n < 4000 && who.seed === undefined; n++) {
        const g = Core.makeGenome(`agt_${n.toString(36)}`)
        if (g.rings === who.rings && g.sats === 0) who.seed = `agt_${n.toString(36)}`
      }
    const body = creature(who, Math.round(grid * 0.8))
    const big = creature(who, Math.round(grid * 1.25))
    drawn[who.id] = Object.fromEntries(variants.map((v) => [v.id, framed(tile(v.id, who, body, big, scene))]))
    drawn[who.id].seed = who.seed
  }
  return drawn
}

const GRID = 103
const sheet = (icons) => `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box } body { margin: 0; background: #101214; color: #e6eaec; font: 13px/1.4 system-ui, sans-serif; padding: 24px; width: 1180px }
  h2 { font-size: 13px; margin: 26px 0 10px; color: #9aa4a8; font-weight: 600 } h2:first-child { margin-top: 0 }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px }
  .card { background: #181b1e; border-radius: 12px; padding: 14px; display: flex; gap: 14px; align-items: center }
  .card img.big { width: 176px; height: 176px }
  .card b { display: block; font-size: 14px } .card small { color: #8a9498; display: block; margin: 2px 0 10px }
  .sizes { display: flex; align-items: flex-end; gap: 8px }
  .dock { display: inline-flex; gap: 2px; padding: 4px 6px; border-radius: 22px; background: rgba(245,245,250,.25); border: 1px solid rgba(255,255,255,.3) }
  .wall { padding: 26px 22px 8px; border-radius: 10px; margin-bottom: 10px; display: flex; justify-content: center }
  .wall.a { background: linear-gradient(170deg, #8fa3b8, #b9a79c 55%, #6d7560) } .wall.b { background: linear-gradient(170deg, #20242c, #3a3140) }
  .dock img { width: 76px; height: 76px } .dock span { display: flex; flex-direction: column; align-items: center; font-size: 10px; color: rgba(255,255,255,.85); padding-bottom: 3px }
  .cast { display: flex; gap: 6px; flex-wrap: wrap }
  .cast img { width: 118px; height: 118px }
</style>
<h2>Each idea, with a lookalike of your dude (1024 px icon, then 64 and 32)</h2>
<div class="grid">${VARIANTS.map(
  (v, n) => `<div class="card"><img class="big" src="${icons.rose[v.id]}"><div><b>${n === 0 ? "" : `${n}. `}${v.name}</b><small>${v.note}</small>
  <div class="sizes"><img width="64" height="64" src="${icons.rose[v.id]}"><img width="32" height="32" src="${icons.rose[v.id]}"></div></div></div>`,
).join("")}</div>
<h2>In a Dock, on a light and a dark wallpaper</h2>
${["a", "b"].map((w) => `<div class="wall ${w}"><div class="dock">${VARIANTS.map((v, n) => `<span><img src="${icons.rose[v.id]}">${n === 0 ? "today" : n}</span>`).join("")}</div></div>`).join("")}
<h2>The same ideas on other people's agents (the tints follow the creature)</h2>
${["teal", "plum"].map((who) => `<div class="cast">${VARIANTS.map((v) => `<img src="${icons[who][v.id]}">`).join("")}</div>`).join("")}`

const out = path.join(here, "out")
mkdirSync(out, { recursive: true })
await withPage(async (page, browser) => {
  const icons = await page.evaluate(draw, { cast: CAST, variants: VARIANTS, grid: GRID })
  console.log("rose seed", icons.rose.seed)
  for (const v of VARIANTS) writeFileSync(path.join(out, `${v.id}.png`), Buffer.from(icons.rose[v.id].split(",")[1], "base64"))
  const html = sheet(icons)
  writeFileSync(path.join(here, "index.html"), html)
  const view = await browser.newPage()
  await view.setViewportSize({ width: 1180, height: 800 })
  await view.setContent(html)
  await view.screenshot({ path: path.join(out, "sheet.png"), fullPage: true })
})
