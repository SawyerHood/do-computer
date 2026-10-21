import { expect, it } from "vitest"
import { ADAPTER_REASON_CHARS, boundedAdapterStatus } from "../src/daemon.ts"

it("bounds what a daemon reports about its adapters", () => {
  const status = boundedAdapterStatus({
    name: "hyprland",
    state: "blocked",
    reason: `grim failed:\n${"x".repeat(2_000)}`,
    tools: Array.from({ length: 50 }, (_, i) => `tool-${i}-${"y".repeat(100)}`),
  })
  expect(status.reason!.length).toBe(ADAPTER_REASON_CHARS)
  expect(status.reason).toMatch(/^grim failed: x+…$/)
  expect(status.tools).toHaveLength(12)
  expect(status.tools!.every((tool) => tool.length <= 40)).toBe(true)
  expect(boundedAdapterStatus({ name: "x", state: "weird" as never }).state).toBe("unsupported")
  expect(boundedAdapterStatus({ name: "x", state: "ready", reason: "  " })).toEqual({
    name: "x",
    state: "ready",
  })
})
