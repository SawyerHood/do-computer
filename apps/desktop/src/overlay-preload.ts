import { contextBridge, ipcRenderer } from "electron"
import type { OverlayApi, OverlayView } from "./pages/overlay.ts"

// Only the window drawn over the screen has this script, and that window only ever shows the
// app's own page. It is given three things to say and one to hear; the app checks who is
// speaking as well.
if (location.protocol === "file:") {
  const api: OverlayApi = {
    watch: (listener) => {
      ipcRenderer.on("overlay:view", (_event, view: OverlayView) => listener(view))
      ipcRenderer.send("overlay:ready")
    },
    over: (on) => ipcRenderer.send("overlay:over", on),
    act: (what) => ipcRenderer.send("overlay:act", what),
  }
  contextBridge.exposeInMainWorld("overlay", api)
}
