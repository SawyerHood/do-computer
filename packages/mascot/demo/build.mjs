// Builds the mascot's playground: one page with every state, look and seed to try, for working
// on the creature away from the app. `node demo/build.mjs` writes demo/mascot.html, which opens
// from the file system. It needs the network once, for three.js.
import { readFileSync, writeFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\s+$/, "")
// In the app the core is a module. Here it is one plain script next to the page's own.
const core = read("../src/orb-core.js").replace(/\n\/\/ The demo page's build drops this line[^\n]*\nexport \{ AgentOrbCore \}$/, "")
if (core.includes("export {")) throw new Error("The core's export line was not found where expected.")
const page =
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<style>html,body{height:100%}body{margin:0;font:14px system-ui,sans-serif}[hidden]{display:none!important}</style>` +
  `</head><body>\n${read("./page.html")}\n\n` +
  `<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n` +
  `<script>\n${core}\n\n${read("./demo.js")}\n</script>\n</body></html>\n`
writeFileSync(new URL("./mascot.html", import.meta.url), page)
console.log(`Built demo/mascot.html (${page.length} bytes).`)
