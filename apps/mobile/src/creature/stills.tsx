import {
  type AgentSummary,
  avatarLook,
  type Outfit,
  type WearItem,
} from "@do-computer/protocol"
import { type ExpoWebGLRenderingContext, GLView } from "expo-gl"
import { Image } from "expo-image"
import { useEffect, useState } from "react"
import { PixelRatio, Platform, useColorScheme, View } from "react-native"
import * as THREE from "three"
import { takeTurn } from "@/ui/gl-turn"
import { Avatar, canvasFor, mascots, mascotWardrobe, SPILL } from "@/ui/avatar"

/**
 * Pictures of a creature wearing one thing, for a wardrobe's tiles. A tile with a GL view of its
 * own costs a context, a renderer and the creature's shaders each, and a wardrobe shows dozens.
 * So the pictures are drawn one after another in a single context that has no view, saved as
 * files, and shown as images. The files are remembered for as long as the app runs.
 *
 * Where that cannot be done (the browser build, a device whose context will not start, a
 * snapshot that fails) a tile falls back to `Avatar still`, which is the same picture drawn live.
 * Turn `SNAPSHOTS` off to use that everywhere.
 */
const SNAPSHOTS = Platform.OS !== "web"

/** The side of a tile's picture, in points. Pictures are drawn for this size and no other. */
export const STILL = 68
/** How many frames it is given to take up its pose, as a still `Avatar` is. */
const POSE_FRAMES = 12

type Studio = {
  gl: ExpoWebGLRenderingContext
  renderer: THREE.WebGLRenderer
  small: THREE.WebGLRenderTarget | undefined
  big: THREE.WebGLRenderTarget
  quad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  side: number
}

let studio: Promise<Studio> | undefined
/** Set once a picture could not be made: nothing more is tried, and every tile draws itself. */
let broken = !SNAPSHOTS
/** One picture is made at a time. */
let queue: Promise<unknown> = Promise.resolve()
const made = new Map<string, string>()
const making = new Map<string, Promise<string | null>>()

async function open(): Promise<Studio> {
  const gl = await GLView.createContextAsync()
  const side = Math.round(STILL * SPILL * PixelRatio.get())
  const renderer = new THREE.WebGLRenderer({
    canvas: canvasFor(gl) as unknown as HTMLCanvasElement,
    context: gl as unknown as WebGLRenderingContext,
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(side, side, false)
  renderer.setClearColor(0x000000, 0)
  // The creature is drawn small into one picture and put into the other with hard pixels, at
  // the size it is shown: the second is what is saved.
  const big = new THREE.WebGLRenderTarget(side, side, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  })
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ transparent: true, premultipliedAlpha: true, depthTest: false }),
  )
  const scene = new THREE.Scene()
  scene.add(quad)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  return {
    gl,
    renderer,
    small: undefined,
    big,
    quad,
    scene,
    camera,
    side,
  }
}

async function picture(
  look: { seed: string; color: string },
  dark: boolean,
  outfit: Outfit,
): Promise<string | null> {
  const lib = mascots()
  const wardrobe = mascotWardrobe()
  if (lib === null || wardrobe === undefined) return null
  // A picture is made in its turn among everything that starts drawing (see gl-turn.ts).
  const started = await takeTurn()
  try {
    return await draw(lib, wardrobe, look, dark, outfit)
  } finally {
    started()
  }
}

