import type { LibraryFile } from "@durable-computer/protocol"
import { Link } from "@tanstack/react-router"
import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { client } from "@/lib/client"
import { dirOf, resolveLink } from "@/lib/library"
import { cn } from "@/lib/utils"

const plugins = [remarkGfm]

/**
 * A Markdown document from the library. Links and pictures that point at other library files,
 * relative to this one, lead to those files; raw HTML is not rendered.
 */
export const DocMarkdown = memo(function DocMarkdown({
  agentId,
  file,
  text,
  view,
  paths,
  className,
}: {
  agentId: string
  file: LibraryFile
  text: string
  /** Stands in for the session where pictures are loaded from. */
  view: string
  /** Every path in the library, to tell a link to a file from a link to nothing. */
  paths: ReadonlySet<string>
  className?: string
}) {
  const dir = dirOf(file.path)
  return (
    <div className={cn("prose-doc", className)}>
      <ReactMarkdown
        remarkPlugins={plugins}
        components={{
          a: ({ node: _node, href, children, title }) => {
            const path = href === undefined ? undefined : resolveLink(dir, href)
            if (path !== undefined && paths.has(path)) {
              return (
                <Link to="/a/$agentId/library" params={{ agentId }} search={{ path }} title={title}>
                  {children}
                </Link>
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
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
