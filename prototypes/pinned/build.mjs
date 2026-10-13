// Builds the pinned things mock-up into one self-contained page. `node build.mjs` writes
// index.html next to this file, which opens straight from the file system. The creatures are
// stills the iOS app mock-up drew with the app's own code (prototypes/ios-app/creatures.mjs).
// It needs the network once, for the Geist typeface.
import { readFileSync, writeFileSync } from "node:fs"
const here = new URL(".", import.meta.url)
const read = (p) => readFileSync(new URL(p, here), "utf8").replace(/\s+$/, "")
const stills = JSON.parse(read("../ios-app/src/creatures.json"))
// Which still stands in for which Dood here. Juniper is the teal one.
const creatures = { juniper: stills.scout, moss: stills.moss, pixel: stills.juniperBare, otto: stills.otto }
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pinned things · mock-up</title>
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
<script>
window.CREATURES = ${JSON.stringify(creatures)}
</script>
<script>
${read("src/app.js")}
</script>
</body>
</html>
`
writeFileSync(new URL("index.html", here), page)
console.log(`Built index.html (${page.length} characters).`)
