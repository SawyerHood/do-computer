import { describe, expect, it } from "vitest"
import {
  type ChatState,
  EMPTY_CHAT,
  isShownPart,
  isSiteShare,
  isVisual,
  prepareVisual,
  readVisualHeight,
  readVisualLink,
  sentFiles,
  siteRoot,
  siteTitleFor,
  type ToolPart,
  toolActivity,
  toolSummary,
  VISUAL_MAX_HEIGHT,
  VISUAL_MIN_HEIGHT,
  visualFileName,
  visualFrameHeight,
  visualThemeFragment,
  visualThemeMessage,
} from "../src/index.ts"

const MARK = '<style id="dc-visual-theme">'

describe("a visual's page", () => {
  it("is given the app's colors at the start of its head, before anything of its own", () => {
    const page = prepareVisual(
      "<!doctype html><html><head><title>T</title><style>p{color:red}</style></head><body><p>x</p></body></html>",
    )
    expect(page.indexOf(MARK)).toBeGreaterThan(page.indexOf("<head>"))
    expect(page.indexOf(MARK)).toBeLessThan(page.indexOf("<title>"))
    expect(page.indexOf(MARK)).toBeLessThan(page.indexOf("p{color:red}"))
    expect(page).toContain("--chart-6")
    expect(page).toContain('<meta name="viewport"')
    // What the agent wrote is all still there, in order.
    expect(page.endsWith("<body><p>x</p></body></html>")).toBe(true)
  })

  it("is given a head where it has none", () => {
    expect(prepareVisual("<html><body>x</body></html>")).toMatch(
      /^<html><head>.*<\/head><body>x<\/body><\/html>$/s,
    )
    expect(prepareVisual("<!DOCTYPE html>\n<p>x</p>")).toMatch(
      /^<!DOCTYPE html><head>.*<\/head>\n<p>x<\/p>$/s,
    )
    expect(prepareVisual("<p>just this</p>")).toMatch(
      /^<!doctype html><head>.*<\/head><p>just this<\/p>$/s,
    )
  })

  it("is not taken in by a head that is only written about", () => {
    const page = prepareVisual(
      "<!-- <head> --><script>const s = '<head>'</script><html><head><title>x</title></head></html>",
    )
    expect(page.indexOf(MARK)).toBeGreaterThan(page.indexOf("<html>"))
    expect(page.match(/dc-visual-theme/g)?.length).toBe(1)
  })

  it("keeps its own charset and viewport, and is prepared only once", () => {
    const page = prepareVisual(
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=400"></head></html>',
    )
    expect(page.match(/<meta charset/g)?.length).toBe(1)
    expect(page.match(/name="viewport"/g)?.length).toBe(1)
    expect(prepareVisual(page)).toBe(page)
  })

  it("is kept under its title, in letters a path can hold", () => {
    expect(visualFileName("Signups by week, Q3")).toBe("signups-by-week-q3.html")
    expect(visualFileName("  ¿Qué?  ")).toBe("que.html")
    expect(visualFileName("!!!")).toBe("visual.html")
    expect(visualFileName("a".repeat(200)).length).toBeLessThanOrEqual(65)
  })
})

describe("what a visual and its frame say to each other", () => {
  it("reads how tall the page is, and nothing else as that", () => {
    const said = (params: unknown) => ({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params,
    })
    expect(readVisualHeight(said({ height: 312 }))).toBe(312)
    expect(readVisualHeight(said({ height: -1 }))).toBeUndefined()
    expect(readVisualHeight(said({ height: "312" }))).toBeUndefined()
    expect(readVisualHeight({ method: "ui/notifications/size-changed" })).toBeUndefined()
    expect(readVisualHeight("312")).toBeUndefined()
  })

  it("keeps the frame within its bounds", () => {
    expect(visualFrameHeight(312.4)).toBe(312)
    expect(visualFrameHeight(3)).toBe(VISUAL_MIN_HEIGHT)
    expect(visualFrameHeight(99_999)).toBe(VISUAL_MAX_HEIGHT)
  })

  it("opens only a web address for a page", () => {
    const asked = (url: unknown) => ({
      jsonrpc: "2.0",
      id: "dc-link-1",
      method: "ui/open-link",
      params: { url },
    })
    expect(readVisualLink(asked("https://example.com/a"))).toEqual({
      id: "dc-link-1",
      url: "https://example.com/a",
    })
    expect(readVisualLink(asked("javascript:alert(1)"))).toBeUndefined()
    expect(readVisualLink(asked("file:///etc/passwd"))).toBeUndefined()
    expect(readVisualLink({ ...asked("https://example.com"), id: undefined })).toBeUndefined()
  })

  it("tells the page its colors on its address and by message", () => {
    const theme = { appearance: "dark", color: "oklch(0.6 0.1 150)" } as const
    expect(decodeURIComponent(visualThemeFragment(theme))).toBe(
      `#dc-theme=${JSON.stringify(theme)}`,
    )
    expect(visualThemeMessage(theme).params).toEqual({
      theme: "dark",
      styles: { variables: { "--agent-color": "oklch(0.6 0.1 150)" } },
    })
  })
})

