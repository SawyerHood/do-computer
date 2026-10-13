import { CodeIcon, FlowArrowIcon } from "@phosphor-icons/react"
import { type CSSProperties, useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { useAppColors } from "@/lib/visual-theme"
import { CodeBlock } from "./code-block.tsx"

/** A color of the app's, as the six digits Mermaid can read: it knows nothing of `oklch()`. */
function hexOf(variable: string): string {
  const probe = document.createElement("span")
  probe.style.color = `var(${variable})`
  probe.style.display = "none"
  document.documentElement.appendChild(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (context === null) return "#888888"
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((part) => (part ?? 0).toString(16).padStart(2, "0")).join("")}`
}

// Written so that the server's build leaves Mermaid out altogether: it is larger than the app.
const load = import.meta.env.SSR ? undefined : () => import("mermaid")

// Mermaid keeps one set of settings and draws one diagram at a time, so they take turns.
let turn: Promise<unknown> = Promise.resolve()

async function draw(id: string, source: string, dark: boolean): Promise<string> {
  const next = turn.then(async () => {
    if (load === undefined) throw new Error("No diagram is drawn on the server.")
    const { default: mermaid } = await load()
    const ink = hexOf("--foreground")
    const quiet = hexOf("--muted-foreground")
    const line = hexOf("--border")
    mermaid.initialize({
      startOnLoad: false,
      // What a diagram says is text, never markup, and nothing in it can be clicked.
      securityLevel: "strict",
      theme: "base",
      // Flat boxes: its newer look puts a pale shadow under each, which glows in the dark.
      look: "classic",
      fontFamily: getComputedStyle(document.body).fontFamily,
      // A box is as wide as its words: left alone, each is made wide enough for a sentence,
      // and a diagram of five short words is too wide to read on a phone.
      flowchart: { minNodeWidth: 0, nodeSpacing: 36, rankSpacing: 40, padding: 12 },
      state: { minNodeWidth: 0 },
      themeVariables: {
        darkMode: dark,
        background: hexOf("--background"),
        primaryColor: hexOf("--surface"),
        primaryTextColor: ink,
        primaryBorderColor: hexOf("--input"),
        secondaryColor: hexOf("--accent"),
        secondaryTextColor: ink,
        secondaryBorderColor: line,
        tertiaryColor: hexOf("--muted"),
        tertiaryTextColor: ink,
        tertiaryBorderColor: line,
        lineColor: quiet,
        textColor: ink,
        titleColor: ink,
        edgeLabelBackground: hexOf("--muted"),
        noteBkgColor: hexOf("--muted"),
        noteTextColor: ink,
        noteBorderColor: line,
        fontSize: "14px",
      },
    })
    return (await mermaid.render(id, source)).svg
  })
  // One that could not be drawn does not hold up the next.
  turn = next.catch(() => {})
  return next
}

/**
 * A `mermaid` block as the diagram it describes, in the app's colors, with a switch back to
 * what was written. One that cannot be drawn, or is still being written, is shown as its code.
 */
export function MermaidBlock({ code, writing }: { code: string; writing: boolean }) {
  const id = `mermaid-${useId().replace(/[^a-z0-9]/gi, "")}`
  const { appearance, color } = useAppColors()
  const [drawn, setDrawn] = useState<{ of: string; svg?: string }>()
  const [asCode, setAsCode] = useState(false)
  const of = `${appearance}\n${color}\n${code}`
  useEffect(() => {
    if (writing || code.trim() === "") return
    let current = true
    void draw(id, code, appearance === "dark").then(
      (svg) => {
        if (current) setDrawn({ of, svg })
      },
      () => {
        if (current) setDrawn({ of })
        // Mermaid leaves what it could not draw on the page.
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
      },
    )
    return () => {
      current = false
    }
  }, [appearance, code, id, of, writing])
  // The diagram as it was last drawn stays up while it is drawn again in other colors.
  const svg = drawn?.svg
  const failed = drawn !== undefined && drawn.of === of && drawn.svg === undefined
  if (writing || failed) return <CodeBlock code={code} language="mermaid" writing={writing} />
  return (
    <CodeBlock
      code={code}
      language="mermaid"
      actions={
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={asCode ? "Show the diagram" : "Show the code"}
          title={asCode ? "Show the diagram" : "Show the code"}
          onClick={() => setAsCode((now) => !now)}
        >
          {asCode ? <FlowArrowIcon /> : <CodeIcon />}
        </Button>
      }
    >
      {asCode ? undefined : svg === undefined ? (
        <div role="status" className="md-diagram text-xs text-muted-foreground">
          Drawing the diagram…
        </div>
      ) : (
        <div
          role="img"
          aria-label="Diagram"
          className="md-diagram"
          // How wide Mermaid drew it. Where there is less room it is made smaller, but only
          // so far: past that it scrolls, since words too small to read say nothing.
          style={
            { "--drawn": `${/max-width:\s*([\d.]+)px/.exec(svg)?.[1] ?? "0"}px` } as CSSProperties
          }
          // Mermaid's own drawing, which it has already cleaned.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: see above
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </CodeBlock>
  )
}
