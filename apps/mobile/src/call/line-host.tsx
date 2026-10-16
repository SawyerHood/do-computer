import { useAtomValue } from "jotai"
import { useEffect, useRef, useState } from "react"
import { View } from "react-native"
import { WebView } from "react-native-webview"
import { serverAtom } from "@/lib/session"
import { type FromPage, readFromPage, setLineHost, type ToPage } from "./line"
import { LINE_PAGE } from "./line-page"

/**
 * Where the sound of a call is carried on a phone: the system's web view, running LINE_PAGE,
 * out of sight. It is only there while a call is. See line.ts for why a web view.
 */
export function LineHost() {
  const server = useAtomValue(serverAtom)
  const [page, setPage] = useState<{ key: number; onMessage: (message: FromPage) => void }>()
  const view = useRef<WebView>(null)
  useEffect(() => {
    let count = 0
    setLineHost({
      open(onMessage) {
        const key = ++count
        setPage({ key, onMessage })
        return {
          post(message: ToPage) {
            // A call to the page's own function, which is how a web view is told anything on
            // both systems alike.
            view.current?.injectJavaScript(
              `window.__line && window.__line(${JSON.stringify(message)}); true;`,
            )
          },
          release() {
            setPage((current) => (current?.key === key ? undefined : current))
          },
        }
      },
    })
    return () => setLineHost(undefined)
  }, [])
  if (page === undefined || server === null) return null
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ position: "absolute", width: 1, height: 1, left: -10, top: -10, opacity: 0 }}
    >
      <WebView
        key={page.key}
        ref={view}
        // The page's address is the deployment's, which is a secure one: a page anywhere else
        // is given no microphone. It asks nothing of the deployment itself.
        source={{ html: LINE_PAGE, baseUrl: server }}
        originWhitelist={["*"]}
        onMessage={(event) => {
          const message = readFromPage(event.nativeEvent.data)
          if (message !== null) page.onMessage(message)
        }}
        // The app asked for the microphone already; the page is not to ask again.
        mediaCapturePermissionGrantType="grant"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        style={{ width: 1, height: 1, backgroundColor: "transparent" }}
      />
    </View>
  )
}
