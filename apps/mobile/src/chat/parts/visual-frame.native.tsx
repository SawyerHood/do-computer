import { readVisualHeight, type VisualTheme } from "@durable-computer/protocol"
import { useEffect, useMemo, useRef } from "react"
import { Linking, Platform, View } from "react-native"
import { WebView } from "react-native-webview"
import type { VisualPageProps } from "./visual-frame"

// The names a visual's own script uses (see packages/protocol/src/visual.ts). A visual speaks
// to the window around it, and on a phone there is none: it is the whole of a web view. So the
// little its script would have done in a frame is done here, in the same words.
const SIZE_CHANGED = "ui/notifications/size-changed"

/** Run in the page: lay it out as part of an answer, and say how tall it is whenever that changes. */
const HOST_SCRIPT =
  `(function(){var r=document.documentElement;if(!r||window.__dcHost)return;window.__dcHost=1;` +
  `r.setAttribute("data-dc-inline","");var h,o,z=function(){` +
  `var v=Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height);` +
  `if(v===h||!window.ReactNativeWebView)return;h=v;window.ReactNativeWebView.postMessage(JSON.stringify(` +
  `{jsonrpc:"2.0",method:${JSON.stringify(SIZE_CHANGED)},params:{height:v}}));};` +
  `if(window.ResizeObserver){o=new ResizeObserver(z);o.observe(r);if(document.body)o.observe(document.body);}` +
  `document.addEventListener("DOMContentLoaded",function(){if(o&&document.body)o.observe(document.body);z();});` +
  `window.addEventListener("load",z);z();})();true;`

/** Run in the page when the app's colors change: what the page's script does with a message. */
const themeScript = (theme: VisualTheme) =>
  `(function(){var r=document.documentElement;if(!r)return;` +
  `r.setAttribute("data-dc-theme",${JSON.stringify(theme.appearance)});` +
  (theme.color === undefined
    ? ""
    : `r.style.setProperty("--agent-color",${JSON.stringify(theme.color)});`) +
  `})();true;`

/**
 * A visual's page on a phone: a web view of its own, kept apart from the app. It has no session
 * and keeps nothing, it cannot leave its page, and a link the reader taps opens in the browser.
 */
export function VisualPage({ src, title, theme, onHeight }: VisualPageProps) {
  const web = useRef<WebView>(null)
  const page = useMemo(() => src.split("#")[0], [src])
  // When the reader last touched the page: only a link they tapped is followed.
  const touched = useRef(0)
  useEffect(() => {
    web.current?.injectJavaScript(themeScript(theme))
  }, [theme])
  return (
    <View
      accessibilityLabel={title}
      style={{ flex: 1 }}
      onTouchStart={() => {
        touched.current = Date.now()
      }}
    >
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
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        allowsLinkPreview={false}
        allowsBackForwardNavigationGestures={false}
        allowFileAccess={false}
        injectedJavaScriptBeforeContentLoaded={HOST_SCRIPT}
        injectedJavaScript={HOST_SCRIPT + themeScript(theme)}
        onMessage={(event) => {
          try {
            const tall = readVisualHeight(JSON.parse(event.nativeEvent.data))
            if (tall !== undefined) onHeight(tall)
          } catch {
            // Not something a visual says.
          }
        }}
        onShouldStartLoadWithRequest={(request) => {
          if (request.url.split("#")[0] === page || request.url === "about:blank") return true
          // Something the page frames inside itself is the page's own business.
          if (Platform.OS === "ios" && request.isTopFrame === false) return true
          const tapped =
            Date.now() - touched.current < 2_000 &&
            (Platform.OS !== "ios" || request.navigationType === "click")
          if (tapped && /^https?:\/\//i.test(request.url)) void Linking.openURL(request.url)
          return false
        }}
      />
    </View>
  )
}
