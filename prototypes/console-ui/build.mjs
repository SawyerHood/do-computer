// Builds the console-mascot UI prototype into one self-contained page: src/page.html, src/style.css,
// the mascot core from packages/mascot, src/data.js and src/app.js. `node build.mjs` writes
// index.html next to this file, which opens straight from the file system. It needs the network
// once, for three.js and its fonts.
import { readFileSync, writeFileSync } from "node:fs"
const here = new URL(".", import.meta.url)
const read = (p) => readFileSync(new URL(p, here), "utf8").replace(/\s+$/, "")
const CORE = new URL("../../packages/mascot/src/orb-core.js", here)
// In the app the core is a module. Here it is one plain script, as in the mascot's own demo build.
const core = readFileSync(CORE, "utf8").replace(/\s+$/, "").replace(/\n\/\/ The demo page's build drops this line[^\n]*\nexport \{ AgentOrbCore \}$/, "")
if (core.includes("export {")) throw new Error("The core's export line was not found where expected.")
const fonts = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,600;1,700;1,800&family=M+PLUS+1+Code:wght@400;500&family=M+PLUS+Rounded+1c:wght@400;500;700;800&family=Michroma&family=Silkscreen&display=swap"
const page = `<!doctype html>
<html lang="en" data-theme="day">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Do Computer · console mascot prototype</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23dbe9ff'/%3E%3Cpath d='M16 6c6 0 10 5 10 11s-4 9-10 9-10-3-10-9S10 6 16 6z' fill='%235f8a4e'/%3E%3Cellipse cx='12.500' cy='16' rx='2.200' ry='3' fill='%23fff'/%3E%3Cellipse cx='19.500' cy='16' rx='2.200' ry='3' fill='%23fff'/%3E%3Ccircle cx='13' cy='16.500' r='1.200' fill='%23111'/%3E%3Ccircle cx='20' cy='16.500' r='1.200' fill='%23111'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fonts}" rel="stylesheet">
<style>
${read("src/style.css")}
</style>
</head>
<body>
${read("src/page.html")}

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
${core}
</script>
<script>
${read("src/data.js")}

${read("src/app.js")}
</script>
</body>
</html>
`
writeFileSync(new URL("index.html", here), page)
console.log(`Built index.html (${page.length} bytes).`)
