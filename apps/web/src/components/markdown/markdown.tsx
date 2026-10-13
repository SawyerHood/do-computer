import {
  InfoIcon,
  LightbulbIcon,
  SealWarningIcon,
  WarningIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react"
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  memo,
  type MouseEvent,
  type ReactNode,
  useContext,
  useMemo,
} from "react"
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown"
import { cn } from "@/lib/utils"
import { CodeBlock } from "./code-block.tsx"
import { MermaidBlock } from "./mermaid.tsx"
import {
  type Alert,
  endsInOpenFence,
  ID_PREFIX,
  REHYPE_PLUGINS,
  REMARK_PLUGINS,
} from "./pipeline.ts"
import { MarkdownTable } from "./table.tsx"

/** Whether the text being drawn ends in a block of code that is still being written. */
const WritingCodeContext = createContext(false)

const textOf = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ""
}

/** A fenced block: a diagram where it says it is one, and otherwise the code in its colors. */
function Fenced({ node, children }: ComponentProps<"pre"> & ExtraProps) {
  const writingCode = useContext(WritingCodeContext)
  const inner = Children.toArray(children)[0]
  const named = isValidElement<{ className?: string }>(inner) ? inner.props.className : undefined
  const language = /(?:^|\s)language-(\S+)/.exec(named ?? "")?.[1] ?? ""
  // Markdown ends a block's text with a line break that is not part of the code.
  const code = textOf(children).replace(/\n$/, "")
  const writing = writingCode && node?.properties.dataLast !== undefined
  return language === "mermaid" ? (
    <MermaidBlock code={code} writing={writing} />
  ) : (
    <CodeBlock code={code} language={language} writing={writing} />
  )
}

const ALERT_WORDS: Record<Alert, { title: string; icon: typeof InfoIcon }> = {
  note: { title: "Note", icon: InfoIcon },
  tip: { title: "Tip", icon: LightbulbIcon },
  important: { title: "Important", icon: SealWarningIcon },
  warning: { title: "Warning", icon: WarningIcon },
  caution: { title: "Caution", icon: WarningOctagonIcon },
}

/** A quote, or a note of one of GitHub's five kinds where the quote was marked as one. */
function Quote({ node, children, ...props }: ComponentProps<"blockquote"> & ExtraProps) {
  const kind = node?.properties.dataAlert as Alert | undefined
  const words = kind === undefined ? undefined : ALERT_WORDS[kind]
  if (words === undefined) return <blockquote {...props}>{children}</blockquote>
  return (
    <div role="note" className="md-alert" data-alert={kind}>
      <p className="md-alert-title">
        <words.icon weight="fill" aria-hidden />
        {words.title}
      </p>
      {children}
    </div>
  )
}

/**
 * Follow a link to a heading of the same piece of Markdown, where `href` is one. Headings carry
 * their ids with a prefix, so that a document cannot take an id of the app's own; the link is
 * written without it. Says whether it was such a link.
 */
export function followHeadingLink(event: MouseEvent<HTMLAnchorElement>, href: string | undefined) {
  if (href === undefined || !href.startsWith("#") || href.length < 2) return false
  event.preventDefault()
  let id = href.slice(1)
  try {
    id = decodeURIComponent(id)
  } catch {
    // Left as it was written.
  }
  const wanted = id.startsWith(ID_PREFIX) ? id : `${ID_PREFIX}${id}`
  const within = event.currentTarget.closest("[data-markdown]")
  const heading = [...(within?.querySelectorAll("[id]") ?? [])].find((part) => part.id === wanted)
  heading?.scrollIntoView({ behavior: "smooth", block: "start" })
  return true
}

/** A link: one to a heading here goes to it, and any other opens in a new tab. */
function Anchor({ node: _node, href, children, ...props }: ComponentProps<"a"> & ExtraProps) {
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

/**
 * A paragraph. One that is only a picture is a figure, and what is written as a picture may
 * be drawn as a film or a table, which a paragraph cannot hold: so it is a plain block.
 */
function Paragraph({ node, children, ...props }: ComponentProps<"p"> & ExtraProps) {
  const only = node?.children.filter((child) => child.type !== "text" || child.value.trim() !== "")
  const figure =
    only?.length === 1 &&
    only[0]!.type === "element" &&
    only[0]!.tagName === "img" &&
    only[0]!.properties.dataAlone !== undefined
  return figure ? <div className="md-figure">{children}</div> : <p {...props}>{children}</p>
}

/** What every piece of Markdown in the app is drawn with. Kept the same from one draw to the next. */
const COMPONENTS: Components = {
  a: Anchor,
  p: Paragraph,
  pre: Fenced,
  blockquote: Quote,
  table: ({ node: _node, ...props }) => <MarkdownTable {...props} />,
}

/**
 * Markdown as the app shows it: tables that scroll and copy, code in its colors, diagrams,
 * notes, folding sections and task lists, with what raw HTML it has cleaned first. `components`
 * says how a link and a picture are drawn where that depends on where the text is; pass the
 * same object each time, or everything is drawn anew at every word of a reply.
 */
export const RichMarkdown = memo(function RichMarkdown({
  text,
  writing = false,
  components,
  className,
}: {
  text: string
  /** The text is still being written, as a reply is while it arrives. */
  writing?: boolean
  components?: Components
  className?: string
}) {
  const all = useMemo(() => ({ ...COMPONENTS, ...components }), [components])
  const writingCode = writing && endsInOpenFence(text)
  return (
    <div data-markdown="" className={cn("md", className)}>
      <WritingCodeContext value={writingCode}>
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={all}
        >
          {text}
        </ReactMarkdown>
      </WritingCodeContext>
    </div>
  )
})
