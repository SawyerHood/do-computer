import {
  dirOf,
  parseDelimited,
  resolveLink,
  SITE_LISTING_HEADER,
  type SiteListing,
  themedPage,
} from "@do-computer/protocol"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "@/components/markdown/pipeline"

/** Text larger than this is offered as a download: it would be slow to show as a page. */
const MAX_SHOWN_BYTES = 1024 * 1024

const DOC_STYLE =
  ".doc{font-size:15.5px;line-height:1.7;overflow-wrap:anywhere}.doc>*{margin:0}.doc>*+*{margin-top:14px}" +
  ".doc h1,.doc h2,.doc h3,.doc h4{font-weight:600;letter-spacing:-0.01em;line-height:1.25}" +
  ".doc h1{font-size:30px}.doc h2{font-size:20px;margin-top:36px}.doc h3{font-size:16px;margin-top:24px}" +
  ".doc ul,.doc ol{padding-left:24px}.doc li+li{margin-top:4px}.doc li>ul,.doc li>ol{margin-top:4px}" +
  ".doc ul.contains-task-list{list-style:none;padding-left:4px}" +
  ".doc blockquote{border-left:2px solid var(--border);padding-left:12px;color:var(--muted-foreground)}" +
  ".doc code{background:var(--muted);border-radius:4px;padding:1px 4px;font-size:.85em}" +
  ".doc pre{background:var(--muted);border-radius:8px;padding:12px;overflow-x:auto;font-size:13px;line-height:1.5}" +
  ".doc pre code{background:none;padding:0}.doc table{border-collapse:collapse;display:block;overflow-x:auto}" +
  ".doc th,.doc td{border:1px solid var(--border);padding:4px 8px;text-align:left}" +
  ".doc hr{border:0;border-top:1px solid var(--border)}.doc img{max-width:100%;border-radius:8px}" +
  ".doc .alert{--alert:var(--muted-foreground);border-left:2px solid var(--alert);padding-left:12px}" +
  ".doc .alert>*{margin:0}.doc .alert>*+*{margin-top:6px}.doc .alert-title{color:var(--alert);font-weight:500;font-size:14px}" +
  '.doc .alert[data-alert="tip"]{--alert:var(--success)}.doc .alert[data-alert="important"]{--alert:var(--syntax-keyword)}' +
  '.doc .alert[data-alert="warning"]{--alert:var(--warning)}.doc .alert[data-alert="caution"]{--alert:var(--destructive)}' +
  ".doc details{border-block:1px solid var(--border)}.doc summary{cursor:pointer;padding:8px 0;font-weight:500}" +
  ".doc details>:not(summary){margin-left:14px}.doc details>:last-child:not(summary){margin-bottom:12px}" +
  ".doc kbd{font-family:var(--font-mono);font-size:.8em;border:1px solid var(--border);border-bottom-width:2px;border-radius:5px;padding:1px 5px;background:var(--surface)}" +
  ".doc mark{background:color-mix(in oklch,var(--warning) 28%,transparent);color:inherit;border-radius:3px;padding:0 2px}"

const LIST_STYLE =
  "h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-0.01em}.where{margin:2px 0 0;color:var(--muted-foreground);font-size:13px}" +
  "ul{list-style:none;margin:20px 0 0;padding:0;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--surface)}" +
  "li+li{border-top:1px solid var(--border)}li a{display:flex;align-items:center;gap:10px;padding:10px 12px;text-decoration:none}" +
  "li a:hover{background:var(--accent)}svg{flex:none;color:var(--muted-foreground)}.name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}" +
  ".meta{flex:none;color:var(--muted-foreground);font-size:12px;font-variant-numeric:tabular-nums}"

const CENTER_STYLE =
  "body{max-width:none!important;min-height:100vh;box-sizing:border-box;display:grid;place-items:center}" +
  "img,video{max-width:100%;max-height:calc(100vh - 48px);border-radius:8px}audio{width:min(100%,480px)}" +
  ".file{text-align:center}.file svg{color:var(--muted-foreground)}.file h1{margin:12px 0 2px;font-size:17px;font-weight:600;overflow-wrap:anywhere}" +
  ".file p{margin:0;color:var(--muted-foreground);font-size:13px}" +
  ".file a{display:inline-block;margin-top:20px;padding:8px 16px;border-radius:var(--radius);background:var(--primary);color:var(--primary-foreground);font-weight:500;text-decoration:none}"

