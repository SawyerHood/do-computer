import { Fragment, type ReactNode } from "react"
import { Linking, Platform, ScrollView, StyleSheet, Text as NativeText, View } from "react-native"
import { radius, space, useTheme } from "@/lib/theme"

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "code"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }

/** Split Markdown into the blocks an agent's replies are made of. Anything else stays a paragraph. */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (line.trim() === "") {
      index++
      continue
    }
    const fence = /^\s*```/.exec(line)
    if (fence) {
      const code: string[] = []
      index++
      while (index < lines.length && !/^\s*```/.test(lines[index]!)) code.push(lines[index++]!)
      index++
      blocks.push({ type: "code", text: code.join("\n") })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! })
      index++
      continue
    }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/
    if (item.test(line)) {
      const ordered = item.exec(line)![2] !== undefined
      const items: string[] = []
      while (index < lines.length && item.test(lines[index]!)) {
        items.push(item.exec(lines[index++]!)![3]!)
      }
      blocks.push({ type: "list", ordered, items })
      continue
    }
    if (line.startsWith(">")) {
      const quoted: string[] = []
      while (index < lines.length && lines[index]!.startsWith(">")) {
        quoted.push(lines[index++]!.replace(/^>\s?/, ""))
      }
      blocks.push({ type: "quote", text: quoted.join("\n") })
      continue
    }
    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index]!.trim() !== "" &&
      !/^\s*```|^#{1,6}\s|^>/.test(lines[index]!) &&
      !item.test(lines[index]!)
    ) {
      paragraph.push(lines[index++]!)
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") })
  }
  return blocks
}

export type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string }

/** Inline emphasis, code and links. Unmatched markers are left as typed. */
export function parseInline(text: string): Span[] {
  const spans: Span[] = []
  // Underscores only mark emphasis at word edges, so names_like_this stay as written.
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|((?<![\w])_[^_\s][^_]*_(?![\w]))|(\[[^\]]+\]\([^)\s]+\))/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) spans.push({ text: text.slice(last, match.index) })
    const token = match[0]
    if (match[1]) spans.push({ text: token.slice(1, -1), code: true })
    else if (match[2]) spans.push({ text: token.slice(2, -2), bold: true })
    else if (match[3] || match[4]) spans.push({ text: token.slice(1, -1), italic: true })
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!
      spans.push({ text: link[1]!, href: link[2]! })
    }
    last = match.index + token.length
  }
  if (last < text.length) spans.push({ text: text.slice(last) })
  return spans
}

const mono = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, Menlo, monospace",
})

function Inline({ text, color }: { text: string; color: string }) {
  const theme = useTheme()
  return (
    <>
      {parseInline(text).map((span, index) => (
        <NativeText
          key={index}
          onPress={
            // Only web links are opened; anything else an agent wrote is shown, not followed.
            span.href && /^https?:\/\//.test(span.href)
              ? () => void Linking.openURL(span.href!)
              : undefined
          }
          style={{
            color,
            fontWeight: span.bold ? "600" : "400",
            fontStyle: span.italic ? "italic" : "normal",
            textDecorationLine: span.href ? "underline" : "none",
            ...(span.code
              ? { fontFamily: mono, fontSize: 13.5, backgroundColor: theme.raised }
              : {}),
          }}
        >
          {span.text}
        </NativeText>
      ))}
    </>
  )
}

/** An agent's reply, rendered from Markdown. Raw HTML is shown as text, never interpreted. */
export function Markdown({ text, color }: { text: string; color: string }) {
  const theme = useTheme()
  const body = { color, fontSize: 15.5, lineHeight: 22 }
  const render = (block: Block): ReactNode => {
    switch (block.type) {
      case "heading":
        return (
          <NativeText style={[body, { fontWeight: "600", fontSize: block.level <= 2 ? 17.5 : 16 }]}>
            <Inline text={block.text} color={color} />
          </NativeText>
        )
      case "code":
        return (
          <ScrollView horizontal style={[styles.code, { backgroundColor: theme.raised }]}>
            <NativeText style={{ color, fontFamily: mono, fontSize: 13 }}>{block.text}</NativeText>
          </ScrollView>
        )
      case "list":
        return (
          <View style={{ gap: space(1) }}>
            {block.items.map((item, index) => (
              <View key={index} style={{ flexDirection: "row", gap: space(2) }}>
                <NativeText style={[body, { color: theme.muted }]}>
                  {block.ordered ? `${index + 1}.` : "•"}
                </NativeText>
                <NativeText style={[body, { flex: 1 }]}>
                  <Inline text={item} color={color} />
                </NativeText>
              </View>
            ))}
          </View>
        )
      case "quote":
        return (
          <View style={[styles.quote, { borderColor: theme.border }]}>
            <NativeText style={[body, { color: theme.muted }]}>
              <Inline text={block.text} color={theme.muted} />
            </NativeText>
          </View>
        )
      default:
        return (
          <NativeText style={body}>
            <Inline text={block.text} color={color} />
          </NativeText>
        )
    }
  }
  return (
    <View style={{ gap: space(2.5) }}>
      {parseBlocks(text).map((block, index) => (
        <Fragment key={index}>{render(block)}</Fragment>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  code: { borderRadius: radius.sm, padding: space(3) },
  quote: { borderLeftWidth: 2, paddingLeft: space(3) },
})
