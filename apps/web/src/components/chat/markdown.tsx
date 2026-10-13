import { embedKind, resolveLink } from "@do-computer/protocol"
import { ImageBrokenIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ComponentProps, memo, type MouseEvent, useContext, useState } from "react"
import type { Components, ExtraProps } from "react-markdown"
import { embedsInChat, LibraryEmbed } from "@/components/embed/library-embed"
import { MediaPlayer } from "@/components/embed/media"
import { followHeadingLink, RichMarkdown } from "@/components/markdown/markdown"
import { PictureViewer, type ViewedPicture } from "@/components/picture-viewer"
import { client } from "@/lib/client"
import { libraryQuery } from "@/lib/collections"
import { kindOf } from "@/lib/library"
import { alwaysShow, hostOf, useShownHost } from "@/lib/shown-hosts"
import { cn } from "@/lib/utils"
import { AgentIdContext, OpenFileContext } from "./sent-file.tsx"

/** The pictures of the reply a picture is in, in the order they are in it. */
function picturesAround(picture: HTMLImageElement): { all: ViewedPicture[]; id: string } {
  const reply = picture.closest("[data-markdown]")
  const shown = [...(reply?.querySelectorAll<HTMLImageElement>("img[data-picture]") ?? [picture])]
  return {
    all: shown.map((each, at) => ({
      id: String(at),
      name: each.alt === "" ? "Picture" : each.alt,
      src: each.currentSrc || each.src,
    })),
    id: String(Math.max(0, shown.indexOf(picture))),
  }
}

/**
 * A picture in a reply. One alone on its line is a figure: it holds a box while it loads, so
 * that what is under it moves once and not twice, and opens large when it is clicked, with the
 * reply's other pictures a step away. One in a sentence, a badge say, is left the size it is.
 * A picture that cannot be had is its words.
 */
function Picture({
  src,
  alt,
  alone,
  size,
}: {
  src: string
  alt: string
  alone: boolean
  size: Pick<ComponentProps<"img">, "width" | "height">
}) {
  const [state, setState] = useState<"loading" | "shown" | "gone">("loading")
  const [viewed, setViewed] = useState<{ all: ViewedPicture[]; id: string; open: boolean }>()
  if (state === "gone")
    return <Missing words={alt === "" ? "A picture that could not be loaded" : alt} />
  const open = (event: MouseEvent<HTMLImageElement>) => {
    // A picture that is a link goes where the link does.
    if (event.currentTarget.closest("a") !== null) return
    setViewed({ ...picturesAround(event.currentTarget), open: true })
  }
  return (
    <>
      <img
        {...size}
        src={src}
        alt={alt}
        loading="lazy"
        // Where a picture is from another site, that site is not told which page asked for it.
        referrerPolicy="no-referrer"
        data-picture=""
        data-alone={alone || undefined}
        data-loading={state === "loading" || undefined}
        className={cn(alone && "cursor-zoom-in")}
        onLoad={() => setState("shown")}
        onError={() => setState("gone")}
        onClick={alone ? open : undefined}
      />
      {viewed === undefined ? null : (
        <PictureViewer
          pictures={viewed.all}
          id={viewed.id}
          open={viewed.open}
          download
          onShow={(id) => setViewed({ ...viewed, id })}
          onClose={() => setViewed({ ...viewed, open: false })}
        />
      )}
    </>
  )
}

/** What stands where something named in a reply cannot be shown: its words, quietly. */
function Missing({ words }: { words: string }) {
  return (
    <span className="md-missing">
      <ImageBrokenIcon aria-hidden />
      {words}
    </span>
  )
}

/**
 * Something named by where it is in the library, which is where the agent's files are: a
 * picture, or a film, a sound or a table shown as what it is. Anything else there, and anything
 * that is not there, is its words.
 */
function LibraryThing({
  agentId,
  path,
  ...picture
}: { agentId: string; path: string } & Omit<ComponentProps<typeof Picture>, "src">) {
  const { data: listing } = useQuery(libraryQuery(agentId))
  // Until the library has answered there is nothing to say of the file, either way.
  if (listing === undefined) return null
  const file = listing.files.find((entry) => entry.path === path)
  const words = picture.alt === "" ? path : picture.alt
  if (file === undefined) return <Missing words={words} />
  if (embedsInChat(file)) {
    return (
      <span className="md-embed">
        <LibraryEmbed agentId={agentId} file={file} view={listing.view} />
      </span>
    )
  }
  if (kindOf(file) !== "image") return <Missing words={words} />
  return (
    <Picture
      {...picture}
      src={`${client.agent(agentId).libraryViewUrl(listing.view, file.path)}?v=${file.rev}`}
    />
  )
}

