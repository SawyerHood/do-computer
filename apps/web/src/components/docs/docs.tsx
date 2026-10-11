import { CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { agentPrompt, GUIDES, type Guide, headingId } from "@/lib/docs"
import type { FrontDoor } from "@/lib/front-door"
import { DOWNLOADS, REPOSITORY } from "@/lib/project"

const plugins = [remarkGfm]

/** The words of a piece of Markdown, without what marks them up. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ""
}

/** Copy something, and say for a moment that it was. */
function useCopy(): [copied: boolean, copy: (text: string) => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  return [
    copied,
    (text) => {
      // Over plain http on another device there is no clipboard to write to.
      void Promise.resolve()
        .then(() => navigator.clipboard.writeText(text))
        .then(
          () => setCopied(true),
          () => {},
        )
    },
  ]
}

/** A block of commands, with a button that copies it. */
function Commands({ children }: ComponentProps<"pre">) {
  const [copied, copy] = useCopy()
  return (
    <div className="dx-code">
      <pre>{children}</pre>
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy"}
        data-copied={copied || undefined}
        onClick={() => copy(textOf(children).trimEnd())}
      >
        {copied ? <CheckIcon weight="bold" /> : <CopyIcon />}
      </button>
    </div>
  )
}

/** A step to the person's own hands is written `**Needs you:**`, and shown as a mark. */
const NEEDS = "Needs you:"
/** How to tell a step worked is a paragraph that starts with this, and is shown with a tick. */
const CHECK = "Check: "

/**
 * What a guide's Markdown is drawn with. Everything a guide shows is ordinary Markdown in its
 * file, so the file an agent is given says the same as the page.
 */
const components: Components = {
  h2: ({ children }) => <h2 id={headingId(textOf(children))}>{children}</h2>,
  pre: Commands,
  strong: ({ children }) =>
    textOf(children) === NEEDS ? (
      <span className="dx-needs">Needs you</span>
    ) : (
      <strong>{children}</strong>
    ),
  p: ({ children }) => {
    const [first, ...rest] = Children.toArray(children)
    if (typeof first !== "string" || !first.startsWith(CHECK)) return <p>{children}</p>
    return (
      <p className="dx-check">
        <span className="sr-only">{CHECK}</span>
        {first.slice(CHECK.length)}
        {rest}
      </p>
    )
  },
  a: ({ href = "", children }) => {
    // Another guide, written the way it is linked on GitHub: by its file.
    const guide = /^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/.exec(href)
    if (guide !== null) return <a href={`/docs/${guide[1]}${guide[2] ?? ""}`}>{children}</a>
    if (href.startsWith("#")) return <a href={href}>{children}</a>
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  },
}

/** Every guide, and under the open one its sections, the one being read marked. */
function Guides({ guide, at }: { guide: Guide; at: string | undefined }) {
  return (
    <nav className="dx-guides" aria-label="Guides">
      <h2>Guides</h2>
      {GUIDES.map((other) =>
        other.slug === guide.slug ? (
          <div key={other.slug}>
            <Link to="/docs/$slug" params={{ slug: other.slug }} aria-current="page">
              {other.title}
            </Link>
            <div className="dx-parts">
              {other.sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  aria-current={section.id === at ? "location" : undefined}
                >
                  {section.title}
                </a>
              ))}
            </div>
          </div>
        ) : (
          <Link key={other.slug} to="/docs/$slug" params={{ slug: other.slug }}>
            {other.title}
          </Link>
        ),
      )}
    </nav>
  )
}

