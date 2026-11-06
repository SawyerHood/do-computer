import { expect, it } from "vitest"
import { avatarSvg } from "../src/avatar-svg.ts"
it("keeps default avatar framing and grounding for larger creatures", () => {
  const svg = avatarSvg(null, "example")
  expect(svg).toContain('viewBox="0 0 64 64"')
  expect(svg).toContain('cy="56"')
})
it("uses a shadowless compact viewBox without changing the creature color or eyes", () => {
  const regular = avatarSvg(null, "example")
  const compact = avatarSvg(null, "example", true)
  expect(compact).toContain('viewBox="10 10 44 44"')
  expect(compact).not.toContain('cy="56"')
  expect(compact.match(/<path[^>]+>/)?.[0]).toBe(regular.match(/<path[^>]+>/)?.[0])
  expect(compact).toContain('rx="4.2"')
})