/**
 * Something at another site's address. It is not loaded until the reader says so, for that
 * site: asking for it tells the site who is reading, and the address can be written to carry
 * anything the agent has read. What it is, a picture or a film or a sound, its address says.
 */
function Remote({ src, ...picture }: ComponentProps<typeof Picture>) {
  const host = hostOf(src)
  const allowed = useShownHost(host)
  const [once, setOnce] = useState(false)
  if (host === undefined) return <Missing words={picture.alt === "" ? "A picture" : picture.alt} />
  if (!allowed && !once) {
    return (
      <span className="md-remote" data-alone={picture.alone || undefined}>
        <span className="min-w-0 truncate">
          {picture.alt === "" ? "Something" : picture.alt} from{" "}
          <span className="font-medium text-foreground">{host}</span>
        </span>
        <button type="button" onClick={() => setOnce(true)}>
          Show
        </button>
        <button
          type="button"
          title={`Show what is at ${host} without asking, from now on`}
          onClick={() => alwaysShow(host)}
        >
          Always from {host}
        </button>
      </span>
    )
  }
  let name = src
  try {
    name = new URL(src, window.location.href).pathname
  } catch {
    // Whatever it is, it is tried as a picture.
  }
  const kind = embedKind(name)
  if (kind === "video" || kind === "audio") {
    return (
      <span className="md-embed">
        <MediaPlayer kind={kind} src={src} name={picture.alt === "" ? host : picture.alt} />
      </span>
    )
  }
  return <Picture {...picture} src={src} />
}

function Image({ node, src, alt, width, height }: ComponentProps<"img"> & ExtraProps) {
  const agentId = useContext(AgentIdContext)
  const picture = {
    alt: alt ?? "",
    alone: node?.properties.dataAlone !== undefined,
    size: { width, height },
  }
  const source = typeof src === "string" ? src : ""
  const path = resolveLink("", source)
  // A picture written into the reply itself is already here.
  if (path === undefined && /^(data|blob):/i.test(source)) {
    return <Picture {...picture} src={source} />
  }
  if (path === undefined) return <Remote {...picture} src={source} />
  if (agentId === undefined) return <Missing words={picture.alt === "" ? path : picture.alt} />
  return <LibraryThing {...picture} agentId={agentId} path={path} />
}

/** A link to a file of the library, which opens it beside the chat where there is room for that. */
function LibraryLink({
  agentId,
  path,
  href,
  children,
}: {
  agentId: string
  path: string
  href: string
  children: React.ReactNode
}) {
  const open = useContext(OpenFileContext)
  const { data: listing } = useQuery(libraryQuery(agentId))
  const file = listing?.files.find((entry) => entry.path === path)
  // A link to nothing in the library is left as it was written: it may be to somewhere else.
  if (file === undefined) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }
  return (
    <Link
      to="/a/$agentId/library"
      params={{ agentId }}
      search={{ file: file.id }}
      title={open === undefined ? "Open in the library" : "Open beside the chat"}
      onClick={(event) => {
        if (open === undefined) return
        event.preventDefault()
        open(file.id)
      }}
    >
      {children}
    </Link>
  )
}

function Anchor({ node: _node, href, children, ...props }: ComponentProps<"a"> & ExtraProps) {
  const agentId = useContext(AgentIdContext)
  const path = href === undefined ? undefined : resolveLink("", href)
  if (href !== undefined && path !== undefined && agentId !== undefined) {
    return (
      <LibraryLink agentId={agentId} path={path} href={href}>
        {children}
      </LibraryLink>
    )
  }
  return href?.startsWith("#") ? (
    <a {...props} href={href} onClick={(event) => followHeadingLink(event, href)}>
      {children}
    </a>
  ) : (
    <a {...props} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

const components: Components = { a: Anchor, img: Image }

/**
 * Assistant text as Markdown. A link opens in a new tab, unless it is to a file of the library
 * or to a heading of the same reply. What is written as a picture may be a picture, a film, a
 * sound or a table: in the library, where it is shown at once, or at another site's address,
 * where it is shown once the reader has said that site may be asked.
 */
export const Markdown = memo(function Markdown({
  text,
  writing,
}: {
  text: string
  /** The reply this is part of is still arriving. */
  writing?: boolean
}) {
  return (
    <RichMarkdown text={text} writing={writing} components={components} className="prose-chat" />
  )
})
