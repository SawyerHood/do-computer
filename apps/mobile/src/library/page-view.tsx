import { type VisualTheme, visualThemeFragment } from "@do-computer/protocol"
import { useEffect, useRef } from "react"
import { ActivityIndicator, View } from "react-native"
import { WebView } from "react-native-webview"
import { useTheme } from "@/lib/theme"

/** Run in the page when the app's colors change: what the page's script does with a message. */
const themeScript = (theme: VisualTheme) =>
  `(function(){var r=document.documentElement;if(!r)return;` +
  `r.setAttribute("data-dc-theme",${JSON.stringify(theme.appearance)});` +
  (theme.color === undefined
    ? ""
    : `r.style.setProperty("--agent-color",${JSON.stringify(theme.color)});`) +
  `})();true;`

/**
 * Something shown by the system's own web view: an HTML page of the library as the page it is,
 * or a PDF. A page runs on its own, apart from the app and the account. In the browser build
 * it is a frame (see page-view.web.tsx).
 *
 * With `colors`, a page is shown in the app's look as the web app shows it: light or dark as
 * the app is, with its Dood's own color. They ride on the address it starts at, and it is told
 * when they change, without being loaded again.
 */
export function PageView({
  uri,
  headers,
  title,
  colors,
}: {
  uri: string
  /** The session, for an address that needs it. A page's view address does not. */
  headers?: Record<string, string>
  title: string
  colors?: VisualTheme
}) {
  const theme = useTheme()
  const web = useRef<WebView>(null)
  // The page keeps the address it was first given: a new one would load it again.
  const first = useRef(colors)
  const at = first.current === undefined ? uri : `${uri}${visualThemeFragment(first.current)}`
  useEffect(() => {
    if (colors !== undefined) web.current?.injectJavaScript(themeScript(colors))
  }, [colors])
  return (
    <WebView
      ref={web}
      accessibilityLabel={title}
      source={headers === undefined ? { uri: at } : { uri: at, headers }}
      originWhitelist={["https://*", "http://*"]}
      // A page from the library is somebody's document, not a part of the app: it gets no cookies.
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      startInLoadingState
      renderLoading={() => (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.page,
          }}
        >
          <ActivityIndicator />
        </View>
      )}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustContentInsets
      style={{ flex: 1, backgroundColor: theme.page }}
    />
  )
}