/** The way to hand a guide to an agent: a prompt with its address in it, and the file itself. */
function HandOff({ guide, origin }: { guide: Guide; origin: string }) {
  const [promptCopied, copyPrompt] = useCopy()
  const [pageCopied, copyPage] = useCopy()
  const prompt = agentPrompt(origin, guide)
  const file = `${guide.slug}.md`
  // The address is kept in two pieces that each stay whole, so that it breaks before the file.
  const [before, after = ""] = prompt.split(`${origin}/docs/${file}`)
  return (
    <div className="dx-card">
      <h2>
        {guide.slug === "self-hosting" ? "Have an agent set it up" : "Have an agent follow it"}
      </h2>
      <p>
        Paste this into Claude Code, Codex or any agent with a terminal. It asks you for the few
        things only you can give.
      </p>
      <pre data-prompt>
        {before}
        {origin}/docs/
        <wbr />
        <span>{file}</span>
        {after}
      </pre>
      <button type="button" className="dx-button dx-dark" onClick={() => copyPrompt(prompt)}>
        {promptCopied ? <CheckIcon weight="bold" /> : <CopyIcon />}
        {promptCopied ? "Copied" : "Copy prompt"}
      </button>
      <div className="dx-also">
        <button type="button" onClick={() => copyPage(guide.text)}>
          {pageCopied ? "Copied" : "Copy page as Markdown"}
        </button>
        <a href={`/docs/${file}`}>View as Markdown</a>
      </div>
    </div>
  )
}

/**
 * A guide, as a page: the landing page's top line, the guides at the side, the guide in the
 * middle, and beside it the way to hand it to an agent. Like the landing page it is the same by
 * day and by night, and is what scrolls, since the app's own pages never scroll the window.
 */
export function Docs({ guide, door, origin }: { guide: Guide; door: FrontDoor; origin: string }) {
  const scroller = useRef<HTMLElement>(null)
  const menu = useRef<HTMLDetailsElement>(null)
  /** The section being read: the last one whose heading has reached the top. */
  const [at, setAt] = useState<string>()
  useEffect(() => {
    const page = scroller.current
    if (page === null) return
    const read = () => {
      let found: string | undefined
      for (const section of guide.sections) {
        const heading = document.getElementById(section.id)
        if (heading !== null && heading.getBoundingClientRect().top < 150) found = section.id
      }
      setAt(found)
    }
    read()
    page.addEventListener("scroll", read, { passive: true })
    return () => page.removeEventListener("scroll", read)
  }, [guide])

  return (
    <main className="dx" ref={scroller}>
      <header className="dx-nav">
        <Link to="/" className="dx-brand">
          <img src="/favicon.svg" alt="" />
          Do Computer
        </Link>
        <nav>
          <Link to="/docs" aria-current="page">
            Docs
          </Link>
          <a href={REPOSITORY} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={DOWNLOADS} target="_blank" rel="noreferrer">
            Download
          </a>
        </nav>
        <span className="grow" />
        <Link to="/login">Sign in</Link>
        {door.open ? (
          <Link to="/welcome" className="dx-button dx-dark">
            Get started
          </Link>
        ) : door.landing ? (
          <span className="dx-soon">
            <i />
            Coming soon
          </span>
        ) : null}
      </header>

      {/* On a phone the guides fold into this line. Choosing where to go folds it again. */}
      <details className="dx-menu" ref={menu}>
        <summary>
          <span>Docs</span>
          <b>{guide.title}</b>
        </summary>
        <div
          onClick={(event) => {
            if (event.target instanceof HTMLAnchorElement && menu.current !== null) {
              menu.current.open = false
            }
          }}
        >
          <Guides guide={guide} at={at} />
        </div>
      </details>

      <div className="dx-page">
        <aside className="dx-side">
          <Guides guide={guide} at={at} />
        </aside>
        <header className="dx-head">
          <p className="dx-crumb">Guides</p>
          <h1>{guide.title}</h1>
          <p>{guide.summary}</p>
        </header>
        <aside className="dx-hand">
          <HandOff guide={guide} origin={origin} />
        </aside>
        <article className="dx-doc">
          <ReactMarkdown remarkPlugins={plugins} components={components}>
            {guide.body}
          </ReactMarkdown>
        </article>
      </div>

      <footer className="dx-foot">
        <span className="dx-brand">
          <img src="/favicon.svg" alt="" />
          Do Computer
        </span>
        <span>Open source, MIT</span>
        <span className="grow" />
        <a href={REPOSITORY} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href={DOWNLOADS} target="_blank" rel="noreferrer">
          Download
        </a>
        <Link to="/login">Sign in</Link>
      </footer>
    </main>
  )
}
