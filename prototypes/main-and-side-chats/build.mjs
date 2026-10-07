// Builds the main-and-side-chats mock-up into one self-contained page. The icons, the pretend
// people and agents, the creature and most of the styles are the agent pages mock-up's; this adds
// src/style.css and src/app.js. `node build.mjs` writes index.html next to this file, which opens
// straight from the file system. It needs the network once, for three.js and its font.
import { readFileSync, writeFileSync } from "node:fs"
const here = new URL(".", import.meta.url)
const read = (p) => readFileSync(new URL(p, here), "utf8").replace(/\s+$/, "")
// In the app the core is a module. Here it is one plain script, as in the mascot's own demo build.
const core = read("../../packages/mascot/src/orb-core.js").replace(
  /\n\/\/ The demo page's build drops this line[^\n]*\nexport \{ AgentOrbCore \}$/,
  "",
)
if (core.includes("export {")) throw new Error("The core's export line was not found where expected.")
const page = `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Main and side chats · mock-up</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${read("../agent-pages/src/style.css")}
${read("src/style.css")}
</style>
</head>
<body>
<div id="app"></div>
<div id="strip"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
${core}
</script>
<script>
${read("../agent-pages/src/head.js")}
${read("src/app.js")}
</script>
</body>
</html>
`
writeFileSync(new URL("index.html", here), page)
console.log(`Built index.html (${page.length} bytes).`)
