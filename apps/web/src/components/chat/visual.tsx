import {
  type LibraryFile,
  readVisualError,
  readVisualHeight,
  readVisualHeights,
  readVisualLink,
  readVisualMode,
  readVisualSave,
  readVisualSay,
  type ToolPart,
  VISUAL_DEFAULT_HEIGHT,
  visualFrameHeight,
  visualHeightAt,
  visualModeMessage,
  visualRefusal,
  visualResult,
  type VisualTheme,
  visualThemeFragment,
  visualThemeMessage,
} from "@do-computer/protocol"
import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  ShareNetworkIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useAgentsById } from "@/components/computer-requests"
import { SharePopover } from "@/components/sites/share"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { libraryQuery } from "@/lib/collections"
import { siteOfFile, useSites } from "@/lib/sites"
import { cn } from "@/lib/utils"
import { heightBefore, keepHeight } from "@/lib/visual-heights"
import { useAppColors } from "@/lib/visual-theme"
import { AgentIdContext, OpenFileContext } from "./sent-file.tsx"
import { useSay } from "./use-say.ts"

/**
 * A visual the agent drew, in the chat: the page itself on the chat's own background, as tall
 * as the page says it is. The page is a file of the library and runs in a frame kept apart from
 * the app. It is in the app's colors, and follows them when they change.
 */
export function VisualFrame({ part }: { part: ToolPart }) {
  const agentId = useContext(AgentIdContext)
  return agentId === undefined ? null : <FrameOf agentId={agentId} part={part} />
}

