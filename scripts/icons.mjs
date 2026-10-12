// Draws the app's own pictures from its mascot: the tab's icon, the icons a phone and a
// desktop show for the app, the tray's, and the mark on the desktop app's own pages. The
// creature is one grown from a seed, in the app's teal, drawn by the same code that draws every
// agent's; where there is room it stands on the island of the first run at sunrise, as an
// agent's own does in the desktop app's icon (see packages/mascot/src/portrait.js).
// `node scripts/icons.mjs` writes them all where they are used; it needs a Chromium that
// Playwright can start (PLAYWRIGHT_CHROMIUM_PATH names one that is already here).
//
// `node scripts/icons.mjs <folder>` writes them into a folder instead, to look at.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const { chromium } = createRequire(path.join(root, "apps/web/package.json"))("@playwright/test")

/** What the creature is, and what it is doing in its picture. */
const LOOK = {
  seed: "agt_ct5dka",
  color: "#3b9d9d",
  state: "idle",
  // Drawn with fewer than this many pixels its eyes are specks, so there it listens instead,
  // which is the same creature with its eyes wide.
  small: { under: 40, state: "listening" },
  // The tray's creature while this computer is not shared: grey, and asleep.
  off: { color: "#737c80", state: "asleep" },
}

/**
 * Every picture. A tile is the creature on its island: `grid` is how many of the creature's
 * pixels the square is across, `scale` how large each is drawn, `zoom` how near it is stood
 * to, `round` how much of it the corners are rounded by, and `inset` the clear room left
 * around it. A sprite is the creature alone, without the ball that floats over its head, in a
 * picture `size` pixels across: `half` draws it at twice that and reduces it, which is kinder
 * to its eyes than the few pixels it would otherwise have.
 */
const PICTURES = [
  { file: "apps/web/public/icon-192.png", tile: { grid: 96, scale: 2, round: 0.225 } },
  { file: "apps/web/public/icon-512.png", tile: { grid: 128, scale: 4, round: 0.225 } },
  // A phone cuts its own shape out of these two, so they have no corners and more room.
  { file: "apps/web/public/icon-maskable-512.png", tile: { grid: 128, scale: 4, zoom: 0.78 } },
  { file: "apps/web/public/apple-touch-icon.png", tile: { grid: 90, scale: 2, zoom: 0.92 } },
  // The phone app's own, which iOS also cuts to its shape: 1024 across, as the App Store asks.
  { file: "apps/mobile/assets/icon.png", tile: { grid: 128, scale: 8, zoom: 0.92 } },
  { file: "apps/desktop/assets/icon.png", tile: { grid: 128, scale: 8, round: 0.225 } },
  // A Mac's icons are a square of 824 in a picture of 1024, which is how its own are drawn.
  {
    file: "apps/desktop/assets/icon-mac.png",
    tile: { grid: 103, scale: 8, round: 0.225, inset: 100 },
  },
  { file: "apps/desktop/assets/tray.png", sprite: { size: 18, half: true } },
  { file: "apps/desktop/assets/tray@2x.png", sprite: { size: 36 } },
  { file: "apps/desktop/assets/tray-off.png", sprite: { size: 18, half: true, off: true } },
  { file: "apps/desktop/assets/tray-off@2x.png", sprite: { size: 36, off: true } },
  // What a phone puts in its status bar: only the shape is used, so it is white with holes.
  { file: "apps/web/public/badge.png", sprite: { size: 48, scale: 2, shape: true } },
  { name: "favicon-16", sprite: { size: 16, half: true } },
  { name: "favicon-32", sprite: { size: 32 } },
  { name: "favicon-48", sprite: { size: 48 } },
  { name: "mark", sprite: { size: 32, pixels: true } },
]

