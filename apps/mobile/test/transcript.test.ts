import type { ChatMessage, MessagePart } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import {
  fileIcon,
  isAtEnd,
  isShownHost,
  isUntouched,
  isViewable,
  kindOf,
  lengthOf,
  namedBy,
  sharedPathOf,
  shownAddress,
  shownAs,
  shownMessages,
  shownParts,
  siteOf,
  siteOfFile,
  textOf,
  withHost,
} from "../src/chat/parts/logic.ts"

const text = (value: string): MessagePart => ({ type: "text", text: value })
const message = (
  id: string,
  role: ChatMessage["role"],
  parts: MessagePart[],
  status: ChatMessage["status"] = "done",
): ChatMessage => ({ id, role, parts, status })
const branch = message("b", "notice", [{ type: "notice", kind: "branch", text: "" }])
const screen = (toolCallId: string): MessagePart => ({
  type: "tool",
  toolCallId,
  name: "screen",
  args: { action: "look" },
  status: "done",
  details: { use: { what: "screen", computer: { id: "c", name: "Air" }, say: "Looking" } },
})
const share = (toolCallId: string, id: string): MessagePart => ({
  type: "tool",
  toolCallId,
  name: "share",
  args: { action: "publish" },
  status: "done",
  details: { site: { id, path: "report.html", title: "Report", public: false } },
})

describe("what a transcript shows", () => {
  it("is empty for a new chat, and for a side chat nothing has been said in", () => {
    expect(isUntouched([])).toBe(true)
    expect(isUntouched([branch])).toBe(true)
    expect(shownMessages({ messages: [branch], busy: false }, new Set())).toEqual([])
    expect(isUntouched([branch, message("1", "user", [text("hi")])])).toBe(false)
  })

  it("leaves out an answer made only of tool calls", () => {
    const tool: MessagePart = {
      type: "tool",
      toolCallId: "t",
      name: "bash",
      args: {},
      status: "done",
    }
    const shown = shownMessages(
      {
        messages: [message("1", "user", [text("hi")]), message("2", "assistant", [tool])],
        busy: false,
      },
      new Set(),
    )
    expect(shown.map(({ message }) => message.id)).toEqual(["1"])
  })

  it("shows a screen in use once, where its first step is", () => {
    const messages = [
      message("1", "assistant", [screen("a")]),
      message("2", "assistant", [screen("b")]),
    ]
    const shown = shownMessages({ messages, busy: false }, new Set(["a"]))
    expect(shown.map(({ message }) => message.id)).toEqual(["1"])
  })

  it("says a reply that failed several times once, with the count", () => {
    const failed = (id: string) => message(id, "assistant", [], "error")
    const shown = shownMessages(
      {
        messages: [message("1", "user", [text("hi")]), failed("2"), failed("3"), failed("4")],
        busy: false,
      },
      new Set(),
    )
    expect(shown.map(({ message, failures }) => [message.id, failures])).toEqual([
      ["1", 0],
      ["4", 3],
    ])
  })

  it("draws a site shared twice in one answer as one card", () => {
    const parts = [
      text("Here"),
      share("s1", "abc"),
      share("s2", "abc"),
      share("s3", "xyz"),
      text(""),
    ]
    expect(shownParts(parts)).toEqual([parts[0], parts[1], parts[3]])
  })

  it("copies a message's words and nothing else", () => {
    expect(textOf({ parts: [text("One"), screen("a"), text(""), text("Two")] })).toBe("One\n\nTwo")
  })
})

describe("files and sites", () => {
  it("knows a file's kind from its name, and what the library can show", () => {
    expect(kindOf({ name: "Notes.MD", size: 10 })).toBe("markdown")
    expect(kindOf({ name: "photo.jpeg", size: 9_000_000 })).toBe("image")
    expect(kindOf({ name: "big.csv", size: 2 * 1024 * 1024 })).toBe("other")
    expect(kindOf({ name: "archive.zip", size: 10 })).toBe("other")
    expect(isViewable({ name: "a.html", size: 1, path: "a.html" })).toBe(true)
    expect(isViewable({ name: "a.html", size: 1 })).toBe(false)
    // The library plays a film and a sound, however large, and has nothing for an archive.
    expect(isViewable({ name: "demo.mp4", size: 20_000_000, path: "demo.mp4" })).toBe(true)
    expect(isViewable({ name: "memo", size: 1, path: "memo", contentType: "audio/mpeg" })).toBe(
      true,
    )
    expect(isViewable({ name: "demo.mp4", size: 1 })).toBe(false)
    expect(isViewable({ name: "archive.zip", size: 1, path: "archive.zip" })).toBe(false)
    expect(fileIcon({ name: "a.png", size: 1 })).toBe("photo")
    expect(fileIcon({ name: "a.py", size: 1 })).toBe("code")
    expect(fileIcon({ name: "a.zip", size: 1 })).toBe("doc")
  })

  it("finds the site a file is shared as, a folder's front page included", () => {
    const site = (path: string) => ({
      id: path,
      path,
      title: path,
      public: false,
      agentId: null,
      userId: null,
      createdAt: 0,
      updatedAt: 0,
    })
    expect(sharedPathOf("site/index.html")).toBe("site")
    expect(sharedPathOf("index.html")).toBe("index.html")
    expect(siteOfFile([site("site"), site("a.md")], "site/index.html")?.id).toBe("site")
    expect(siteOfFile([site("site")], "site/other.html")).toBeUndefined()
    expect(siteOfFile(undefined, "a.md")).toBeUndefined()
    expect(shownAddress("https://do.computer/s/abc")).toBe("do.computer/s/abc")
  })
})

