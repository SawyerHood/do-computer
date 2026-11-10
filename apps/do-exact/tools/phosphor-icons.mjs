// Writes the React app's Phosphor icons (its "regular" weight) as one-colour SVGs under
// assets/icons/, for app.tamber's `icons` block. Run again after adding a name to ICONS:
//   node tools/phosphor-icons.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const here = new URL(".", import.meta.url).pathname
const ICONS = {
  "arrow-up": "ArrowUp",
  "caret-down": "CaretDown",
  "caret-up-down": "CaretUpDown",
  plus: "Plus",
  "dots-three": "DotsThree",
  sidebar: "SidebarSimple",
  "sign-out": "SignOut",
  gear: "Gear",
  users: "Users",
  check: "Check",
  "caret-left": "CaretLeft",
  "caret-right": "CaretRight",
  x: "X",
  desktop: "Desktop",
  cpu: "Cpu",
  key: "Key",
  "user-circle": "UserCircle",
  "book-open": "BookOpen",
  lightning: "Lightning",
  plugs: "Plugs",
  "shield-check": "ShieldCheck",
  "chart-bar": "ChartBar",
  bell: "Bell",
  smiley: "Smiley",
  "squares-four": "SquaresFour",
  "hard-drives": "HardDrives",
  hourglass: "Hourglass",
  "dots-six-vertical": "DotsSixVertical",
}
const pnpm = resolve(here, "../../../node_modules/.pnpm")
const dir = readdirSync(pnpm).find((name) => name.startsWith("@phosphor-icons+react@"))
if (dir === undefined) throw new Error("@phosphor-icons/react is not installed: pnpm install first")
const defs = join(pnpm, dir, "node_modules/@phosphor-icons/react/dist/defs")
const out = resolve(here, "../assets/icons")
mkdirSync(out, { recursive: true })
for (const [file, name] of Object.entries(ICONS)) {
  const source = readFileSync(join(defs, `${name}.es.js`), "utf8")
  const regular = source.split('"regular"')[1]?.split("]")[0] ?? ""
  const paths = [...regular.matchAll(/d: "([^"]+)"/g)].map((m) => m[1])
  if (paths.length === 0) throw new Error(`${name}: no regular path`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">${paths.map((d) => `<path d="${d}"/>`).join("")}</svg>\n`
  writeFileSync(join(out, `${file}.svg`), svg)
}
console.log(`phosphor-icons: ${Object.keys(ICONS).length} icons in ${out}`)
