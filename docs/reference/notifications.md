# Notifications, and the app on a phone's home screen

The web app tells you when an agent answers in a chat you do not have open, needs your OK, or
reports on a schedule. Turn it on under your name, then **Notifications**, in each browser you
want it in. It uses Web Push, so it works with the app closed, and needs nothing set up: the
server makes its own signing keys the first time and keeps them with its data. The site has to
be served over HTTPS (or be `localhost`).

The site is also an installable app. On Android, Chrome offers **Install app** or **Add to Home
screen**. On an iPhone or iPad (iOS 16.4 or later), use Share, then **Add to Home Screen**; iOS
only delivers notifications to a site that was added there, and they are turned on from inside
the installed app. Nothing is kept for offline use.
