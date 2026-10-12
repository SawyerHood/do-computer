// Builds the mock-up into one self-contained page: `node build.mjs` writes index.html next to
// this file. The pictures of the app as it is today are read from `shots/` (see README.md), or
// from the folder named in DC_SHOTS, and are put in the page itself. It needs the network once,
// for the Inter typeface.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { creatureRules } from "./src/kit.mjs"
import { sectionsA } from "./src/screens-a.mjs"
const here = new URL(".", import.meta.url)
const read = (p) => readFileSync(new URL(p, here), "utf8").replace(/\s+$/, "")
let sectionsB = [], today = null
if (existsSync(new URL("src/screens-b.mjs", here))) ({ sectionsB } = await import("./src/screens-b.mjs"))
if (existsSync(new URL("src/today.mjs", here))) ({ today } = await import("./src/today.mjs"))
const shots = process.env.DC_SHOTS ?? new URL("shots/", here).pathname

const sections = [...sectionsA, ...(typeof sectionsB === "function" ? sectionsB(shots) : sectionsB)]
const cell = ([frame, title, words]) =>
  `<div class="mk-cell"><div class="mk-fit">${frame}</div><h4>${title}</h4><p>${words}</p></div>`
const tabs = [
  ...(today ? [`<button data-tab="today" aria-selected="false">The gap</button>`] : []),
  ...sections.map((s, i) => `<button data-tab="${s.id}" aria-selected="${i === 0}">${s.name}</button>`),
  `<span class="gap"></span><button data-dark aria-pressed="false">Dark</button>`,
].join("")
const body =
  (today ? `<section class="mk-sec" data-sec="today">${today(shots)}</section>` : "") +
  sections
    .map(
      (s, i) =>
        `<section class="mk-sec${i === 0 ? " on" : ""}" data-sec="${s.id}"><p class="mk-note">${s.note}</p><div class="mk-grid">${s.cells.map(cell).join("")}</div></section>`,
    )
    .join("")
const script = `
(function () {
  var root = document.querySelector(".mk");
  function fit() {
    root.querySelectorAll(".mk-fit").forEach(function (el) {
      if (el.offsetWidth) el.style.setProperty("--s", el.offsetWidth / 406);
    });
  }
  function show(id) {
    root.querySelectorAll(".mk-sec").forEach(function (s) { s.classList.toggle("on", s.dataset.sec === id); });
    root.querySelectorAll("[data-tab]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.tab === id)); });
    fit();
  }
  root.addEventListener("click", function (e) {
    var tab = e.target.closest("[data-tab],[data-go]");
    if (tab) { show(tab.dataset.tab || tab.dataset.go); return; }
    var dark = e.target.closest("[data-dark]");
    if (dark) {
      var on = dark.getAttribute("aria-pressed") !== "true";
      dark.setAttribute("aria-pressed", String(on));
      dark.textContent = on ? "Light" : "Dark";
      root.querySelectorAll(".ph:not(.keep)").forEach(function (p) { p.classList.toggle("dark", on); });
    }
  });
  if (location.hash) show(location.hash.slice(1));
  window.addEventListener("resize", fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(root);
  fit();
})();`
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The iOS app · mock-up</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
${read("src/style.css")}
${creatureRules(body)}
</style>
</head>
<body>
<div class="mk"><div class="mk-tabs" role="tablist">${tabs}</div>${body}</div>
<script>${script}</script>
</body>
</html>
`
writeFileSync(new URL("index.html", here), page)
console.log(`Built index.html (${page.length} bytes).`)
