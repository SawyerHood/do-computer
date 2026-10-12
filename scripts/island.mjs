// Draws the sky and the island of the first run as still pictures for the phone app, which
// shows them behind its own first run and does not draw the scene itself: the night an egg
// lands in, the sunrise it is named in, and the day it hatches into. They are drawn by the
// scene's own code (packages/mascot/src/sky.js), tall as a phone is, with the egg down and the
// view at rest on it, which leaves the island clear of the cards that come up from the foot.
// `node scripts/island.mjs` writes them to apps/mobile/assets/start, and where on them an egg
// stands to apps/mobile/src/start/island.ts; it needs a Chromium that Playwright can start
// (PLAYWRIGHT_CHROMIUM_PATH names one that is already here).
//
// `node scripts/island.mjs <folder>` writes them into a folder instead, to look at.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const { chromium } = createRequire(path.join(root, "apps/web/package.json"))("@playwright/test")

/**
 * The picture: `wide` by `tall` of the scene's own pixels, each drawn `scale` across. `clear`
 * is how far down the picture, of its height, a card's top is taken to be: the scene keeps the
 * island above it, and at this much it already is. `hours` are how far the night has gone in
 * each (see sky.dawn).
 */
const PICTURE = {
  wide: 132,
  tall: 286,
  scale: 8,
  clear: 0.6,
  hours: { night: 0, sunrise: 2, day: 3 },
  // The egg whose stance is noted: where the ground is in its picture, and how tall it is.
  egg: { seed: "agt_ct5dka", color: "#3f7f9c" },
}

/** Runs in the page: draws each hour, and answers with the pictures and where the egg stands. */
async function draw(picture) {
  /* eslint-disable no-undef */
  const core = AgentOrbCore(THREE)
  const sky = AgentOrbSky(THREE)
  /* eslint-enable no-undef */
  const { wide, tall, scale } = picture
  const drawn = {}
  let stands
  for (const [name, hour] of Object.entries(picture.hours)) {
    const canvas = document.createElement("canvas")
    const scene = sky.create(canvas, { reduced: true })
    if (!scene) throw new Error("The sky could not be drawn here.")
    scene.resize(wide * sky.PIXEL, tall * sky.PIXEL)
    scene.land()
    scene.dawn(hour, true)
    scene.clear(tall * sky.PIXEL * picture.clear)
    for (let step = 0; step < 300; step++) scene.step(1 / 30)
    scene.render()
    const egg = scene.egg()
    stands = { x: egg.x / sky.PIXEL / wide, y: egg.y / sky.PIXEL / tall, part: egg.heading }
    const out = document.createElement("canvas")
    out.width = wide * scale
    out.height = tall * scale
    const to = out.getContext("2d")
    to.imageSmoothingEnabled = false
    to.drawImage(canvas, 0, 0, wide, tall, 0, 0, out.width, out.height)
    drawn[name] = out.toDataURL("image/png")
    scene.dispose()
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl")
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
  }
  const orb = new core.Orb(document.createElement("canvas"), {
    ...picture.egg,
    size: 200,
    pixelRatio: 1,
    dark: true,
    reduced: true,
    notice: false,
  })
  orb.setState("egg")
  for (let step = 0; step < 90; step++) orb.update(1 / 30)
  const stance = orb.stance()
  orb.dispose()
  return { drawn, stands, stance }
}

const read = (file) => readFileSync(path.join(root, file), "utf8")
// The drawing code is modules in the app. Here each is one plain script on an empty page.
const plain = (file) => {
  const script = read(file).replace(/\nexport \{ \w+ \}\s*$/, "\n")
  if (script.includes("export {"))
    throw new Error(`The export line of ${file} was not found where expected.`)
  return script
}
const scripts = ["orb-core.js", "sky.js"].map((file) => plain(`packages/mascot/src/${file}`))
const three = readFileSync(
  createRequire(path.join(root, "apps/web/package.json")).resolve("three/build/three.min.js"),
  "utf8",
)

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH && {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  }),
  // Drawn without a graphics card, so that it comes out the same wherever it is run.
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})
let made
try {
  const page = await browser.newPage()
  page.on("pageerror", (error) => console.error(error))
  await page.setContent(
    `<!doctype html>${[three, ...scripts].map((script) => `<script>${script}</script>`).join("")}`,
  )
  made = await page.evaluate(draw, PICTURE)
} finally {
  await browser.close()
}

const out = process.argv[2]
function write(file, contents) {
  const to = out === undefined ? path.join(root, file) : path.join(out, path.basename(file))
  mkdirSync(path.dirname(to), { recursive: true })
  writeFileSync(to, contents)
  console.log(`${to} (${contents.length} bytes)`)
}
for (const [name, png] of Object.entries(made.drawn)) {
  write(`apps/mobile/assets/start/island-${name}.png`, Buffer.from(png.split(",")[1], "base64"))
}
const round = (value) => Math.round(value * 10000) / 10000
write(
  "apps/mobile/src/start/island.ts",
  `// Written by scripts/island.mjs: where an egg stands on the pictures of the first run's island.
export const ISLAND = {
  /** The pictures' size, in their own pixels. */
  width: ${PICTURE.wide * PICTURE.scale},
  height: ${PICTURE.tall * PICTURE.scale},
  /** The ground under the egg, as parts of the picture's width and height. */
  ground: { x: ${round(made.stands.x)}, y: ${round(made.stands.y)} },
  /** How much of the picture's height the egg is tall. */
  egg: ${round(made.stands.part)},
  /** An egg in its own picture: how far down the ground is, and how much of it the egg is tall. */
  stance: { ground: ${round(made.stance.ground)}, egg: ${round(made.stance.egg)} },
} as const
`,
)
