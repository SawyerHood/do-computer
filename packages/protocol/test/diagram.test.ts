import { describe, expect, it } from "vitest"
import { diagramFit, diagramMessage, readDiagramMessage } from "../src/diagram.ts"

describe("a diagram drawn for a client that cannot draw one", () => {
  it("reads what the page said, as the message itself or written out", () => {
    expect(readDiagramMessage(diagramMessage({ kind: "ready" }))).toEqual({ kind: "ready" })
    expect(
      readDiagramMessage(JSON.stringify(diagramMessage({ kind: "drawn", width: 320, height: 90 }))),
    ).toEqual({ kind: "drawn", width: 320, height: 90 })
    expect(readDiagramMessage(diagramMessage({ kind: "failed" }))).toEqual({ kind: "failed" })
  })

  it("reads nothing from what is not the page speaking, or a size that is no size", () => {
    expect(readDiagramMessage("not json")).toBeUndefined()
    expect(readDiagramMessage({ kind: "ready" })).toBeUndefined()
    expect(
      readDiagramMessage({ type: "dc-diagram", kind: "drawn", width: 0, height: 9 }),
    ).toBeUndefined()
    expect(
      readDiagramMessage({ type: "dc-diagram", kind: "drawn", width: "320", height: 90 }),
    ).toBeUndefined()
  })

  it("shows a diagram as it was drawn where it fits, and no smaller than four fifths where it does not", () => {
    expect(diagramFit({ width: 200, height: 100 }, 360)).toEqual({ width: 200, height: 100 })
    // Nearly fits: made as wide as the room.
    expect(diagramFit({ width: 400, height: 100 }, 360)).toEqual({ width: 360, height: 90 })
    // Far too wide: four fifths of its size, to be scrolled.
    expect(diagramFit({ width: 1000, height: 100 }, 360)).toEqual({ width: 800, height: 80 })
  })
})
