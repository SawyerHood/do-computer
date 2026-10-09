import { contextBridge, ipcRenderer } from "electron"
import type { AppState, DesktopApi } from "./api.ts"

// Every window has this script, and the window that shows the deployment must be given
// nothing by it: only the app's own pages, which are files, can ask anything of the app. The
// app checks who is asking as well.
if (location.protocol === "file:") {
  const api: DesktopApi = {
    state: () => ipcRenderer.invoke("state"),
    watch: (listener) => {
      ipcRenderer.on("state", (_event, state: AppState) => listener(state))
    },
    connect: (choice) => ipcRenderer.invoke("connect", choice),
    share: (on, readOnly) => ipcRenderer.invoke("share", on, readOnly),
    confirm: () => ipcRenderer.invoke("confirm"),
    allow: (what, on) => ipcRenderer.invoke("allow", what, on),
    permit: (what) => ipcRenderer.invoke("permit", what),
    setOpenAtLogin: (on) => ipcRenderer.invoke("open-at-login", on),
    changeServer: () => ipcRenderer.invoke("change-server"),
    retry: () => ipcRenderer.invoke("retry"),
  }
  contextBridge.exposeInMainWorld("desktop", api)
}