/** Runs in the page: draws every picture, and answers with each as a PNG's address. */
async function draw({ look, pictures }) {
  /* eslint-disable no-undef */
  const AgentOrb = AgentOrbCore(THREE)
  const portrait = AgentOrbPortrait(AgentOrb, AgentOrbSky(THREE))
  /* eslint-enable no-undef */
  const canvasOf = (width, height = width) => {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    return canvas
  }

  /**
   * The creature's picture without its shadow, and the box around what is left: its body, and
   * the ball over its head if that is wanted.
   */
  function alone(image, ball) {
    const { width, height, data } = image
    const solid = (index) => data[index * 4 + 3] >= 128
    const group = new Int32Array(width * height).fill(-1)
    const sizes = []
    for (let start = 0; start < width * height; start++) {
      if (!solid(start) || group[start] !== -1) continue
      const stack = [start]
      group[start] = sizes.length
      let size = 0
      while (stack.length > 0) {
        const at = stack.pop()
        size++
        const [x, y] = [at % width, Math.floor(at / width)]
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const [nx, ny] = [x + dx, y + dy]
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const next = ny * width + nx
            if (!solid(next) || group[next] !== -1) continue
            group[next] = sizes.length
            stack.push(next)
          }
        }
      }
      sizes.push(size)
    }
    // The ball is a hundredth of its body and more. Its shadow is faint, and a tile draws
    // its own.
    const least = Math.max(...sizes) * (ball ? 0.006 : 1)
    let [left, top, right, bottom] = [width, height, -1, -1]
    for (let at = 0; at < width * height; at++) {
      if (group[at] !== -1 && sizes[group[at]] >= least) {
        data[at * 4 + 3] = 255
        const [x, y] = [at % width, Math.floor(at / width)]
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      } else {
        data[at * 4 + 3] = 0
      }
    }
    return { image, left, top, width: right - left + 1, height: bottom - top + 1 }
  }

  /**
   * The creature alone, on a canvas that it fills: as large as fits a box `wide` by `tall`
   * pixels, each of them one of the pixels it is drawn with.
   */
  function creature(wide, tall, { off = false, ball = false } = {}) {
    const canvas = canvasOf(8)
    const orb = new AgentOrb.Orb(canvas, {
      seed: look.seed,
      color: off ? look.off.color : look.color,
      size: 96,
      pixelRatio: 1,
      dark: true,
      reduced: true,
      notice: false,
    })
    orb.setState(off ? look.off.state : tall < look.small.under ? look.small.state : look.state)
    // It is let live for a while, to take up its pose.
    for (let step = 0; step < 90; step++) orb.update(1 / 30)
    const cache = new Map()
    const at = (side) => {
      if (cache.has(side)) return cache.get(side)
      // The drawing code picks how many pixels it draws from the size it is shown at, so the
      // size that gives this many is looked for.
      let found = false
      for (let css = side; css <= side * 5 && !found; css++) {
        orb.resize(css)
        found = orb.px === side
      }
      if (!found) return null
      // The motes that drift around it are left out: on a picture this small they are specks.
      orb.showPoints = false
      orb.update(1 / 30)
      orb.render()
      const cut = alone(canvas.getContext("2d").getImageData(0, 0, side, side), ball)
      cache.set(side, cut)
      return cut
    }
    // It keeps room around itself for hops and rings, and how much depends on its size: the
    // largest drawing of it that still fits is found by trying.
    let best = null
    for (let side = Math.max(8, Math.min(wide, tall)); side <= tall * 2.5; side++) {
      const cut = at(side)
      if (cut === null) continue
      if (cut.width > wide || cut.height > tall) {
        if (best !== null) break
        continue
      }
      best = cut
    }
    orb.dispose()
    const out = canvasOf(best.width, best.height)
    out.getContext("2d").putImageData(best.image, -best.left, -best.top)
    return out
  }

  function tile({ grid, scale, zoom = 1, round = 0, inset = 0 }) {
    const island = portrait.island({ grid, zoom, hour: portrait.HOURS.sunrise })
    const small = portrait.tile(island, { seed: look.seed, color: look.color })
    return portrait.framed(small, { scale, round, inset })
  }

  function sprite({ size, scale = 1, half = false, off = false, shape = false }) {
    if (half) {
      const twice = sprite({ size: size * 2, off, shape })
      const out = canvasOf(size)
      out.getContext("2d").drawImage(twice, 0, 0, size, size)
      return out
    }
    const it = creature(size, size, { off })
    if (shape) {
      const context = it.getContext("2d")
      const image = context.getImageData(0, 0, it.width, it.height)
      for (let at = 0; at < image.data.length; at += 4) {
        const [r, g, b, a] = image.data.slice(at, at + 4)
        // Its pupils and its mouth are the dark of it, and are left as holes.
        const hole = a === 0 || Math.max(r, g, b) < 70
        image.data.set(hole ? [0, 0, 0, 0] : [255, 255, 255, 255], at)
      }
      context.putImageData(image, 0, 0)
    }
    const out = canvasOf(size * scale)
    const to = out.getContext("2d")
    to.imageSmoothingEnabled = false
    const [left, top] = [Math.round((size - it.width) / 2), Math.round((size - it.height) / 2)]
    to.drawImage(it, left * scale, top * scale, it.width * scale, it.height * scale)
    return out
  }

  const drawn = {}
  for (const picture of pictures) {
    const canvas = picture.tile ? tile(picture.tile) : sprite(picture.sprite)
    drawn[picture.file ?? picture.name] = {
      png: canvas.toDataURL("image/png"),
      // For the mark, the pixels themselves: it is written out as shapes.
      ...(picture.sprite?.pixels && {
        side: canvas.width,
        pixels: [...canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data],
      }),
    }
  }
  return drawn
}

