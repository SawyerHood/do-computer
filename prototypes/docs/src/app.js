// The mock-up's own behavior: scenes with addresses, the list of guides, copying, and the strip.
const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

const SCENES = [
  ["page", "The guide"],
  ["agent", "What an agent gets"],
  ["run", "An agent following it"],
]
// Guides that are not written: only there to show the list with more than one in it.
const LATER = ["Pair your computer", "Models", "Teams", "Slack", "Desktop app"]
const LLMS = `# Do Computer

> An open source personal assistant with a name, a memory and a computer of its own.
> Every guide below is plain Markdown.

## Guides

- [Self-hosting](https://do.computer/docs/self-hosting.md): Run Do Computer on a machine of your own or on your own Cloudflare account.
`
const COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>'
const DONE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

let more = new URLSearchParams(location.search).has("more")

function toast(text) {
  const el = $("#toast")
  el.textContent = text
  el.classList.add("on")
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove("on"), 1800)
}

function copy(text, said) {
  // Opened from the file system or inside a frame there may be no clipboard to write to.
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .catch(() => {})
  if (said) toast(said)
}

function guides() {
  const parts = SECTIONS.map(
    (section) => `<a href="#${section.id}" data-part="${section.id}">${section.text}</a>`,
  ).join("")
  const later = more
    ? LATER.map((name) => `<a class="guide" href="#page" data-toast="Not written yet">${name}</a>`).join("")
    : ""
  for (const el of $$("[data-guides]")) {
    el.innerHTML = `<div class="guides"><h4>Guides</h4><a class="guide on" href="#page">Self-hosting</a><div class="parts">${parts}</div>${later}</div>`
  }
}

function strip() {
  const scene = current()
  $("#strip").innerHTML =
    "<span>mock-up</span>" +
    SCENES.map(([id, name]) => `<a href="#${id}" class="${id === scene ? "on" : ""}">${name}</a>`).join("") +
    `<i></i><button data-more class="${more ? "on" : ""}">With more guides</button>`
}

/** The scene the address names. A section's address belongs to the guide. */
function current() {
  const hash = location.hash.slice(1)
  return SCENES.some(([id]) => id === hash) ? hash : "page"
}

function show() {
  const scene = current()
  for (const el of $$(".scene")) el.classList.toggle("on", el.dataset.scene === scene)
  strip()
  const hash = location.hash.slice(1)
  if (scene === "page" && hash && hash !== "page") document.getElementById(hash)?.scrollIntoView()
  else window.scrollTo(0, 0)
  for (const el of $$("details.menu")) el.open = false
}

function raw(file) {
  $("[data-raw]").textContent = file === "llms" ? LLMS : GUIDE + "\n"
  for (const tab of $$(".tab")) tab.classList.toggle("on", tab.dataset.file === file)
}

/** Which section is being read, shown in the list on the left. */
function spy() {
  let at = null
  for (const section of SECTIONS) {
    const el = document.getElementById(section.id)
    if (el && el.getBoundingClientRect().top < 140) at = section.id
  }
  for (const link of $$("[data-part]")) link.classList.toggle("at", link.dataset.part === at)
}

for (const img of $$("[data-logo]")) img.src = LOGO
for (const pre of $$(".doc pre")) {
  const button = document.createElement("button")
  button.className = "copy"
  button.title = "Copy"
  button.innerHTML = COPY_ICON
  button.onclick = () => {
    copy(pre.querySelector("code").textContent.trimEnd())
    button.classList.add("done")
    button.innerHTML = DONE_ICON
    setTimeout(() => {
      button.classList.remove("done")
      button.innerHTML = COPY_ICON
    }, 1400)
  }
  pre.append(button)
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-toast],[data-copy-prompt],[data-copy-page],[data-more],[data-file]")
  if (!target) return
  if (target.dataset.toast) {
    event.preventDefault()
    toast(target.dataset.toast)
  } else if ("copyPrompt" in target.dataset) {
    copy($("[data-prompt]").textContent, "Copied. Paste it to your agent.")
  } else if ("copyPage" in target.dataset) {
    event.preventDefault()
    copy(GUIDE, "The guide is copied as Markdown")
  } else if ("more" in target.dataset) {
    more = !more
    guides()
    strip()
    spy()
  } else if (target.dataset.file) {
    raw(target.dataset.file)
  }
})
window.addEventListener("hashchange", show)
window.addEventListener("scroll", spy, { passive: true })

guides()
raw("guide")
show()
spy()
