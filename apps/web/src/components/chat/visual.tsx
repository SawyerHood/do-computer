import {
  type LibraryFile,
  readVisualHeight,
  readVisualLink,
  type ToolPart,
  VISUAL_DEFAULT_HEIGHT,
  visualFrameHeight,
  visualResult,
  type VisualTheme,
  visualThemeFragment,
  visualThemeMessage,
} from "@do-computer/protocol"
import { ArrowsOutSimpleIcon, ShareNetworkIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { SharePopover } from "@/components/sites/share"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { libraryQuery } from "@/lib/collections"
import { siteOfFile, useSites } from "@/lib/sites"
import { useAppColors } from "@/lib/visual-theme"
import { AgentIdContext, OpenFileContext } from "./sent-file.tsx"

/**
 * A visual the agent drew, in the chat: the page itself on the chat's own background, as tall
 * as the page says it is. The page is a file of the library and runs in a frame kept apart from
 * the app. It is in the app's colors, and follows them when they change.
 */
export function VisualFrame({ part }: { part: ToolPart }) {
  const agentId = useContext(AgentIdContext)
  return agentId === undefined ? null : <FrameOf agentId={agentId} part={part} />
}

function FrameOf({ agentId, part }: { agentId: string; part: ToolPart }) {
  const open = useContext(OpenFileContext)
  const drawn = part.details as unknown as LibraryFile
  const { data: listing } = useQuery(libraryQuery(agentId))
  const sites = useSites(agentId)
  // The file as it is now: it may have been changed, moved, or deleted since it was drawn.
  const file = listing?.files.find((entry) => entry.id === drawn.id)
  const colors = useAppColors()
  const theme = useMemo((): VisualTheme => ({ ...colors, inline: true }), [colors])
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState<number>()

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
  const tell = () => frame.current?.contentWindow?.postMessage(visualThemeMessage(theme), "*")
  // Its origin is nobody's, so "*" is the only address that reaches it; the window is what
  // makes sure it is this frame that hears.
  useEffect(tell, [theme])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const target = frame.current
      if (target === null || event.source !== target.contentWindow) return
      const tall = readVisualHeight(event.data)
      if (tall !== undefined) return setHeight(tall)
      const link = readVisualLink(event.data)
      if (link === undefined) return
      // Only on the reader's own click in the page: a page cannot open tabs by itself.
      if (document.activeElement === target && navigator.userActivation?.isActive !== false) {
        window.open(link.url, "_blank", "noopener,noreferrer")
      }
      target.contentWindow?.postMessage(visualResult(link.id), "*")
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
    <figure
      aria-label={`Visual: ${drawn.name}`}
      className="group/visual relative m-0 w-full"
      style={{ height: visualFrameHeight(height ?? VISUAL_DEFAULT_HEIGHT) }}
    >
      {src === undefined || file === undefined ? null : (
        <>
          <iframe
            key={`${file.id}:${file.rev}`}
            ref={frame}
            src={src}
            title={file.name}
            onLoad={tell}
            // No `allow-same-origin`: the page must not be the app, though the app serves it.
            sandbox="allow-scripts allow-popups allow-forms allow-modals"
            className="block size-full border-0 bg-transparent"
          />
          <div className="absolute top-0 right-0 flex gap-1 opacity-0 transition-opacity group-hover/visual:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
            {open === undefined ? (
              <Button
                variant="outline"
                size="icon-sm"
                className={button}
                aria-label="Open in the library"
                title="Open in the library"
                render={
                  <Link to="/a/$agentId/library" params={{ agentId }} search={{ file: file.id }} />
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
            <SharePopover agentId={agentId} site={siteOfFile(sites, file.path)} path={file.path}>
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
  )
}