const tool = (name: string, args: Record<string, unknown>, details?: unknown): ToolPart =>
  ({ type: "tool", toolCallId: `${name}-1`, name, args, status: "done", details }) as ToolPart
const file = { id: "f1", path: "visuals/signups.html", name: "signups.html" }
const site = { id: "abc", path: "sites/plan", title: "Plan", public: false }

describe("visuals and sites in a transcript", () => {
  it("shows a visual the agent drew, and lists it with the files it sent", () => {
    const drawn = tool("visual", { title: "Signups", html: "<p>" }, file)
    expect(isVisual(drawn)).toBe(true)
    expect(isShownPart(drawn)).toBe(true)
    // One still being drawn, or one that failed, has no page to show.
    expect(isVisual({ ...drawn, status: "running" })).toBe(false)
    expect(isVisual(tool("visual", { title: "x" }))).toBe(false)
    const state: ChatState = {
      ...EMPTY_CHAT,
      messages: [{ id: "1", role: "assistant", status: "done", parts: [drawn] }],
    }
    expect(sentFiles(state).map((sent) => sent.path)).toEqual(["visuals/signups.html"])
  })

  it("shows a site where the agent shared it or changed who can open it", () => {
    expect(isSiteShare(tool("share", { action: "publish", path: "sites/plan" }, { site }))).toBe(
      true,
    )
    expect(isSiteShare(tool("share", { action: "public", site: "Plan" }, { site }))).toBe(true)
    expect(isSiteShare(tool("share", { action: "list" }))).toBe(false)
    expect(isSiteShare(tool("share", { action: "stop", site: "Plan" }))).toBe(false)
  })

  it("says what the agent is doing with them", () => {
    expect(toolActivity(tool("visual", { title: "Signups by week" }))).toBe(
      "Drawing: Signups by week",
    )
    expect(toolSummary(tool("visual", { title: "Signups by week" }))).toBe("Drew: Signups by week")
    expect(toolActivity(tool("share", { action: "publish", path: "sites/plan" }))).toBe(
      "Sharing a site: sites/plan",
    )
    expect(toolSummary(tool("share", { action: "public", site: "Plan" }))).toBe(
      "Made a site public: Plan",
    )
    expect(toolActivity(tool("share", { action: "list" }))).toBe("Looking at the shared sites")
  })
})

describe("what a site would serve", () => {
  const paths = [
    "sites/plan/index.html",
    "sites/plan/style.css",
    "visuals/signups.html",
    "notes/todo.md",
    "drafts/a.html",
    "drafts/b.html",
    "index.html",
  ]

  it("is a folder, for a folder with a front page or for that front page", () => {
    expect(siteRoot(paths, "sites/plan")).toEqual({ path: "sites/plan", kind: "folder" })
    expect(siteRoot(paths, "sites/plan/")).toEqual({ path: "sites/plan", kind: "folder" })
    expect(siteRoot(paths, "sites/plan/index.html")).toEqual({ path: "sites/plan", kind: "folder" })
    expect(siteRoot(paths, "~/library/sites/plan")).toEqual({ path: "sites/plan", kind: "folder" })
  })

  it("is one page, for a page named by itself", () => {
    expect(siteRoot(paths, "visuals/signups.html")).toEqual({
      path: "visuals/signups.html",
      kind: "page",
    })
    // The library's own front page is a page: the whole library is never one site.
    expect(siteRoot(paths, "index.html")).toEqual({ path: "index.html", kind: "page" })
  })

  it("is nothing, for what is not a page or has no front page", () => {
    expect(siteRoot(paths, "notes/todo.md")).toHaveProperty("error")
    expect(siteRoot(paths, "drafts")).toHaveProperty("error")
    expect(siteRoot(paths, "nowhere")).toHaveProperty("error")
    expect(siteRoot(paths, "  ")).toHaveProperty("error")
    expect(siteRoot(paths, "sites/../notes")).toHaveProperty("error")
  })

  it("is called after its page or folder where nobody names it", () => {
    expect(siteTitleFor("sites/launch-plan")).toBe("Launch plan")
    expect(siteTitleFor("visuals/signups_q3.html")).toBe("Signups q3")
  })
})
