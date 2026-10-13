import type { LibraryFile } from "@do-computer/protocol"
import { Link } from "@tanstack/react-router"
import { memo, useMemo } from "react"
import type { Components } from "react-markdown"
import { followHeadingLink, RichMarkdown } from "@/components/markdown/markdown"
import { client } from "@/lib/client"
import { dirOf, resolveLink } from "@/lib/library"
import { cn } from "@/lib/utils"

/**
 * A Markdown document from the library. Links and pictures that point at other library files,
 * relative to this one, lead to those files; a link to one of its own headings goes to it.
 */
export const DocMarkdown = memo(function DocMarkdown({
  agentId,
  file,
  text,
  view,
  paths,
  className,
  onOpen,
}: {
  agentId: string
  file: LibraryFile
  text: string
  /** Stands in for the session where pictures are loaded from. */
  view: string
  /** Every path in the library, to tell a link to a file from a link to nothing. */
  paths: ReadonlySet<string>
  className?: string
  /** Open a linked file where this document is shown, instead of going to the library for it. */
  onOpen?: (path: string) => void
}) {
  const dir = dirOf(file.path)
  // The same from one draw to the next, so that typing in the document beside it does not
  // draw every block of this one anew.
  const components = useMemo(
    (): Components => ({
      a: ({ node: _node, href, children, title }) => {
        const path = href === undefined ? undefined : resolveLink(dir, href)
        if (path !== undefined && paths.has(path)) {
          return (
            <Link
              to="/a/$agentId/library"
              params={{ agentId }}
              search={{ path }}
              title={title}
              onClick={(event) => {
                if (onOpen === undefined) return
                event.preventDefault()
                onOpen(path)
              }}
            >
              {children}
            </Link>
          )
        }
        if (href?.startsWith("#")) {
          return (
            <a href={href} title={title} onClick={(event) => followHeadingLink(event, href)}>
              {children}
            </a>
          )
        }
        return (
          <a href={href} title={title} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      },
      img: ({ node: _node, src, alt, ...props }) => {
        const path = typeof src === "string" ? resolveLink(dir, src) : undefined
        return (
          <img
            {...props}
            alt={alt ?? ""}
            loading="lazy"
            src={
              path !== undefined && paths.has(path)
                ? client.agent(agentId).libraryViewUrl(view, path)
                : src
            }
          />
        )
      },
    }),
    [agentId, dir, onOpen, paths, view],
  )
  return <RichMarkdown text={text} components={components} className={cn("prose-doc", className)} />
})
