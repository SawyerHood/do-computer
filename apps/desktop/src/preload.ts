import { contextBridge, ipcRenderer } from "electron"
import type { AppState, DesktopApi } from "./api.ts"
import { CHANNELS, type DesktopBridge, type PageInfo } from "./page-bridge.ts"

// Every window has this script. The app's own pages, which are files, can ask the app what
// they need to. A page of the web is given something only when the app says so: the app is
// asked, before the page has run anything, what this page may know, and it answers nothing
// unless the page is the top one in the main window and on the deployment the app is set to.
// Such a page is given the little a first run takes (see page-bridge.ts) and none of what the
// app's own pages have. The app checks who is asking again each time it is asked.
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
    update: () => ipcRenderer.invoke("update"),
    devices: () => ipcRenderer.invoke("devices"),
    lookForTailnet: () => ipcRenderer.invoke("tailnet-look"),
    setTailnet: (on) => ipcRenderer.invoke("tailnet-set", on),
    deviceLink: () => ipcRenderer.invoke("device-link"),
    copy: (text) => ipcRenderer.invoke("copy", text),
    open: (page) => ipcRenderer.invoke("open", page),
  }
  contextBridge.exposeInMainWorld("desktop", api)
} else if (location.protocol === "https:" || location.protocol === "http:") {
  const info = ipcRenderer.sendSync(CHANNELS.info) as PageInfo | null
  if (info !== null) {
    const bridge: DesktopBridge = {
      ...info,
      onTitleBar: (listener) => {
        ipcRenderer.on(CHANNELS.titleBar, (_event, titleBar: "inset" | null) => listener(titleBar))
      },
      signIn: (provider) => ipcRenderer.invoke(CHANNELS.signIn, provider),
      cancelSignIn: () => ipcRenderer.invoke(CHANNELS.cancelSignIn),
      share: (options) => ipcRenderer.invoke(CHANNELS.share, options),
      finish: (options) => ipcRenderer.invoke(CHANNELS.finish, options),
      askForScreen: () => ipcRenderer.invoke(CHANNELS.screen),
      setIcon: (picture) => ipcRenderer.invoke(CHANNELS.icon, picture),
      setTray: (pictures) => ipcRenderer.invoke(CHANNELS.tray, pictures),
      signInHere: (name) => ipcRenderer.invoke(CHANNELS.signInHere, name),
      pairedAs: () => ipcRenderer.invoke(CHANNELS.pairedAs),
    }
    contextBridge.exposeInMainWorld("doComputer", bridge)
  }
}
