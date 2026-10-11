// Builds the "professional" landing page mock-up into one self-contained page: the creature and
// what it wears are the app's own (packages/mascot), the pictures of the app are the light ones
// from ../landing/shots, and this adds src/style.css and src/app.js. `node build.mjs` writes
// index.html next to this file, which opens straight from the file system. It needs the network
// once, for three.js and its fonts.
import { readFileSync, writeFileSync } from "node:fs"
const here = new URL(".", import.meta.url)
const read = (p) => readFileSync(new URL(p, here), "utf8").replace(/\s+$/, "")
// In the app these are modules. Here each is one plain script, as in the mascot's own demo build.
const plain = (p, name) => {
  const text = read(p).replace(new RegExp(`\\n(?://[^\\n]*\\n)?export \\{ ${name} \\}$`), "")
  if (text.includes("export {")) throw new Error(`The export line of ${p} was not found where expected.`)
  return text
}
const shot = (name) =>
  `data:image/jpeg;base64,${readFileSync(new URL(`../landing/shots/${name}.jpg`, here)).toString("base64")}`
const shots = Object.fromEntries(
  ["chat", "library", "automations"].map((name) => [name, shot(`${name}-light`)]),
)
const logo = read("../../apps/web/public/favicon.svg").replace("<svg ", '<svg class="logo" ')
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Do Computer · landing page mock-up, the professional look</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${read("src/style.css")}
</style>
</head>
<body>
<div id="app"></div>
<div id="strip"></div>
<template id="logo">${logo}</template>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
${plain("../../packages/mascot/src/orb-core.js", "AgentOrbCore")}
${plain("../../packages/mascot/src/wardrobe.js", "AgentOrbWardrobe")}
</script>
<script>
var SHOTS = ${JSON.stringify(shots)};
${read("src/app.js")}
</script>
</body>
</html>
`
writeFileSync(new URL("index.html", here), page)
console.log(`Built index.html (${page.length} bytes).`)
