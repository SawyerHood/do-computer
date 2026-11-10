// The service worker of the Exact app's notifications, as the React app's apps/web/public/sw.js:
// it shows what the server pushes and opens the page one is about. It answers no requests.
// do-push (push.js) registers it under /modules/, which is all push needs.
//
// Unlike the React app's, it does not tell the server of a subscription its push service
// replaced (`pushsubscriptionchange`): the server is on another origin and takes the session as
// a bearer, which a worker does not have. The Notifications settings register the new one the
// next time they are opened (GAPS.md, "Settings").

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
  let message = {}
  try {
    message = event.data?.json() ?? {}
  } catch {
    // Not what the server sends. Something is shown all the same: a browser that is woken for
    // a push and shows nothing stops delivering them.
  }
  const title = typeof message.title === "string" ? message.title : "Do Computer"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof message.body === "string" ? message.body : "",
      icon: "/assets/icon-192.png",
      data: { url: typeof message.url === "string" ? message.url : "/" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  // Only ever a page of this app, whatever the message said. Its addresses are the React app's.
  const path = String(event.notification.data?.url ?? "/")
  const url = new URL(path.startsWith("/") ? path : "/", self.location.origin)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      // Of several, the one being looked at. The app is open somewhere: it is brought forward and
      // asked to go to the page itself (push.js `listen`), since this worker does not control it.
      const open = windows.find((client) => client.focused) ?? windows[0]
      if (open === undefined) return self.clients.openWindow(url.href)
      open.postMessage({ type: "dc-open", path: url.pathname })
      return open.focus()
    })(),
  )
})
