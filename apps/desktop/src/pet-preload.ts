import { contextBridge, ipcRenderer } from "electron"
import { PET, type PetBridge, type PetInfo, type Place, type Point } from "./companion-place.ts"

// Only the companion's window has this script. The app is asked, before the page has run
// anything, whether this is the companion's page on the deployment it is set to, and gives
// nothing to any other. It checks who is speaking again each time it is spoken to.
if (location.protocol === "https:" || location.protocol === "http:") {
  const info = ipcRenderer.sendSync(PET.info) as PetInfo | null
  if (info !== null) {
    const bridge: PetBridge = {
      ...info,
      onAgent: (listener) => {
        ipcRenderer.on(PET.agent, (_event, agentId: string) => listener(agentId))
      },
      onPlace: (listener) => {
        ipcRenderer.on(PET.place, (_event, place: Place) => listener(place))
      },
      onPointer: (listener) => {
        ipcRenderer.on(PET.pointer, (_event, at: Point) => listener(at))
      },
      showing: (agentId) => ipcRenderer.send(PET.showing, agentId),
      areas: (rects) => ipcRenderer.send(PET.areas, rects),
      drag: (on) => ipcRenderer.send(PET.drag, on),
      open: (agentId, chatId) => ipcRenderer.send(PET.open, agentId, chatId),
      menu: () => ipcRenderer.send(PET.menu),
    }
    contextBridge.exposeInMainWorld("doComputerPet", bridge)
  }
}
