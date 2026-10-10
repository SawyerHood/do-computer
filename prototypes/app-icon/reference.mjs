// The agents the icons are drawn from, as the app draws them and nothing more: each one in
// every mood, on the app's dark. Written to reference/ to look at.
//   node reference.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { here, withPage } from "./browser.mjs"
import { CAST } from "./cast.mjs"

const STATES = ["idle", "listening", "speaking", "thinking", "working", "done", "error", "asleep"]

async function draw({ cast, states }) {
  const Core = AgentOrbCore(THREE)
  const [cell, label] = [224, 22]
  const strips = {}
  const all = document.createElement("canvas")
  all.width = cell * states.length
  all.height = (cell + label) * cast.length
  for (const [row, who] of cast.entries()) {
    const strip = document.createElement("canvas")
    strip.width = cell * states.length
    strip.height = cell + label
    const to = strip.getContext("2d")
    to.fillStyle = "#17191c"
    to.fillRect(0, 0, strip.width, strip.height)
    to.imageSmoothingEnabled = false
    for (const [col, state] of states.entries()) {
      const canvas = document.createElement("canvas")
      const orb = new Core.Orb(canvas, { seed: who.seed, color: who.color, size: 224, pixelRatio: 1, dark: true, reduced: true, notice: false })
      orb.setState(state)
      for (let step = 0; step < 90; step++) orb.update(1 / 30)
      orb.showPoints = false
      orb.update(1 / 30)
      orb.render()
      to.drawImage(canvas, col * cell, 0, cell, cell)
      to.fillStyle = "#aab2b8"
      to.font = "12px monospace"
      to.fillText(state, col * cell + 6, cell + 14)
      if (col === 0) to.fillText(`${who.name}: seed "${who.seed}", ${who.color}, drawn ${orb.px}px`, 6, 14)
      orb.dispose()
    }
    strips[who.id] = strip.toDataURL("image/png")
    all.getContext("2d").drawImage(strip, 0, row * (cell + label))
  }
  return { strips, all: all.toDataURL("image/png") }
}

const drawn = await withPage((page) => page.evaluate(draw, { cast: CAST, states: STATES }))
const save = (name, uri) => writeFileSync(path.join(here, "reference", name), Buffer.from(uri.split(",")[1], "base64"))
mkdirSync(path.join(here, "reference"), { recursive: true })
for (const [id, uri] of Object.entries(drawn.strips)) save(`${id}.png`, uri)
save("all.png", drawn.all)
