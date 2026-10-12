import { ActivityIndicator, View } from "react-native"
import { WebView } from "react-native-webview"
import { useTheme } from "@/lib/theme"

/**
 * Something shown by the system's own web view: an HTML page of the library as the page it is,
 * or a PDF. A page runs on its own, apart from the app and the account. In the browser build
 * it is a frame (see page-view.web.tsx).
 */
export function PageView({
  uri,
  headers,
  title,
}: {
  uri: string
  /** The session, for an address that needs it. A page's view address does not. */
  headers?: Record<string, string>
  title: string
}) {
  const theme = useTheme()
  return (
    <WebView
      accessibilityLabel={title}
      source={headers === undefined ? { uri } : { uri, headers }}
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
