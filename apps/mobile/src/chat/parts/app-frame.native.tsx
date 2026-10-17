import { useEffect, useRef } from "react"
import { View } from "react-native"
import { WebView } from "react-native-webview"
import type { AppPageProps } from "./app-frame"

/**
 * Run in the page before anything of its own. A connector's page speaks to the window around
 * it, and on a phone there is none: it is the whole of a web view. So it is given one that
 * tells the app what the page posts, and what the app says is handed to the page as a message
 * from that window, which is where a page looks to see who is speaking.
 */
export const APP_SCRIPT =
  `(function(){if(window.__dcApp)return;window.__dcApp=1;` +
  `var h={postMessage:function(m){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));}};` +
  `try{Object.defineProperty(window,"parent",{configurable:true,get:function(){return h;}});}catch(e){try{window.parent=h;}catch(x){}}` +
  `window.__dcHear=function(m){var e;try{e=new MessageEvent("message",{data:m});}catch(x){e=document.createEvent("MessageEvent");` +
  `e.initMessageEvent("message",false,false,m,"","",null);}` +
  `try{Object.defineProperty(e,"source",{value:h});}catch(x){}window.dispatchEvent(e);};})();true;`

/**
 * A connector's page on a phone: a web view of its own. The page is served only to whoever is
 * signed in, so it is asked for with the session, once; the page itself is given no cookie and
 * keeps nothing, and it cannot leave where it is. What it posts goes to the app, and what it may
 * do only on the reader's own press is done only just after they touched it.
 */
export function AppPage({ src, headers, title, bridge, onMessage }: AppPageProps) {
  const web = useRef<WebView>(null)
  const touched = useRef(0)
  useEffect(() => {
    bridge.post = (message) =>
      web.current?.injectJavaScript(
        `window.__dcHear&&window.__dcHear(${JSON.stringify(message)});true;`,
      )
    bridge.pressed = async () => Date.now() - touched.current < 2_000
  }, [bridge])
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
        source={{ uri: src, headers }}
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
        injectedJavaScriptBeforeContentLoaded={APP_SCRIPT}
        onMessage={(event) => {
          try {
            onMessage(JSON.parse(event.nativeEvent.data))
          } catch {
            // Not something a page says.
          }
        }}
        // The page stays the page: a link is opened only when the page asks the app to.
        onShouldStartLoadWithRequest={(request) =>
          request.url.split("#")[0] === src ||
          request.url === "about:blank" ||
          request.isTopFrame === false
        }
      />
    </View>
  )
}