async function draw(
  lib: NonNullable<ReturnType<typeof mascots>>,
  wardrobe: NonNullable<ReturnType<typeof mascotWardrobe>>,
  look: { seed: string; color: string },
  dark: boolean,
  outfit: Outfit,
): Promise<string | null> {
  studio ??= open()
  const at = await studio
  // A creature of its own for each picture, as a still `Avatar` has: one kept between pictures
  // would be caught a little further into its breath each time, and no two tiles would match.
  const orb = new lib.Orb(null, {
    seed: look.seed,
    color: look.color,
    size: STILL * SPILL,
    pixelRatio: PixelRatio.get(),
    dark,
    notice: false,
  })
  try {
    if (at.small === undefined || at.small.width !== orb.px) {
      at.small?.dispose()
      at.small = new THREE.WebGLRenderTarget(orb.px, orb.px, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      })
      at.quad.material.map = at.small.texture
      at.quad.material.needsUpdate = true
    }
    const { small, big, renderer, gl, side } = at
    wardrobe.dress(orb, outfit)
    orb.setState("idle")
    for (let frame = 0; frame < POSE_FRAMES; frame++) orb.update(1 / 30)
    renderer.setRenderTarget(small)
    renderer.clear()
    lib.Stage.drawAt(orb, renderer, 0, 0)
    renderer.setRenderTarget(big)
    renderer.setViewport(0, 0, side, side)
    renderer.setScissor(0, 0, side, side)
    renderer.clear()
    renderer.render(at.scene, at.camera)
    renderer.setRenderTarget(null)
    gl.flush()
    gl.endFrameEXP?.()
    // three.js keeps the framebuffer of a picture it draws into under this name.
    const kept = renderer.properties.get(big) as { __webglFramebuffer?: WebGLFramebuffer }
    if (kept.__webglFramebuffer === undefined) return null
    const shot = await GLView.takeSnapshotAsync(gl, {
      framebuffer: kept.__webglFramebuffer,
      rect: { x: 0, y: 0, width: side, height: side },
      format: "png",
    })
    return typeof shot.uri === "string" ? shot.uri : null
  } finally {
    orb.dispose()
  }
}

/** The file with a picture of this creature in this outfit, or null where none can be made. */
function still(
  key: string,
  look: { seed: string; color: string },
  dark: boolean,
  outfit: Outfit,
): Promise<string | null> {
  const known = made.get(key)
  if (known !== undefined) return Promise.resolve(known)
  if (broken) return Promise.resolve(null)
  let job = making.get(key)
  if (job === undefined) {
    job = queue.then(async () => {
      if (broken) return null
      try {
        const uri = await picture(look, dark, outfit)
        if (uri === null) broken = true
        else made.set(key, uri)
        return uri
      } catch {
        broken = true
        return null
      } finally {
        making.delete(key)
      }
    })
    queue = job
    making.set(key, job)
  }
  return job
}

/**
 * A creature wearing one thing and nothing else, small and holding still: how a thing is shown
 * in a list of them. `STILL` points square.
 */
export function Wearing({
  agent,
  item,
}: {
  agent: Pick<AgentSummary, "id" | "avatar">
  /** Undefined for the creature with nothing on. */
  item: WearItem | undefined
}) {
  const dark = useColorScheme() !== "light"
  const look = avatarLook(agent.avatar, agent.id)
  const key = `${look.seed}|${look.color}|${dark}|${item?.id ?? ""}`
  const slot = item?.slot
  const id = item?.id
  // Undefined while it is being made; null where it cannot be, and the tile draws itself.
  const [uri, setUri] = useState<string | null | undefined>(
    () => made.get(key) ?? (broken ? null : undefined),
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key says all of what is pictured
  useEffect(() => {
    let live = true
    const known = made.get(key)
    setUri(known ?? (broken ? null : undefined))
    if (known !== undefined || broken) return
    const outfit: Outfit = slot === undefined || id === undefined ? {} : { [slot]: id }
    void still(key, { seed: look.seed, color: look.color }, dark, outfit).then((found) => {
      if (live) setUri(found)
    })
    return () => {
      live = false
    }
  }, [key])

  if (uri === null) {
    return (
      <Avatar
        avatar={agent.avatar}
        seed={agent.id}
        outfit={item === undefined ? {} : { [item.slot]: item.id }}
        size={STILL}
        still
      />
    )
  }
  const spill = (STILL * (SPILL - 1)) / 2
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Agent avatar"
      style={{ width: STILL, height: STILL }}
    >
      {uri === undefined ? null : (
        <Image
          source={{ uri }}
          contentFit="fill"
          style={{
            position: "absolute",
            top: -spill,
            left: -spill,
            width: STILL * SPILL,
            height: STILL * SPILL,
          }}
        />
      )}
    </View>
  )
}
