// The service worker. It shows the notifications the server pushes and opens the page one is
// about. It answers no requests: nothing of the app is kept for use offline.

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
      icon: "/icon-192.png",
      badge: "/badge.png",
      data: { url: typeof message.url === "string" ? message.url : "/" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  // Only ever a page of this app, whatever the message said.
  const path = String(event.notification.data?.url ?? "/")
  const url = new URL(path.startsWith("/") ? path : "/", self.location.origin)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      // Of several, the one being looked at.
      const open = windows.find((client) => client.focused) ?? windows[0]
      if (open === undefined) return self.clients.openWindow(url.href)
      // The app is open somewhere. It is brought forward and asked to go to the page itself,
      // which keeps what it has loaded.
      open.postMessage({ type: "dc-open", path: url.pathname })
      return open.focus()
    })(),
  )
})

// A push service may replace a subscription with a new one. The server is told, so that
// notifications keep arriving without the app having to be opened first.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription
      const options = old?.options ?? { userVisibleOnly: true }
      const fresh =
        event.newSubscription ?? (await self.registration.pushManager.subscribe(options))
      const send = (path, body) =>
        fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      await send("/api/push/register", { subscription: fresh.toJSON() })
      if (old && old.endpoint !== fresh.endpoint) {
        await send("/api/push/unregister", { token: old.endpoint })
      }
    })(),
  )
})
