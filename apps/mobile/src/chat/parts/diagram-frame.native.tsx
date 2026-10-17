import { DIAGRAM_DRAW, readDiagramMessage } from "@do-computer/protocol"
import { useEffect, useRef } from "react"
import { WebView } from "react-native-webview"
import type { DiagramPageProps } from "./diagram-frame"

/**
 * The page that draws a diagram, on a phone: a web view on the deployment's own page, with no
 * session and nothing kept. It is handed the diagram by a call the app makes inside it, says
 * how large it drew it, and cannot go anywhere else.
 */
export function DiagramPage({ src, ask, onSaid }: DiagramPageProps) {
  const web = useRef<WebView>(null)
  const ready = useRef(false)
  const draw = () =>
    web.current?.injectJavaScript(
      `window[${JSON.stringify(DIAGRAM_DRAW)}]&&window[${JSON.stringify(DIAGRAM_DRAW)}](${JSON.stringify(ask)});true;`,
    )
  useEffect(() => {
    if (ready.current) draw()
  }, [ask.code, ask.dark, ask.color])
  return (
    <WebView
      ref={web}
      source={{ uri: src }}
      originWhitelist={["https://*", "http://*"]}
      style={{ flex: 1, backgroundColor: "transparent" }}
      containerStyle={{ backgroundColor: "transparent" }}
      scrollEnabled={false}
      bounces={false}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      incognito
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      setSupportMultipleWindows={false}
      allowsLinkPreview={false}
      allowsBackForwardNavigationGestures={false}
      allowFileAccess={false}
      onError={() => onSaid({ kind: "failed" })}
      onHttpError={() => onSaid({ kind: "failed" })}
      onMessage={(event) => {
        const said = readDiagramMessage(event.nativeEvent.data)
        if (said === undefined) return
        if (said.kind !== "ready") return onSaid(said)
        ready.current = true
        draw()
      }}
      // Nothing in a diagram is followed: the page stays the page.
      onShouldStartLoadWithRequest={(request) =>
        request.url.split(/[?#]/)[0] === src || request.url === "about:blank"
      }
    />
  )
}
