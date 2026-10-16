import {
  readVisualHeight,
  readVisualMode,
  readVisualSave,
  readVisualSay,
  type VisualTheme,
} from "@do-computer/protocol"
import { useEffect, useMemo, useRef } from "react"
import { Linking, Platform, View } from "react-native"
import { WebView } from "react-native-webview"
import type { VisualPageProps } from "./visual-frame"

// The names a visual's own script uses (see packages/protocol/src/visual.ts). A visual speaks
// to the window around it, and on a phone there is none: it is the whole of a web view. So the
// little its script would have done in a frame is done here, in the same words.
const SIZE_CHANGED = "ui/notifications/size-changed"
const MESSAGE = "ui/message"

const DISPLAY_MODE = "ui/request-display-mode"
const DOWNLOAD_FILE = "ui/download-file"

/**
 * Run in the page: `dc.say`, `dc.expand` and `dc.save` there speak to the window around the
 * page, and so do nothing here. They are given ones that tell the app, in the words they would
 * have used. The page's own script makes `dc` after this has run, so the new ones are put on
 * whatever `dc` is set to.
 */
export const SAY_SCRIPT =
  `(function(){if(window.__dcSay)return;window.__dcSay=1;var n=0,d=window.dc,` +
  `q=function(k,m,a){if(!window.ReactNativeWebView)return false;` +
  `window.ReactNativeWebView.postMessage(JSON.stringify({jsonrpc:"2.0",id:"dc-"+k+"-"+(++n),method:m,params:a}));return true;},` +
  `s=function(t){return q("say",${JSON.stringify(MESSAGE)},{role:"user",content:[{type:"text",text:String(t)}]});},` +
  `x=function(b){return q("expand",${JSON.stringify(DISPLAY_MODE)},{mode:b===false?"inline":"fullscreen"});},` +
  `w=function(b,t,y){return q("save",${JSON.stringify(DOWNLOAD_FILE)},{contents:[{type:"resource",resource:{` +
  `uri:"file:///"+encodeURIComponent(String(b)),mimeType:y?String(y):"text/plain",text:String(t)}}]});},` +
  `p=function(v){if(v&&typeof v==="object"){v.say=s;v.expand=x;v.save=w;}return v;};p(d);` +
  `try{Object.defineProperty(window,"dc",{configurable:true,enumerable:true,` +
  `get:function(){return d;},set:function(v){d=p(v);}});}catch(e){}})();true;`

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
 * What a page may ask of a chat (`dc.say`, `dc.expand`, `dc.save`) is done only just after the
 * reader touched the page: a page does none of them by itself.
 */
export function VisualPage({
  src,
  title,
  theme,
  onHeight,
  onSay,
  onExpand,
  onSave,
}: VisualPageProps) {
  const web = useRef<WebView>(null)
  const page = useMemo(() => src.split("#")[0], [src])
  // When the reader last touched the page: only a link they tapped is followed, and only what
  // the page says just after a touch is put in the message box.
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
        injectedJavaScriptBeforeContentLoaded={SAY_SCRIPT + HOST_SCRIPT}
        injectedJavaScript={SAY_SCRIPT + HOST_SCRIPT + themeScript(theme)}
        onMessage={(event) => {
          try {
            const data: unknown = JSON.parse(event.nativeEvent.data)
            const tall = readVisualHeight(data)
            if (tall !== undefined) return onHeight(tall)
            // A page does nothing of these by itself: the reader has to have just touched it.
            if (Date.now() - touched.current >= 2_000) return
            const said = readVisualSay(data)
            if (said !== undefined) return onSay(said.text)
            const mode = readVisualMode(data)
            if (mode !== undefined) return mode.mode === "fullscreen" ? onExpand() : undefined
            const saved = readVisualSave(data)
            if (saved !== undefined) onSave(saved)
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
