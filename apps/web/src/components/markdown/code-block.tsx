import { ArrowElbowDownLeftIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { type ReactNode, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { highlight, highlightedBefore, type Token } from "./highlight.ts"
import { useCopied } from "./use-copied.ts"

/** The code's colors, once they have been read. Until then, and where there are none, it is plain. */
function useHighlighted(code: string, language: string, wanted: boolean): Token[][] | undefined {
  const [read, setRead] = useState<{ of: string; lines: Token[][] | undefined }>()
  const of = `${language}\n${code}`
  useEffect(() => {
    if (!wanted) return
    let current = true
    void highlight(code, language).then(
      (lines) => {
        if (current) setRead({ of, lines })
      },
      // A grammar that would not load leaves the code plain, which is still the code.
      () => {},
    )
    return () => {
      current = false
    }
  }, [code, language, of, wanted])
  if (!wanted) return undefined
  return read?.of === of ? read.lines : highlightedBefore(code, language)
}

/**
 * A block of code: what it is written in, a button to copy it and one to wrap its long lines,
 * and the code in its colors. While a reply is still writing the block it is shown plain, since
 * half a block reads wrongly and would be read again at every word.
 *
 * `children` stands in for the code where the block is shown as something else, a diagram say,
 * and `actions` are put before the buttons.
 */
export function CodeBlock({
  code,
  language,
  writing = false,
  actions,
  children,
}: {
  code: string
  language: string
  /** The reply is still writing this block. */
  writing?: boolean
  actions?: ReactNode
  children?: ReactNode
}) {
  const [wrap, setWrap] = useState(false)
  const [copied, copy] = useCopied()
  const lines = useHighlighted(code, language, !writing && children === undefined)
  return (
    <div className="md-code" data-language={language || undefined}>
      <div className="md-code-head">
        <span className="md-code-language">{language}</span>
        {actions}
        {children === undefined ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-pressed={wrap}
            aria-label="Wrap long lines"
            title={wrap ? "Do not wrap long lines" : "Wrap long lines"}
            className={wrap ? "bg-muted text-foreground" : undefined}
            onClick={() => setWrap((now) => !now)}
          >
            <ArrowElbowDownLeftIcon />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={copied ? "Copied" : "Copy code"}
          title="Copy code"
          onClick={() => copy(code)}
        >
          {copied ? <CheckIcon weight="bold" /> : <CopyIcon />}
        </Button>
      </div>
      {children ?? (
        <pre data-wrap={wrap || undefined}>
          <code>
            {lines === undefined
              ? code
              : lines.map((line, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a line is known by its place
                  <span key={at}>
                    {line.map((token, part) =>
                      token.color === undefined && token.italic === undefined ? (
                        token.text
                      ) : (
                        <span
                          // biome-ignore lint/suspicious/noArrayIndexKey: as above
                          key={part}
                          style={{
                            color: token.color,
                            fontStyle: token.italic ? "italic" : undefined,
                          }}
                        >
                          {token.text}
                        </span>
                      ),
                    )}
                    {at === lines.length - 1 ? null : "\n"}
                  </span>
                ))}
          </code>
        </pre>
      )}
    </div>
  )
}
