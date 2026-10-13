import { describe, expect, it } from "vitest"
import { contentTypeOf, embedKind, INLINE_IMAGE_TYPES } from "../src/index.ts"

/** The type the library gave each extension before there was one table. */
const OLD_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  map: "application/json",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  xml: "application/xml",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  wasm: "application/wasm",
  zip: "application/zip",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
}

/** The kind the web app gave each extension before there was one table. */
const OLD_KINDS: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  html: "page",
  htm: "page",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  txt: "text",
  csv: "text",
  json: "text",
  css: "text",
  js: "text",
  mjs: "text",
  ts: "text",
  py: "text",
  sh: "text",
  xml: "text",
  yaml: "text",
  yml: "text",
  toml: "text",
  log: "text",
}

describe("the content type a name stands for", () => {
  it("is what the library said for every extension it knew", () => {
    for (const [extension, type] of Object.entries(OLD_TYPES)) {
      expect(contentTypeOf(`file.${extension}`), extension).toBe(type)
    }
  })

  it("knows films, sounds and tables the library did not", () => {
    expect(contentTypeOf("clip.mov")).toBe("video/quicktime")
    expect(contentTypeOf("clip.m4v")).toBe("video/mp4")
    expect(contentTypeOf("clip.ogv")).toBe("video/ogg")
    expect(contentTypeOf("memo.m4a")).toBe("audio/mp4")
    expect(contentTypeOf("memo.ogg")).toBe("audio/ogg")
    expect(contentTypeOf("memo.oga")).toBe("audio/ogg")
    expect(contentTypeOf("memo.flac")).toBe("audio/flac")
    expect(contentTypeOf("memo.aac")).toBe("audio/aac")
    expect(contentTypeOf("rows.tsv")).toBe("text/tab-separated-values")
  })

  it("is some kind of text for every extension the web app showed as text", () => {
    for (const [extension, kind] of Object.entries(OLD_KINDS)) {
      if (kind !== "text" || extension in OLD_TYPES) continue
      expect(contentTypeOf(`file.${extension}`), extension).toMatch(/^text\//)
    }
    // Source code, whatever else the letters stand for elsewhere.
    expect(contentTypeOf("main.ts")).toBe("text/typescript")
  })

  it("goes by the last extension, in any case, and says nothing for one it does not know", () => {
    expect(contentTypeOf("Chart.PNG")).toBe("image/png")
    expect(contentTypeOf("notes/2026/plan.final.md")).toBe("text/markdown")
    expect(contentTypeOf("mystery.bin")).toBe("application/octet-stream")
    expect(contentTypeOf("no extension")).toBe("application/octet-stream")
    // Every object answers to these. Neither is an extension.
    expect(contentTypeOf("file.constructor")).toBe("application/octet-stream")
    expect(contentTypeOf("file.__proto__")).toBe("application/octet-stream")
  })
})

describe("the kind of thing a file is", () => {
  it("is what the web app said for every extension it knew, but a CSV is a table", () => {
    for (const [extension, kind] of Object.entries(OLD_KINDS)) {
      expect(embedKind(`file.${extension}`), extension).toBe(extension === "csv" ? "table" : kind)
    }
  })

  it("is a film, a sound, a table or a PDF by its name", () => {
    for (const name of ["a.mp4", "a.m4v", "a.mov", "a.webm", "a.ogv"]) {
      expect(embedKind(name), name).toBe("video")
    }
    for (const name of ["a.mp3", "a.wav", "a.m4a", "a.ogg", "a.oga", "a.flac", "a.aac"]) {
      expect(embedKind(name), name).toBe("audio")
    }
    expect(embedKind("rows.csv")).toBe("table")
    expect(embedKind("rows.TSV")).toBe("table")
    expect(embedKind("paper.pdf")).toBe("pdf")
    expect(embedKind("drawing.svg")).toBe("image")
    expect(embedKind("favicon.ico")).toBe("image")
  })

  it("is only a download for what cannot be shown", () => {
    for (const name of ["a.zip", "a.wasm", "a.woff2", "a.ttf", "a.js.map", "a.bin", "a"]) {
      expect(embedKind(name), name).toBe("other")
    }
    expect(embedKind("file.constructor")).toBe("other")
  })

  it("goes by the name before the content type", () => {
    expect(embedKind("clip.mp4", "application/octet-stream")).toBe("video")
    expect(embedKind("notes.md", "text/plain")).toBe("markdown")
    expect(embedKind("page.html", "video/mp4")).toBe("page")
  })

  it("goes by a definite content type where the name says nothing", () => {
    expect(embedKind("clip", "video/x-matroska")).toBe("video")
    expect(embedKind("clip.mkv", "video/x-matroska")).toBe("video")
    expect(embedKind("memo", "audio/x-aiff")).toBe("audio")
    expect(embedKind("photo.heic", "image/heic")).toBe("image")
    expect(embedKind("paper", "application/pdf")).toBe("pdf")
    expect(embedKind("page", "Text/HTML; charset=utf-8")).toBe("page")
    expect(embedKind("notes", "text/markdown")).toBe("markdown")
    expect(embedKind("rows", "text/csv")).toBe("table")
    expect(embedKind("rows", "text/tab-separated-values")).toBe("table")
    expect(embedKind("readme", "text/plain; charset=utf-8")).toBe("text")
    expect(embedKind("main.rs", "text/x-rust")).toBe("text")
  })

  it("is only a download where neither says", () => {
    expect(embedKind("mystery.bin")).toBe("other")
    expect(embedKind("mystery.bin", "")).toBe("other")
    expect(embedKind("mystery.bin", "application/octet-stream")).toBe("other")
    expect(embedKind("data", "application/json")).toBe("other")
  })
})

describe("the pictures served in place from the app's own address", () => {
  it("are the four made of dots, and never an SVG", () => {
    expect([...INLINE_IMAGE_TYPES].sort()).toEqual([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ])
    expect(INLINE_IMAGE_TYPES.has(contentTypeOf("drawing.svg"))).toBe(false)
  })
})