/** What a page may be handed as a file, as bytes of the type it says. */
function saveFile(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  // Long after the browser has read it: some start a download a moment after the click.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function FrameOf({ agentId, part }: { agentId: string; part: ToolPart }) {
  const open = useContext(OpenFileContext)
  const put = useSay()
  const agentName = useAgentsById().get(agentId)?.name
  const drawn = part.details as unknown as LibraryFile
  const { data: listing } = useQuery(libraryQuery(agentId))
  const sites = useSites(agentId)
  // The file as it is now: it may have been changed, moved, or deleted since it was drawn.
  const file = listing?.files.find((entry) => entry.id === drawn.id)
  const colors = useAppColors()
  const theme = useMemo((): VisualTheme => ({ ...colors, inline: true }), [colors])
  const frame = useRef<HTMLIFrameElement>(null)
  const place = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  const [loaded, setLoaded] = useState(false)
  // Shown large, it is the same frame over the page: what the reader did in it is still done.
  const [large, setLarge] = useState(false)
  // What a script of the page's said went wrong, if one did.
  const [failure, setFailure] = useState<string>()

  // The frame keeps the address it was first given for as long as the page is the same one:
  // a new address would load it again. The colors it starts in ride on the address.
  const first = useRef(theme)
  const view = listing?.view
  const src = useMemo(
    () =>
      view === undefined || file === undefined
        ? undefined
        : `${client.agent(agentId).libraryViewUrl(view, file.path)}?v=${file.rev}${visualThemeFragment(first.current)}`,
    [agentId, view, file?.path, file?.rev],
  )
  // Its origin is nobody's, so "*" is the only address that reaches it; the window is what
  // makes sure it is this frame that hears.
  const post = (message: unknown) => frame.current?.contentWindow?.postMessage(message, "*")
  const tell = () => post(visualThemeMessage(theme))
  useEffect(tell, [theme])
  useEffect(() => void post(visualModeMessage(large ? "fullscreen" : "inline")), [large])

  // A page that was shown here before is given the room it took then, at once. One that
  // was not, but that the agent looked at before drawing it, is given the room it took there.
  const page = file === undefined ? undefined : `${file.id}:${file.rev}`
  const measured = (part.details as { heights?: unknown } | undefined)?.heights
  useLayoutEffect(() => {
    if (page === undefined || place.current === null) return
    const wide = place.current.clientWidth
    // What was measured is of the page as it was drawn, not as it may have been changed since.
    const looked = file?.rev === drawn.rev ? readVisualHeights(measured) : undefined
    const before =
      heightBefore(page, wide) ?? (looked === undefined ? undefined : visualHeightAt(looked, wide))
    if (before !== undefined) setHeight((now) => now ?? before)
  }, [page, measured, file?.rev, drawn.rev])

  /** Put words in the chat's message box. The box is under the page while the page is large. */
  const say = (text: string): boolean => {
    if (!put(text)) return false
    setLarge(false)
    return true
  }

  // What the page says is heard by whatever these are now, without listening anew each time.
  const heard = useRef({ page, large, say })
  heard.current = { page, large, say }
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const target = frame.current
      if (target === null || event.source !== target.contentWindow) return
      const now = heard.current
      const tall = readVisualHeight(event.data)
      if (tall !== undefined) {
        // Large, it is laid out as a page by itself, which says nothing of its height in a reply.
        if (now.large) return
        if (now.page !== undefined && place.current !== null) {
          keepHeight(now.page, place.current.clientWidth, visualFrameHeight(tall))
        }
        return setHeight(tall)
      }
      const failed = readVisualError(event.data)
      if (failed !== undefined) return setFailure((first) => first ?? failed)
      const answer = (message: unknown) => target.contentWindow?.postMessage(message, "*")
      const link = readVisualLink(event.data)
      const said = readVisualSay(event.data)
      const mode = readVisualMode(event.data)
      const saved = readVisualSave(event.data)
      const asked = link ?? said ?? mode ?? saved
      if (asked === undefined) return
      // Only on the reader's own press in the page: a page does none of these by itself.
      if (document.activeElement !== target || navigator.userActivation?.isActive === false) {
        return answer(visualRefusal(asked.id, "Only when the person has just pressed something."))
      }
      if (link !== undefined) window.open(link.url, "_blank", "noopener,noreferrer")
      if (said !== undefined && !now.say(said.text)) {
        return answer(visualRefusal(said.id, "There is no message box here."))
      }
      if (mode !== undefined) {
        setLarge(mode.mode === "fullscreen")
        return answer(visualResult(mode.id, { mode: mode.mode }))
      }
      if (saved !== undefined) saveFile(saved.name, saved.type, saved.text)
      answer(visualResult(asked.id))
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  if (listing !== undefined && file === undefined) {
    return (
      <p className="px-1 text-sm text-muted-foreground">
        “{drawn.name}” is no longer in the library, so it cannot be shown here.
      </p>
    )
  }
  const button =
    "bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
  return (
    <div className="flex w-full flex-col gap-1.5">
      {/* Its place in the reply, which it keeps while it is shown large over the page. */}
      <div
        ref={place}
        className="w-full"
        style={{ height: visualFrameHeight(height ?? VISUAL_DEFAULT_HEIGHT) }}
      >
        {large ? (
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-black/45"
            onClick={() => setLarge(false)}
          />
        ) : null}
        <figure
          aria-label={`Visual: ${drawn.name}`}
          className={cn(
            "group/visual m-0",
            large
              ? "fixed inset-3 z-50 overflow-hidden rounded-2xl bg-background shadow-float md:inset-8"
              : "relative size-full",
          )}
        >
          {src === undefined || file === undefined ? null : (
            <>
              <iframe
                key={`${file.id}:${file.rev}`}
                ref={frame}
                src={src}
                title={file.name}
                // One far up a long chat is not loaded until it is scrolled near.
                loading="lazy"
                onLoad={() => {
                  setLoaded(true)
                  tell()
                }}
                // No `allow-same-origin`: the page must not be the app, though the app serves it.
                sandbox="allow-scripts allow-popups allow-forms allow-modals"
                // A frame whose light or dark is not its page's is drawn on white, and the
                // empty page a frame starts with is light: so it is light until the page is in.
                className="block size-full border-0 bg-transparent"
                style={{ colorScheme: loaded ? theme.appearance : "light" }}
              />
              <div
                className={cn(
                  "absolute top-0 right-0 flex gap-1 transition-opacity",
                  large
                    ? "top-2 right-2"
                    : "opacity-0 group-hover/visual:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100",
                )}
              >
                {large ? (
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className={button}
                    aria-label="Put it back in the reply"
                    title="Put it back in the reply"
                    onClick={() => setLarge(false)}
                  >
                    <ArrowsInSimpleIcon />
                  </Button>
                ) : open === undefined ? (
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className={button}
                    aria-label="Open in the library"
                    title="Open in the library"
                    render={
                      <Link
                        to="/a/$agentId/library"
                        params={{ agentId }}
                        search={{ file: file.id }}
                      />
                    }
                  >
                    <ArrowsOutSimpleIcon />
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className={button}
                    aria-label="Open beside the chat"
                    title="Open beside the chat"
                    onClick={() => open(file.id)}
                  >
                    <ArrowsOutSimpleIcon />
                  </Button>
                )}
                <SharePopover
                  agentId={agentId}
                  site={siteOfFile(sites, file.path)}
                  path={file.path}
                >
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className={button}
                    aria-label="Share"
                    title="Share"
                  >
                    <ShareNetworkIcon />
                  </Button>
                </SharePopover>
              </div>
            </>
          )}
        </figure>
      </div>
      {failure === undefined ? null : (
        // A script of the page's failed, so what is above may be half of what was meant.
        <p
          role="status"
          className="flex flex-wrap items-center gap-x-2 px-1 text-sm text-muted-foreground"
        >
          <WarningCircleIcon className="size-4 shrink-0" />
          <span>Something in this page did not work.</span>
          <button
            type="button"
            className="rounded-md font-medium text-foreground underline decoration-input underline-offset-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            onClick={() =>
              say(`The page “${drawn.name}” did not work when I opened it. It said: ${failure}`)
            }
          >
            Tell {agentName ?? "your Dood"}
          </button>
        </p>
      )}
    </div>
  )
}
