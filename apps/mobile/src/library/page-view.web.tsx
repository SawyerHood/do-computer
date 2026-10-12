import { createElement } from "react"

/**
 * An HTML page of the library shown in a frame as the page it is. The
 * frame keeps it apart from the app, as the web app's does. The browser's stand-in for the web
 * view the phones have (see page-view.tsx).
 */
export function PageView({
  uri,
  title,
}: {
  uri: string
  headers?: Record<string, string>
  title: string
}) {
  return createElement("iframe", {
    src: uri,
    title,
    // No `allow-same-origin`: the page must not be the app, though the app serves it.
    sandbox: "allow-scripts allow-popups allow-forms allow-modals",
    style: { flex: 1, width: "100%", height: "100%", border: 0, backgroundColor: "#fff" },
  })
}
