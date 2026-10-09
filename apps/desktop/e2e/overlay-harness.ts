// A small app that is nothing but the overlay, for overlay.spec.ts to drive: the real window
// and the real page, with a made-up agent and a clock the test can move.
import { join } from "node:path"
import { UseState } from "@durable-computer/computers/use"
import { app } from "electron"
import { createOverlay, type Overlay } from "../src/overlay.ts"

type Harness = { state: UseState; overlay: Overlay; later: number }
declare global {
  var harness: Harness | undefined
}

// The built app, which is where the page and the script its window is given are.
const dist = process.env.DC_OVERLAY_DIST!

void app.whenReady().then(() => {
  const state = new UseState({
    what: "the screen",
    now: () => Date.now() + (globalThis.harness?.later ?? 0),
  })
  const overlay = createOverlay({
    state,
    pagesDir: join(dist, "pages"),
    preload: join(dist, "overlay-preload.cjs"),
  })
  globalThis.harness = { state, overlay, later: 0 }
})
// The overlay's window is not one that closing ends the app.
app.on("window-all-closed", () => {})