/** A picture of square pixels as SVG: one path for each color, a stroke along each run of it. */
function svg(side, pixels) {
  const runs = new Map()
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side;) {
      const [r, g, b, a] = pixels.slice((y * side + x) * 4, (y * side + x) * 4 + 4)
      let end = x + 1
      const same = (at) => [r, g, b, a].every((value, part) => pixels[at * 4 + part] === value)
      while (end < side && same(y * side + end)) end++
      if (a > 0) {
        const color = `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`
        runs.set(color, `${runs.get(color) ?? ""}M${x} ${y}.5h${end - x}`)
      }
      x = end
    }
  }
  const paths = [...runs].map(([color, d]) => `<path stroke="${color}" d="${d}"/>`).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges" aria-hidden="true">${paths}</svg>\n`
}

/** Several PNGs as one .ico, for a browser to pick the size it shows from. */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ side, png }, index) => {
    const entry = 6 + 16 * index
    header.writeUInt8(side, entry)
    header.writeUInt8(side, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...pngs.map(({ png }) => png)])
}

const read = (file) => readFileSync(path.join(root, file), "utf8")
// The drawing code is modules in the app. Here each is one plain script on an empty page.
const plain = (file) => {
  const script = read(file).replace(/\nexport \{ \w+ \}\s*$/, "\n")
  if (script.includes("export {"))
    throw new Error(`The export line of ${file} was not found where expected.`)
  return script
}
const scripts = ["orb-core.js", "sky.js", "portrait.js"].map((file) =>
  plain(`packages/mascot/src/${file}`),
)
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
let drawn
try {
  const page = await browser.newPage()
  page.on("pageerror", (error) => console.error(error))
  await page.setContent(
    `<!doctype html>${[three, ...scripts].map((script) => `<script>${script}</script>`).join("")}`,
  )
  drawn = await page.evaluate(draw, { look: LOOK, pictures: PICTURES })
} finally {
  await browser.close()
}

const png = (name) => Buffer.from(drawn[name].png.split(",")[1], "base64")
const out = process.argv[2]
function write(file, contents) {
  const to = out === undefined ? path.join(root, file) : path.join(out, path.basename(file))
  mkdirSync(path.dirname(to), { recursive: true })
  writeFileSync(to, contents)
  console.log(`${to} (${contents.length} bytes)`)
}
for (const { file } of PICTURES) if (file !== undefined) write(file, png(file))
write(
  "apps/web/public/favicon.ico",
  ico([16, 32, 48].map((side) => ({ side, png: png(`favicon-${side}`) }))),
)
const mark = svg(drawn.mark.side, drawn.mark.pixels)
write("apps/web/public/favicon.svg", mark)
write("apps/desktop/assets/mark.svg", mark)
// The page a browser is shown after signing in for the desktop app is whole in itself, so the
// mark is written into the program too.
write(
  "apps/desktop/src/mark.ts",
  `// Written by scripts/icons.mjs: the app's mark, as SVG to put in a page.\nexport const MARK =\n  '${mark.trim()}'\n`,
)