describe("what a reply names as a picture", () => {
  it("reads the host a web address is at, and the address as it is asked for", () => {
    expect(siteOf("https://Pictures.Example/cat.png?who=reader")).toEqual({
      host: "pictures.example",
      address: "https://pictures.example/cat.png?who=reader",
    })
    expect(siteOf("http://localhost:8787/a.png")?.host).toBe("localhost:8787")
    // A name before an @ is not where it is, and a backslash is a slash to whatever asks.
    expect(siteOf("https://do.computer@evil.example/a.png")?.host).toBe("evil.example")
    expect(siteOf("https://evil.example\\@do.computer/a.png")).toEqual({
      host: "evil.example",
      address: "https://evil.example/@do.computer/a.png",
    })
    for (const other of [
      "",
      "cat.png",
      "//x.dev/a.png",
      "file:///a.png",
      "https://",
      "ftp://x.dev/a",
    ]) {
      expect(siteOf(other)).toBeUndefined()
    }
  })

  it("shows the app's own deployment and the sites said yes to, and asks of any other", () => {
    expect(isShownHost("do.computer", "https://do.computer", "")).toBe(true)
    expect(isShownHost("localhost:8787", "http://localhost:8787", "")).toBe(true)
    expect(isShownHost("pictures.example", "https://do.computer", "")).toBe(false)
    expect(isShownHost("evil.do.computer", "https://do.computer", "")).toBe(false)
    expect(isShownHost("pictures.example", null, "")).toBe(false)
    const kept = withHost(withHost(withHost("", "a.example"), "b.example"), "a.example")
    expect(kept).toBe("a.example\nb.example")
    expect(isShownHost("b.example", "https://do.computer", kept)).toBe(true)
    expect(isShownHost("example", "https://do.computer", kept)).toBe(false)
    expect(isShownHost("", "https://do.computer", "")).toBe(false)
  })

  it("tells a picture in the reply, at another site and in the library apart", () => {
    expect(namedBy("data:image/png;base64,AAAA")).toEqual({
      at: "reply",
      src: "data:image/png;base64,AAAA",
    })
    expect(namedBy("https://x.dev/a%20b.png")).toEqual({
      at: "site",
      host: "x.dev",
      src: "https://x.dev/a%20b.png",
    })
    expect(namedBy("charts/q3.png")).toEqual({ at: "library", path: "charts/q3.png" })
    expect(namedBy("./charts/../My%20chart.png?v=2")).toEqual({
      at: "library",
      path: "My chart.png",
    })
    expect(namedBy("/notes/a.csv")).toEqual({ at: "library", path: "notes/a.csv" })
    for (const other of ["", "../above.png", "file:///a.png", "data:text/html,<p>", "#top"]) {
      expect(namedBy(other)).toBeUndefined()
    }
  })

  it("shows a picture, a film, a sound and a table as what they are, and only names the rest", () => {
    const file = (name: string, contentType = "application/octet-stream") => ({ name, contentType })
    expect(shownAs(file("q3.PNG"))).toBe("picture")
    expect(shownAs(file("chime.wav"))).toBe("sound")
    expect(shownAs(file("recording", "audio/mpeg; charset=binary"))).toBe("sound")
    expect(shownAs(file("signups.csv"))).toBe("table")
    expect(shownAs(file("signups.tsv"))).toBe("table")
    expect(shownAs(file("clip.mp4"))).toBe("film")
    expect(shownAs(file("Demo.MOV"))).toBe("film")
    expect(shownAs(file("recording", "video/webm"))).toBe("film")
    // A `.ts` file in a library is source code, whatever else the letters stand for.
    expect(shownAs(file("index.ts", "video/mp2t"))).toBeUndefined()
    expect(shownAs(file("plan.md"))).toBeUndefined()
    expect(shownAs(file("report.pdf"))).toBeUndefined()
  })

  it("writes how long a sound is as minutes and seconds", () => {
    expect(lengthOf(0)).toBe("0:00")
    expect(lengthOf(7.9)).toBe("0:07")
    expect(lengthOf(725)).toBe("12:05")
    expect(lengthOf(3723)).toBe("1:02:03")
    expect(lengthOf(Number.NaN)).toBe("0:00")
    expect(lengthOf(Number.POSITIVE_INFINITY)).toBe("0:00")
    expect(lengthOf(-3)).toBe("0:00")
  })
})

describe("being at the end", () => {
  it("counts a reader within a little of the end as at it", () => {
    expect(isAtEnd({ offset: 1200, viewport: 800, content: 2000 })).toBe(true)
    expect(isAtEnd({ offset: 1150, viewport: 800, content: 2000 })).toBe(true)
    expect(isAtEnd({ offset: 900, viewport: 800, content: 2000 })).toBe(false)
  })

  it("counts a chat shorter than the screen as at its end", () => {
    expect(isAtEnd({ offset: 0, viewport: 800, content: 300 })).toBe(true)
  })

  it("puts the end further on by the room kept under the content for the keyboard", () => {
    expect(isAtEnd({ offset: 1200, viewport: 800, content: 2000, inset: 300 })).toBe(false)
    expect(isAtEnd({ offset: 1500, viewport: 800, content: 2000, inset: 300 })).toBe(true)
  })
})
