import {
  AgentOrbCore,
  type MascotCore,
  type MascotState,
  type MascotVariant,
  type Orb,
} from "@durable-computer/mascot"
import { type Avatar as AvatarSpec, avatarLook, avatarSvg } from "@durable-computer/protocol"
import { type ExpoWebGLRenderingContext, GLView } from "expo-gl"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, PixelRatio, useColorScheme, View } from "react-native"
import { SvgXml } from "react-native-svg"
import * as THREE from "three"

/** What an agent's creature is doing. */
export type Mood = { state: MascotState; variant?: MascotVariant }

const IDLE: Mood = { state: "idle" }
/** The creature keeps room around itself for hops and rings, so it is drawn past its box. */
const SPILL = 1.24
/** It is drawn at a console's frame rate, like the web one. */
const FRAME_MS = 1000 / 30

let core: MascotCore | null | undefined

/** The creature's drawing code, built once. Null if this device cannot run it. */
function mascots(): MascotCore | null {
  if (core === undefined) {
    try {
      core = AgentOrbCore(THREE)
    } catch {
      core = null
    }
  }
  return core
}

/** The creatures on screen that show a given agent, so that what it does can reach them all. */
const shown = new Map<string, Set<Orb>>()

/** A word of the agent's answer arrived, or its user pressed a key: its creature moves with it. */
export function feedMascot(agentId: string, kind: "token" | "key"): void {
  for (const orb of shown.get(agentId) ?? []) {
    if (kind === "token") orb.feed("token")
    else orb.feed("key")
  }
}

/** three.js asks its canvas for a few things. A GL view has no canvas, so this stands in for one. */
function canvasFor(gl: ExpoWebGLRenderingContext) {
  return {
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    clientWidth: gl.drawingBufferWidth,
    clientHeight: gl.drawingBufferHeight,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => gl,
  }
}

/**
 * An agent's creature: grown from its seed, in its color, and acting out what the agent is doing.
 * It is drawn small and scaled up in whole pixels, as on the web. Where it cannot be drawn, a
 * still picture of a plain creature in the same color is shown.
 */
export function Avatar({
  avatar,
  seed,
  size = 36,
  mood = IDLE,
  hatched = true,
  hatching = false,
  onHatched,
}: {
  avatar: AvatarSpec | null | undefined
  /** The agent's id: what the creature grows from unless it was given a seed of its own. */
  seed: string
  size?: number
  mood?: Mood
  /** False while it is still in its egg. */
  hatched?: boolean
  /** Play the hatch. Going back to false while it plays skips to its end. */
  hatching?: boolean
  /** Called once the hatch is over, skipped, or could not be drawn at all. */
  onHatched?: () => void
}) {
  const look = useMemo(() => avatarLook(avatar, seed), [avatar, seed])
  const xml = useMemo(() => avatarSvg(avatar, seed), [avatar, seed])
  const dark = useColorScheme() !== "light"
  // Undefined until the view has a context; null if the creature could not be drawn in it.
  const [orb, setOrb] = useState<Orb | null>()
  const [drawn, setDrawn] = useState(false)
  const stop = useRef<() => void>(undefined)
  const done = useRef(onHatched)
  done.current = onHatched
  const first = useRef({ look, hatched, dark, size })

  const start = useCallback(
    (gl: ExpoWebGLRenderingContext) => {
      stop.current?.()
      const lib = mascots()
      if (lib === null) return setOrb(null)
      try {
        const begin = first.current
        const width = gl.drawingBufferWidth
        const height = gl.drawingBufferHeight
        const renderer = new THREE.WebGLRenderer({
          canvas: canvasFor(gl) as unknown as HTMLCanvasElement,
          context: gl as unknown as WebGLRenderingContext,
          alpha: true,
          antialias: false,
          premultipliedAlpha: true,
        })
        renderer.setPixelRatio(1)
        renderer.setSize(width, height, false)
        renderer.setClearColor(0x000000, 0)
        const created = new lib.Orb(null, {
          seed: begin.look.seed,
          color: begin.look.color,
          size: begin.size * SPILL,
          pixelRatio: PixelRatio.get(),
          dark: begin.dark,
          notice: false,
        })
        if (!begin.hatched) created.setState("egg")
        // Drawn at its own low resolution, then put on screen with hard pixels.
        const target = new THREE.WebGLRenderTarget(created.px, created.px, {
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
        })
        const screen = new THREE.Scene()
        const quad = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          new THREE.MeshBasicMaterial({
            map: target.texture,
            transparent: true,
            premultipliedAlpha: true,
            depthTest: false,
          }),
        )
        screen.add(quad)
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

        let frame = 0
        let last: number | undefined
        let owed = 0
        let live = true
        let seen = false
        const fail = () => {
          live = false
          cancelAnimationFrame(frame)
          setOrb(null)
        }
        const draw = (time: number) => {
          if (!live) return
          frame = requestAnimationFrame(draw)
          owed += last === undefined ? FRAME_MS : time - last
          last = time
          if (owed < FRAME_MS) return
          try {
            created.update(Math.min(owed, 250) / 1000)
            owed = 0
            renderer.setRenderTarget(target)
            renderer.clear()
            lib.Stage.drawAt(created, renderer, 0, 0)
            renderer.setRenderTarget(null)
            renderer.setViewport(0, 0, width, height)
            renderer.setScissor(0, 0, width, height)
            renderer.clear()
            renderer.render(screen, camera)
            gl.endFrameEXP?.()
            if (!seen) {
              seen = true
              setDrawn(true)
            }
          } catch {
            // A device that cannot run its shaders gets the still picture instead.
            fail()
          }
        }
        frame = requestAnimationFrame(draw)

        const orbs = shown.get(seed) ?? new Set()
        shown.set(seed, orbs)
        orbs.add(created)
        stop.current = () => {
          live = false
          cancelAnimationFrame(frame)
          orbs.delete(created)
          if (orbs.size === 0) shown.delete(seed)
          created.dispose()
          target.dispose()
          quad.geometry.dispose()
          quad.material.dispose()
          renderer.dispose()
        }
        void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
          created.reduced = reduced
        })
        setOrb(created)
      } catch {
        setOrb(null)
      }
    },
    [seed],
  )
  useEffect(() => () => stop.current?.(), [])

  useEffect(() => {
    orb?.setSeed(look.seed)
    orb?.setColor(look.color)
  }, [orb, look])
  useEffect(() => orb?.setTheme(dark), [orb, dark])

  useEffect(() => {
    if (orb === undefined) return
    if (hatching) {
      // Nothing to watch where it cannot be drawn: it is simply out.
      if (orb === null) done.current?.()
      else orb.hatch({ onDone: () => done.current?.() })
    } else if (orb?.getState() === "hatching") {
      orb.skipHatch()
    }
  }, [orb, hatching])

  useEffect(() => {
    if (orb === undefined || orb === null || hatching || orb.getState() === "hatching") return
    if (hatched) orb.setState(mood.state, mood.variant)
    else orb.setState("egg")
  }, [orb, hatched, hatching, mood.state, mood.variant])

  const spill = (size * (SPILL - 1)) / 2
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Agent avatar"
      testID={`avatar-${hatched ? mood.state : "egg"}`}
      style={{ width: size, height: size }}
    >
      {orb && drawn ? null : <SvgXml xml={xml} width={size} height={size} />}
      {orb === null ? null : (
        <GLView
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -spill,
            left: -spill,
            width: size * SPILL,
            height: size * SPILL,
            opacity: drawn ? 1 : 0,
          }}
          onContextCreate={start}
        />
      )}
    </View>
  )
}
