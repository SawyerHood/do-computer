import { AgentOrbCore, AgentOrbWardrobe, type Orb } from "@durable-computer/mascot"
import { RARITIES, WEAR_ITEMS } from "@durable-computer/protocol"
import * as THREE from "three"
import { describe, expect, it } from "vitest"

const core = AgentOrbCore(THREE)
const wardrobe = AgentOrbWardrobe(THREE, core)

/** A creature on no page: it is fitted and stepped here, and never drawn. */
const creature = (seed: string) => new core.Orb(null, { seed, size: 190 })
const FRAME = 1 / 30
/** Let it live for a while, a frame at a time. */
function live(orb: Orb, seconds: number, each?: () => void): void {
  for (let lived = 0; lived < seconds; lived += FRAME) {
    orb.update(FRAME)
    each?.()
  }
}
/** What the wardrobe changes about a creature's own body, and puts back. */
type Body = {
  fill: number
  rest: number
  body: { children: unknown[] }
  uB: {
    uBump: { value: { toArray(): number[] }[] }
    uTop: { value: { w: number } }
    uMouth: { value: { y: number; z: number } }
  }
}
const bodyOf = (orb: Orb) => orb as unknown as Body
const shapeOf = (orb: Orb) => {
  const { fill, rest, uB } = bodyOf(orb)
  return { fill, rest, top: uB.uTop.value.w, bumps: uB.uBump.value.map((bump) => bump.toArray()) }
}

describe("what a creature can wear", () => {
  it("has a shape for every thing the app knows of, worn where the app says", () => {
    expect(Object.keys(wardrobe.ITEMS).sort()).toEqual(WEAR_ITEMS.map((item) => item.id).sort())
    for (const item of WEAR_ITEMS) expect(wardrobe.ITEMS[item.id]).toBe(item.slot)
  })

  it("never puts any part of a thing inside the body, whatever seed the body grew from", () => {
    const orb = creature("first")
    const sunk: string[] = []
    for (let seed = 0; seed < 60; seed++) {
      orb.setSeed(`fitting/${seed}`)
      for (const item of WEAR_ITEMS) {
        wardrobe.dress(orb, { [item.slot]: item.id })
        // A hundredth of the body's radius is less than a pixel at any size it is drawn.
        if (wardrobe.audit(orb) > 0.012) sunk.push(`${item.id} on fitting/${seed}`)
      }
    }
    orb.dispose()
    expect(sunk).toEqual([])
  })

  it("lets every thing be worn for a while, what moves moving, and be shown out of a box", () => {
    const orb = creature("Juniper")
    orb.reduced = true
    for (const item of WEAR_ITEMS) {
      wardrobe.dress(orb, { [item.slot]: item.id })
      live(orb, 0.5)
      expect(bodyOf(orb).body.children, item.id).toHaveLength(1)
      const box = wardrobe.unwrap(orb)
      box.open({ id: item.id, tiers: ["#9aa3ad"] })
      live(orb, 0.1)
      expect(box.phase, item.id).toBe("shown")
      box.dispose()
    }
    orb.dispose()
  })

  it("gives a creature its ears, horn or antenna back when its hat comes off", () => {
    for (const seed of ["Juniper", "Pilar", "fitting/3", "fitting/8", "fitting/21"]) {
      const orb = creature(seed)
      const before = shapeOf(orb)
      for (const hat of ["tophat", "party", "beanie", "catears", "halo"]) {
        wardrobe.dress(orb, { hat })
        wardrobe.strip(orb)
        expect(shapeOf(orb)).toEqual(before)
      }
      orb.dispose()
    }
  })

  it("fits what it wears again when the creature grows from a new seed", () => {
    const orb = creature("one")
    wardrobe.dress(orb, { hat: "tophat", glasses: "round", neck: "scarf" })
    orb.setSeed("another")
    expect(bodyOf(orb).body.children).toHaveLength(1)
    expect(wardrobe.audit(orb)).toBeLessThanOrEqual(0.012)
    orb.dispose()
  })

  it("leaves off a thing it has no shape for, and a thing named for the wrong place", () => {
    const orb = creature("one")
    wardrobe.dress(orb, { hat: "no-such-thing", neck: "tophat" })
    expect(bodyOf(orb).body.children).toHaveLength(0)
    orb.dispose()
  })
})

describe("a treat", () => {
  it("opens the creature's mouth while it is held out, and a bite snaps it wide and shut", () => {
    const orb = creature("Juniper")
    const mouth = () => bodyOf(orb).uB.uMouth.value
    live(orb, 1)
    const shut = { ...mouth() }
    orb.offer(true)
    live(orb, 0.5)
    expect(mouth().z).toBeGreaterThan(shut.z + 0.5)
    expect(mouth().y).toBeGreaterThan(shut.y * 1.5)
    orb.bite()
    live(orb, 1)
    expect(mouth().z).toBeCloseTo(shut.z, 1)
    orb.dispose()
  })
})

describe("a box", () => {
  const colors = RARITIES.map((rarity) => rarity.color)

  /** Open a box on a thing of the given rarity, and say when it burst and when it was shown. */
  function open(rarity: number) {
    const orb = creature("Juniper")
    const heard: { pop?: number; shown?: number } = {}
    let lived = 0
    const box = wardrobe.unwrap(orb, {
      onPop: () => (heard.pop = lived),
      onShown: () => (heard.shown = lived),
    })
    expect(orb.hidden).toBe(true)
    expect(box.phase).toBe("shut")
    box.shake()
    live(orb, 0.5)
    expect(box.phase).toBe("shake")
    box.open({ id: "crown", tiers: colors.slice(0, rarity + 1) })
    live(orb, 6, () => (lived += FRAME))
    expect(box.phase).toBe("shown")
    box.dispose()
    expect(orb.hidden).toBe(false)
    orb.dispose()
    return heard
  }

  it("bursts, and then shows what was inside", () => {
    const common = open(0)
    expect(common.pop).toBeGreaterThan(0.8)
    expect(common.pop).toBeLessThan(1.1)
    expect(common.shown).toBeGreaterThan(common.pop!)
  })

  it("keeps you waiting longer the rarer the thing is: a jolt for each rarity on the way", () => {
    const waits = RARITIES.map((_, rarity) => open(rarity).pop!)
    expect(waits).toEqual([...waits].sort((a, b) => a - b))
    expect(waits[4]! - waits[0]!).toBeGreaterThan(1.5)
  })

  it("is simply open for someone who asked for less motion", () => {
    const orb = creature("Juniper")
    orb.reduced = true
    let shown = false
    const box = wardrobe.unwrap(orb, { onShown: () => (shown = true) })
    box.open({ id: "party", tiers: colors.slice(0, 3) })
    live(orb, 0.1)
    expect(shown).toBe(true)
    orb.dispose()
  })
})
