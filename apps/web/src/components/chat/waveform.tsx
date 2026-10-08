import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

const BAR_WIDTH = 3
const BAR_GAP = 2
const BAR_PITCH = BAR_WIDTH + BAR_GAP
const SAMPLE_EVERY_N_FRAMES = 2
const NOISE_FLOOR = 0.006
const AMPLITUDE_GAIN = 8
const AMPLITUDE_GAMMA = 0.6
const IDLE_AMPLITUDE = 0.06

/**
 * What the microphone hears, drawn as bars that come in at the right and move left as time goes
 * by: tall for loud, a dot for quiet. When it is no longer `active` the bars stay as they were,
 * so the shape of what was said is still there while it is turned into text.
 */
export function Waveform({
  stream,
  active,
  className,
}: {
  stream: MediaStream | undefined
  active: boolean
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barsRef = useRef<number[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    let cssWidth = 0
    let cssHeight = 0
    let barCount = 1
    let midY = 0
    let maxHalf = 0
    let edgeFade = 0

    const measure = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      cssWidth = rect.width
      cssHeight = rect.height
      canvas.width = Math.max(1, Math.round(cssWidth * dpr))
      canvas.height = Math.max(1, Math.round(cssHeight * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.strokeStyle = getComputedStyle(canvas).color
      ctx.lineCap = "round"
      ctx.lineWidth = BAR_WIDTH
      midY = cssHeight / 2
      maxHalf = Math.max(0, (cssHeight * 0.95 - BAR_WIDTH) / 2)
      edgeFade = cssWidth * 0.15
      barCount = Math.max(1, Math.floor(cssWidth / BAR_PITCH))
      if (barsRef.current.length > barCount) {
        barsRef.current = barsRef.current.slice(barsRef.current.length - barCount)
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, cssWidth, cssHeight)
      const bars = barsRef.current
      for (let i = 0; i < bars.length; i++) {
        const amp = bars[bars.length - 1 - i]!
        const cx = cssWidth - BAR_WIDTH / 2 - i * BAR_PITCH
        if (cx + BAR_WIDTH < 0) break
        const half = amp * maxHalf
        // The oldest bars fade as they reach the left edge.
        ctx.globalAlpha = cx < edgeFade ? Math.max(0.15, cx / edgeFade) : 1
        ctx.beginPath()
        ctx.moveTo(cx, midY - half)
        ctx.lineTo(cx, midY + half)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    const resized = new ResizeObserver(() => {
      measure()
      draw()
    })
    resized.observe(canvas)
    measure()

    const track = stream?.getAudioTracks()[0]
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!active || track === undefined || typeof AudioContext === "undefined" || still) {
      // Nothing to listen to, or someone who would rather it did not move: a quiet line.
      if (barsRef.current.length === 0) {
        barsRef.current = Array.from({ length: barCount }, () => IDLE_AMPLITUDE)
      }
      draw()
      return () => resized.disconnect()
    }

    const audio = new AudioContext()
    void audio.resume()
    // A copy of the track, so that listening to it here never touches the recording.
    const heard = track.clone()
    const source = audio.createMediaStreamSource(new MediaStream([heard]))
    const analyser = audio.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)

    const samples = new Uint8Array(analyser.fftSize)
    let frame = 0
    let raf = 0

    const tick = () => {
      if (audio.state === "suspended") void audio.resume()
      if (frame % SAMPLE_EVERY_N_FRAMES === 0) {
        analyser.getByteTimeDomainData(samples)
        let sumSquares = 0
        for (const sample of samples) {
          const centered = (sample - 128) / 128
          sumSquares += centered * centered
        }
        const rms = Math.sqrt(sumSquares / samples.length)
        const boosted = Math.max(0, rms - NOISE_FLOOR) * AMPLITUDE_GAIN
        const bars = barsRef.current
        bars.push(Math.min(1, boosted ** AMPLITUDE_GAMMA))
        if (bars.length > barCount) bars.shift()
        draw()
      }
      frame++
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      resized.disconnect()
      source.disconnect()
      analyser.disconnect()
      heard.stop()
      void audio.close()
    }
  }, [stream, active])

  return <canvas ref={canvasRef} aria-hidden className={cn("block h-full w-full", className)} />
}
