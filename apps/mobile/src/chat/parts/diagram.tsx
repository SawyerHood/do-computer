import { DIAGRAM_PATH, type DiagramAsk, type DiagramSaid, diagramFit } from "@do-computer/protocol"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ScrollView, View } from "react-native"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Text } from "@/ui"
import type { MarkdownProps } from "@/ui/markdown"
import { DiagramPage } from "./diagram-frame"

/** How long the deployment's page is waited for before the diagram is shown as its code. */
const GIVE_UP_MS = 15_000

/** How tall the place for a diagram is while it is being drawn. */
const WAITING_HEIGHT = 120

/**
 * A `mermaid` block as its diagram. A phone cannot draw one, so the deployment's own page does
 * (`/embed/diagram`, the web app's drawing), in the app's light or dark. It is shown as large
 * as it was drawn where that fits, a little smaller where it nearly does, and scrolls sideways
 * past that. A deployment from before that page, or a diagram that cannot be drawn, is told to
 * `onFailed`, and is shown as its code.
 */
function Diagram({ code, onFailed }: { code: string; onFailed: () => void }) {
  const { server } = useSession()
  const theme = useTheme()
  const [drawn, setDrawn] = useState<{ width: number; height: number }>()
  const [room, setRoom] = useState<number>()
  const ask = useMemo((): DiagramAsk => ({ code, dark: theme.dark }), [code, theme.dark])
  const failed = useRef(onFailed)
  failed.current = onFailed
  const waiting = drawn === undefined
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => failed.current(), GIVE_UP_MS)
    return () => clearTimeout(timer)
  }, [waiting])
  const onSaid = useCallback((said: DiagramSaid) => {
    if (said.kind === "drawn") setDrawn({ width: said.width, height: said.height })
    else if (said.kind === "failed") failed.current()
  }, [])
  const size =
    drawn === undefined || room === undefined
      ? { width: room ?? 0, height: WAITING_HEIGHT }
      : diagramFit(drawn, room)
  return (
    <View
      accessibilityLabel="Diagram"
      onLayout={(event) => setRoom(event.nativeEvent.layout.width)}
      style={{ width: "100%" }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={room !== undefined && size.width > room}
      >
        <View style={{ width: size.width, height: size.height, opacity: waiting ? 0 : 1 }}>
          {room === undefined ? null : (
            <DiagramPage src={`${server}${DIAGRAM_PATH}`} ask={ask} onSaid={onSaid} />
          )}
        </View>
      </ScrollView>
      {waiting ? (
        <View
          accessibilityRole="progressbar"
          style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}
        >
          <Text variant="footnote" tone="ink2">
            Drawing the diagram…
          </Text>
        </View>
      ) : null}
    </View>
  )
}

/** How the Markdown of a chat or a document draws a diagram. */
export const drawDiagram: NonNullable<MarkdownProps["diagram"]> = (code, onFailed) => (
  <Diagram code={code} onFailed={onFailed} />
)