const TABLE_STYLE =
  "body{max-width:none!important}.rows{overflow-x:auto}table{font-size:13.5px}" +
  "th,td{white-space:pre-wrap;vertical-align:top;max-width:320px}th{position:sticky;top:0;background:var(--background)}" +
  ".cut{margin:12px 0 0;color:var(--muted-foreground);font-size:13px}"

const TEXT_STYLE =
  "body{max-width:960px!important}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.55}"

const icon = (path: string, size = 18) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={path} />
  </svg>
)
const FOLDER =
  "M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"
const FILE =
  "M6.5 3h7L18 7.5v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19.500v-15A1.500 1.500 0 0 1 6.500 3zM13.500 3v4.500H18"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const day = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

/**
 * A Markdown document as a page to read. A link to somewhere else opens in a new tab. For a
 * document shared by itself, at `alone` in the library, a picture beside it is asked for by
 * its place there, which is how the library serves the pictures such a document refers to.
 */
function documentPage(title: string, text: string, alone?: string): string {
  const dir = alone === undefined ? undefined : dirOf(alone)
  const body = renderToStaticMarkup(
    <main className="doc">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={{
          // A note of one of GitHub's kinds says which it is, as it does in the app.
          blockquote: ({ node, children }) => {
            const kind = node?.properties.dataAlert
            return typeof kind !== "string" ? (
              <blockquote>{children}</blockquote>
            ) : (
              <div role="note" className="alert" data-alert={kind}>
                <p className="alert-title">{kind[0]!.toUpperCase() + kind.slice(1)}</p>
                {children}
              </div>
            )
          },
          a: ({ node: _node, href, ...props }) =>
            href !== undefined && /^[a-z][a-z0-9+.-]*:/i.test(href) ? (
              <a {...props} href={href} target="_blank" rel="noopener noreferrer" />
            ) : (
              <a {...props} href={href} />
            ),
          img: ({ node: _node, src, alt, ...props }) => {
            const path =
              dir === undefined || typeof src !== "string" ? undefined : resolveLink(dir, src)
            return (
              <img
                {...props}
                alt={alt ?? ""}
                src={path === undefined ? src : `?picture=${encodeURIComponent(path)}`}
              />
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </main>,
  )
  return themedPage({ title, style: DOC_STYLE, body })
}

/** What is in a shared folder that has no front page: its folders and files, each a link. */
function listingPage(title: string, listing: SiteListing): string {
  const body = renderToStaticMarkup(
    <main>
      <h1>
        {listing.folder === "" ? title : listing.folder.slice(listing.folder.lastIndexOf("/") + 1)}
      </h1>
      <p className="where">
        {listing.folder === ""
          ? "Shared folder"
          : `${title} / ${listing.folder.replaceAll("/", " / ")}`}
      </p>
      <ul>
        {listing.folder === "" ? null : (
          <li>
            <a href="../">
              {icon(FOLDER)}
              <span className="name">..</span>
            </a>
          </li>
        )}
        {listing.entries.map((entry) => (
          <li key={`${entry.kind}:${entry.name}`}>
            <a href={`${encodeURIComponent(entry.name)}${entry.kind === "folder" ? "/" : ""}`}>
              {icon(entry.kind === "folder" ? FOLDER : FILE)}
              <span className="name">{entry.name}</span>
              {entry.kind === "file" && entry.size !== undefined ? (
                <span className="meta">
                  {formatBytes(entry.size)}
                  {entry.updatedAt === undefined ? "" : ` · ${day.format(entry.updatedAt)}`}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </main>,
  )
  return themedPage({ title, style: LIST_STYLE, body })
}

/** A picture, a film or a sound by itself in the middle of the page. `own` is its own address. */
function mediaPage(title: string, kind: "image" | "video" | "audio", own: string): string {
  const body = renderToStaticMarkup(
    kind === "image" ? (
      <img src={own} alt={title} />
    ) : kind === "video" ? (
      <video src={own} controls />
    ) : (
      <audio src={own} controls />
    ),
  )
  return themedPage({ title, style: CENTER_STYLE, body })
}

/** The most rows of a table a shared link shows: past this it is its file. */
const SHARED_ROWS = 1000

/** A CSV or TSV file as the table it is: its first row the headings. */
function tablePage(title: string, text: string, delimiter: "," | "\t"): string {
  const table = parseDelimited(text, delimiter, { rows: SHARED_ROWS + 1 })
  const [head, ...rows] = table.rows
  const body = renderToStaticMarkup(
    <main>
      <div className="rows">
        <table>
          <thead>
            <tr>
              {(head ?? []).map((cell, column) => (
                <th key={column} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, at) => (
              <tr key={at}>
                {row.map((cell, column) => (
                  <td key={column}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.cut ? (
        <p className="cut">
          Showing the first {rows.length} rows. <a href="?download">Download</a> the file for the
          rest.
        </p>
      ) : null}
    </main>,
  )
  return themedPage({ title, style: TABLE_STYLE, body })
}

function textPage(title: string, text: string): string {
  return themedPage({ title, style: TEXT_STYLE, body: renderToStaticMarkup(<pre>{text}</pre>) })
}

/** A file there is no way to show: what it is called, how big it is, and the way to have it. */
function downloadPage(title: string, name: string, size: number | undefined): string {
  const body = renderToStaticMarkup(
    <main className="file">
      {icon(FILE, 40)}
      <h1>{name}</h1>
      <p>{size === undefined ? "" : formatBytes(size)}</p>
      <a href="?download" download={name}>
        Download
      </a>
    </main>,
  )
  return themedPage({ title, style: CENTER_STYLE, body })
}

const isText = (type: string) =>
  type.startsWith("text/") ||
  ["application/json", "application/xml", "application/x-ndjson", "application/yaml"].includes(type)

/**
 * What a site's address shows for what the library answered with. A page is the page. What
 * is not one is shown as what it is when someone goes to it: a document to read, a picture,
 * text, a list of a folder's files, or a download for what cannot be shown. When a page asks
 * for a file, as its stylesheet or its picture or its data, the file is what it gets.
 *
 * `name` is the file's own name, `own` is its address as a link from itself, and `alone` is
 * its place in the library where it is the one thing shared.
 */
export async function shownAs(
  request: Request,
  answer: Response,
  what: { title: string; name: string; own: string; alone?: string },
): Promise<Response> {
  if (answer.status !== 200) return answer
  const url = new URL(request.url)
  // A picture a document shared by itself refers to: only ever the picture.
  if (url.searchParams.has("picture")) return answer
  const dest = request.headers.get("sec-fetch-dest")
  const visiting = dest === "document" || dest === "iframe" || dest === "frame"
  const listing = answer.headers.get(SITE_LISTING_HEADER) !== null
  if (listing && !visiting) return new Response("Not found", { status: 404 })
  if (!listing && url.searchParams.has("download")) {
    const headers = new Headers(answer.headers)
    headers.set(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(what.name)}`,
    )
    return new Response(answer.body, { headers })
  }
  const type = (answer.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
  if (!listing && (!visiting || type === "text/html")) return answer
  const size = Number(answer.headers.get("content-length") ?? "")
  const known = Number.isFinite(size) && size > 0 ? size : undefined
  const raw = `${what.own}?raw`
  const page = listing
    ? listingPage(what.title, (await answer.json()) as SiteListing)
    : type.startsWith("image/")
      ? mediaPage(what.title, "image", raw)
      : type.startsWith("video/")
        ? mediaPage(what.title, "video", raw)
        : type.startsWith("audio/")
          ? mediaPage(what.title, "audio", raw)
          : isText(type) && (known ?? 0) <= MAX_SHOWN_BYTES
            ? type === "text/markdown"
              ? documentPage(what.title, await answer.text(), what.alone)
              : type === "text/csv" || type === "text/tab-separated-values"
                ? tablePage(what.title, await answer.text(), type === "text/csv" ? "," : "\t")
                : textPage(what.title, await answer.text())
            : downloadPage(what.title, what.name, known)
  return new Response(page, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The page made here runs as the site's own pages do: apart from the app, as nobody.
      "content-security-policy": answer.headers.get("content-security-policy") ?? "sandbox",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      // What an address answers with depends on who asks: a reader, or a page loading a file.
      "cache-control": "private, no-store",
      vary: "sec-fetch-dest",
    },
  })
}
