import { readVisualMode, readVisualSave, readVisualSay } from "@do-computer/protocol"
import { describe, expect, it, vi } from "vitest"

// The script is a string run in a page; the web view that runs it needs a device.
vi.mock("react-native", () => ({ Linking: {}, Platform: { OS: "ios" }, View: () => null }))
vi.mock("react-native-webview", () => ({ WebView: () => null }))

const { SAY_SCRIPT } = await import("../src/chat/parts/visual-frame.native.tsx")

type Dc = {
  say?: (text: unknown) => boolean
  expand?: (large?: boolean) => boolean
  save?: (name: string, text: string, type?: string) => boolean
}
type Page = { dc?: Dc; ReactNativeWebView?: { postMessage(data: string): void } }

/** A page's window, with the app listening to it, in which the script has been run. */
function page(before: Partial<Page> = {}) {
  const heard: unknown[] = []
  const window: Page = {
    ReactNativeWebView: { postMessage: (data) => heard.push(JSON.parse(data)) },
    ...before,
  }
  const run = () => new Function("window", SAY_SCRIPT)(window)
  run()
  return { window, heard, run }
}

describe("a visual's words on a phone", () => {
  it("gives the page's own dc a say that tells the app, whenever the page makes its dc", () => {
    const { window, heard } = page()
    // The page's own script runs after, and makes a `dc` whose `say` does nothing here.
    window.dc = { say: () => false, expand: () => false }
    expect(window.dc.say?.("Go with plan B")).toBe(true)
    expect(heard).toHaveLength(1)
    expect(readVisualSay(heard[0])).toEqual({ id: "dc-say-1", text: "Go with plan B" })
  })

  it("gives it an expand and a save that tell the app too, in the words a frame would hear", () => {
    const { window, heard } = page()
    window.dc = { say: () => false, expand: () => false, save: () => false }
    expect(window.dc.expand?.()).toBe(true)
    expect(window.dc.expand?.(false)).toBe(true)
    expect(window.dc.save?.("../figures.csv", "a,b\n1,2", "text/csv")).toBe(true)
    expect(readVisualMode(heard[0])).toEqual({ id: "dc-expand-1", mode: "fullscreen" })
    expect(readVisualMode(heard[1])).toEqual({ id: "dc-expand-2", mode: "inline" })
    expect(readVisualSave(heard[2])).toEqual({
      id: "dc-save-3",
      name: "figures.csv",
      type: "text/csv",
      text: "a,b\n1,2",
    })
  })

  it("does the same for a dc that was there before it ran, and only once however often it runs", () => {
    const { window, heard, run } = page({ dc: { say: () => false } })
    run()
    expect(window.dc?.say?.(42)).toBe(true)
    expect(window.dc?.say?.("again")).toBe(true)
    expect(heard.map((said) => readVisualSay(said))).toEqual([
      { id: "dc-say-1", text: "42" },
      { id: "dc-say-2", text: "again" },
    ])
  })

  it("says nothing where there is no app to hear it", () => {
    const { window, heard } = page({ ReactNativeWebView: undefined })
    window.dc = { say: () => false }
    expect(window.dc.say?.("hello")).toBe(false)
    expect(heard).toEqual([])
  })
})
