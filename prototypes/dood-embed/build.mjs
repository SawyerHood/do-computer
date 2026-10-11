// Builds the mock-up of a Dood hatched inside a post on X into one self-contained page. The egg,
// the creature, what it wears, its box and the sky are the app's own (packages/mascot); the rest is src/style.css and
// src/app.js. `node build.mjs` writes index.html next to this file, which opens straight from the
// file system. It needs the network once, for three.js and its font.
import { readFileSync, writeFileSync } from "node:fs"
const here = new URL(".", import.meta.url)
const read = (p) => readFileSync(new URL(p, here), "utf8").replace(/\s+$/, "")
// In the app these are modules. Here each is one plain script, as in the mascot's own demo build.
const plain = (file, name) => {
  const source = read(`../../packages/mascot/src/${file}`)
  const at = source.lastIndexOf(`\nexport { ${name} }`)
  if (at < 0) throw new Error(`${file}: its export line was not found where expected.`)
  return source.slice(0, at).replace(/\n\/\/ The demo page's build drops this line[^\n]*$/, "")
}
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A Dood in a post · mock-up</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${read("src/style.css")}
</style>
</head>
<body>
<div id="app"></div>
<div id="strip"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
${plain("orb-core.js", "AgentOrbCore")}
</script>
<script>
${plain("sky.js", "AgentOrbSky")}
</script>
<script>
${plain("wardrobe.js", "AgentOrbWardrobe")}
</script>
<script>
${read("src/app.js")}
</script>
</body>
</html>
`
writeFileSync(new URL("index.html", here), page)
console.log(`Built index.html (${page.length} bytes).`)
