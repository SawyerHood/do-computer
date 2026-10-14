// Builds the voice calls mock-up into one self-contained page. `node build.mjs` writes index.html
// next to this file, which opens straight from the file system. The creature on a call is drawn
// live by the app's own code (packages/mascot), as in the first-run mock-up; where that cannot
// run, the page shows the stills that creatures.mjs drew. The small creatures are stills from the
// iOS app mock-up. It needs the network once, for three.js and the Geist typeface.
import { readFileSync, writeFileSync } from "node:fs"
const here = new URL(".", import.meta.url)
const read = (p) => readFileSync(new URL(p, here), "utf8").replace(/\s+$/, "")
// In the app the core is a module. Here it is one plain script, as in the mascot's own demo build.
const core = read("../../packages/mascot/src/orb-core.js").replace(/\n(\/\/[^\n]*\n)?export \{ AgentOrbCore \}$/, "")
if (core.includes("export {")) throw new Error("The core's export line was not found where expected.")
const small = JSON.parse(read("../ios-app/src/creatures.json"))
const creatures = { scout: small.scout, moss: small.moss, juniperBare: small.juniperBare, otto: small.otto }
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voice calls · mock-up</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${read("src/style.css")}
</style>
</head>
<body>
<div id="nav"><div class="ngroups" id="groups"></div><div id="cap"></div></div>
<div id="wrap"><div id="fit"><div id="stage"></div></div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
${core}
</script>
<script>
window.CREATURES = ${JSON.stringify(creatures)}
window.STILLS = ${read("src/stills.json")}
</script>
<script>
${read("src/app.js")}
</script>
</body>
</html>
`
writeFileSync(new URL("index.html", here), page)
console.log(`Built index.html (${page.length} characters).`)
