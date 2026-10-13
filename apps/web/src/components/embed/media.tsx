import { ArrowClockwiseIcon, DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * A film or a sound, played where it is. Nothing of it is asked for until it is near the
 * screen, and then only enough to know how long it is and, for a film, to show its first
 * frame; the rest comes as it is played, a part at a time. It stops when the tab is put away.
 *
 * The address it starts with is kept for as long as it is shown: a new one would start it
 * again. `onStale` is asked for a fresh address when the one it has stops working, which the
 * address of a library file does after some hours, and it carries on from where it was.
 */
export function MediaPlayer({
  kind,
  src,
  name,
  download,
  onStale,
  className,
}: {
  kind: "video" | "audio"
  src: string
  name: string
  /** Where the file can be had whole, offered when it cannot be played. */
  download?: string
  onStale?: () => Promise<string | undefined>
  className?: string
}) {
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const [address, setAddress] = useState(src)
  const [near, setNear] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  // Where it was when its address stopped working, to go back to with the new one.
  const resume = useRef(0)
  // Whether a fresh address has been asked for since it last played.
  const asked = useRef(false)

  useEffect(() => {
    const element = player.current
    if (element === null || near) return
    if (typeof IntersectionObserver === "undefined") return setNear(true)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { rootMargin: "300px" },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near])

  useEffect(() => {
    const onHidden = () => {
      const element = player.current
      // A film that fills the screen is being watched, whatever the page says of itself.
      if (document.hidden && element !== null && document.fullscreenElement !== element) {
        element.pause()
      }
    }
    document.addEventListener("visibilitychange", onHidden)
    return () => document.removeEventListener("visibilitychange", onHidden)
  }, [])

  const again = async () => {
    setRetrying(true)
    try {
      const fresh = await onStale?.()
      asked.current = true
      setAddress(fresh ?? src)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setRetrying(false)
    }
  }

  if (failed) {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border border-hairline bg-muted/60 p-4 text-center text-sm text-muted-foreground",
          kind === "video" ? "aspect-video w-full max-w-xl" : "w-full max-w-md",
          className,
        )}
      >
        <span className="flex items-center gap-1.5">
          <WarningCircleIcon className="size-4 shrink-0" />
          {name} could not be played here.
        </span>
        <span className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="outline" disabled={retrying} onClick={() => void again()}>
            <ArrowClockwiseIcon data-icon="inline-start" />
            {retrying ? "Trying…" : "Try again"}
          </Button>
          {download === undefined ? null : (
            <Button size="sm" variant="outline" render={<a href={download} download={name} />}>
              <DownloadSimpleIcon data-icon="inline-start" />
              Download
            </Button>
          )}
        </span>
      </div>
    )
  }

  const shared = {
    ref: player,
    src: address,
    controls: true,
    preload: near ? ("metadata" as const) : ("none" as const),
    "aria-label": name,
    onLoadedMetadata: () => {
      const element = player.current
      if (element !== null && resume.current > 0) element.currentTime = resume.current
      resume.current = 0
    },
    onPlaying: () => {
      asked.current = false
    },
    onError: () => {
      const element = player.current
      resume.current = element?.currentTime ?? 0
      // Once by itself, for an address that has grown old. After that it is the reader's to try.
      if (onStale !== undefined && !asked.current) void again()
      else setFailed(true)
    },
  }
  return kind === "video" ? (
    // A film is fitted inside a box of the usual shape, so that nothing under it moves when
    // its own shape is known.
    <video
      {...shared}
      playsInline
      className={cn("aspect-video w-full max-w-xl rounded-xl bg-black object-contain", className)}
    />
  ) : (
    <audio {...shared} className={cn("block h-10 w-full max-w-md", className)} />
  )
}
