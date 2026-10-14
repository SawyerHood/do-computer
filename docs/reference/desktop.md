# Desktop app

`apps/desktop` is an Electron app for macOS, Windows and Linux. It is two things in one program,
and can be a third:

- **The app, in a window of its own.** The window shows your deployment the way a browser
  does, so everything the web app can do is there and stays in step with it. On first launch it
  asks where Do Computer runs, unless it was built for a deployment. The window never shows
  anywhere else. Links that lead away open in your browser, and so does a connector's sign-in:
  you agree at the service in the browser you are already signed in to it with, and the app
  shows the connector connected. The browser need not be signed in to Do Computer for that.
- **Do Computer itself, if you have no server.** Choose **On this computer** and the app runs
  the server too, for you alone: see [Do Computer on this computer](#do-computer-on-this-computer).
- **The daemon for the computer it runs on.** While the app runs, the Doods you connected to
  that computer can work on it. Closing the window leaves the app in the tray with the daemon
  going; **Quit** in the tray menu ends both. It can open when you sign in to the computer.
  A message you write in the app tells a Dood that has the computer that it was written
  there, so it knows which of your computers you are at.

Pairing happens inside the app. Say that your Doods may use the computer, on the first screen
or later under **This Computer…** in the tray menu, and once you are signed in the window shows
the page where you confirm it and choose the Doods. Nothing is shared before that. The same
window shows whether the computer is connected and what Doods did on it, and switches sharing
off and on again without pairing anew. To take the computer away for good, remove it under
Computers, as with any other.

```sh
pnpm desktop                                        # build it and run it from source
pnpm --filter @do-computer/desktop package     # pack it for this system, into apps/desktop/release
DC_DESKTOP_SERVER=https://agents.example.com pnpm --filter @do-computer/desktop package
                                                    # the same, opening that deployment without asking
```

The `Desktop` workflow builds, tests and packs the app on all three systems and keeps what it
packed with the run: a `.dmg`, an installer for Windows and an AppImage. Where the
repository variable `DC_BASE_URL` is set, those open that deployment.

Releases are made from tags. Pushing one named `desktop-v` and a version, `desktop-v0.2.0`,
packs the app as that version and, once it has passed on all three systems, publishes a
release with the three files, and with what the apps already installed read to update
themselves (a `.zip` of the Mac's app, and a `latest*.yml` for each system):

```sh
git tag desktop-v0.2.0 && git push origin desktop-v0.2.0
```

## Do Computer on this computer

The app brings the whole server with it, and runs it when you choose **On this computer** on
the first screen or later under **File → Change Server…**. There is nothing to host and no
account to make:

- **It asks only what you are called.** The first run is the same scene as anywhere else,
  without the email and the password. The app signs its own window in as you, and does so again
  whenever it needs to.
- **Everything is kept in the app's own folder**, under `server` there: the accounts table with
  you in it, your Doods and their files. It listens on this computer alone
  (`http://127.0.0.1:4310`, or the next free port the first time), and nothing else can reach
  it unless you ask for that below.
- **Your Doods work while the app is open.** Closing the window leaves the app in the tray
  with the server and the daemon going. Quit, or a computer that is asleep, stops them all:
  schedules do not fire until it is back, and work that was cut off picks up again then.
- **A new Dood is given this computer**, once you have said that your Doods may work here, as
  well as the built-in shell every Dood has. Elsewhere a computer goes to the Doods you choose.
- **Models are yours to sign in to.** There is no included model: sign in with ChatGPT or
  Claude, or add a key, in the first run or later under Models. Until then a Dood repeats what
  you say. An `OPENROUTER_API_KEY` in the environment the app is started from is used.
- **It is the server the app was built with.** It gets newer when the app does, which a
  release does by itself. The app does not restart itself to update while a Dood is in the
  middle of something.
- **Choosing a server later keeps what is here.** The app stops its own server and shows the
  other one; choose **On this computer** again and everything is as you left it. Nothing moves
  between the two.

What needs a server on the internet stays off: Slack, public links to shared pages, signing
in with Google or GitHub, and email invitations.

### From your other devices, with Tailscale

If [Tailscale](https://tailscale.com) is installed on the computer and connected, the app can
serve Do Computer to the other devices on your Tailscale network: your phone's browser, your
other computers, and nobody else. Tick **Reach it from my other devices with Tailscale** on the
first screen, or switch it on under **File → Other Devices…** (also in the tray menu).

- **What it does** is ask the Tailscale you have to serve the server's port, with a
  certificate, at `https://<this computer's name on your network>:4310`:
  `tailscale serve --bg --https=4310 http://127.0.0.1:4310`. Switching it off removes that one
  entry. Whatever else Tailscale serves from the computer is left as it is.
- **A device is signed in with a code.** You have no password, so **Other Devices** shows a
  code to scan with the device's camera, and a link to copy for a device without one. It works
  once, for ten minutes, and gives that device a session of its own.
- **It answers only while the app is running** and the computer is awake.
- **The address has a certificate**, which is what adding it to a phone's home screen and its
  notifications need. See [Notifications](notifications.md).
- **Where it cannot be switched on, the window says why.** On Linux, Tailscale lets only an
  administrator serve until you have run `sudo tailscale set --operator=$USER` once. A network
  with HTTPS certificates off has to have them turned on in Tailscale's admin console, under
  DNS.
- **The app uses the Tailscale that is installed** and brings none of its own. Tailscale
  Funnel, which would put it on the open internet, is not used.
- **The native phone app cannot sign in to it yet.** It signs in with an email and a password,
  which you do not have here. Use the phone's browser.

Someone hosting the server themselves can do the same by hand: `DC_BASE_URL` is the address
through Tailscale, and `DC_ALSO_AT` the one on the machine itself. See
[Configuration](configuration.md).

## Things to know

- **The Mac's app is signed where the repository has a certificate.** With the secrets
  `CSC_LINK` (a Developer ID Application certificate, as a `.p12` in base64) and
  `CSC_KEY_PASSWORD`, the `Desktop` workflow signs it, and with `APPLE_API_KEY_P8` (an App
  Store Connect API key), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` Apple checks a release, so
  that it opens from a double click. A signed app also keeps what its owner allowed it under
  Accessibility and Screen Recording from one version to the next. One signed by nobody is
  another app to macOS with every build: it has to be allowed both again (take the old entry
  out of each list first), and macOS will not open a downloaded copy from a double click:
  allow it under System Settings, Privacy & Security, or take the download's mark off it with
  `xattr -dr com.apple.quarantine` and the path of the app.
- **Nobody has signed the Windows one.** Windows shows "Windows protected your PC": choose
  More info, then Run anyway. That has not been tried on a real desktop yet.
- **A release keeps itself up to date.** It looks at the repository's newest release when it
  starts and every four hours, fetches a newer app, and becomes it: when it is quit, when
  **Restart to Update** is chosen in the tray menu or under **This Computer…**, or by itself
  once no window of it is showing and its daemon has been silent for five minutes. Restarted
  that way it comes back without a window. The window's pages are the server's and the daemon
  replaces itself from the server, as before; this is for the app around them. A copy that is
  not a release (packed by hand, or by a run of the workflow that was not for a tag) stays as
  it is, and This Computer says so. Things that follow from how each system does it:
  - **macOS** takes a newer app only from whoever signed the one it has, so a fork with no
    certificate has to be installed again by hand.
  - **Windows** runs the newer installer without showing it. Nobody has signed it: what says
    that it is the right file is that it came from the release, over HTTPS, with the checksum
    the release names.
  - **Linux** updates the AppImage, which is one file: a newer one is put where it was, named
    for its version, and what opens the app at sign-in is pointed at it. A launcher you made
    yourself is not. Run unpacked (`--appimage-extract`), the app cannot replace itself.
- **A fork's releases update from the fork.** The address is the repository the workflow ran
  in, and is put in the app as it is packed, not in a tracked file.
- **The server has to be at least as new as the app.** The daemon takes whichever version its
  server serves, and one from before the desktop app does not know how to be part of it.
- **It is a computer of its own.** The app keeps its daemon's credentials in its own folder, so
  a computer that already runs the daemon from `install.sh` is paired a second time, under a
  second name. Run one or the other.
- **On Windows** commands run in the bash that comes with [Git for
  Windows](https://gitforwindows.org) where that is installed, and in PowerShell where it is
  not. Doods write their commands for bash, so install it. Paths are shown to Doods the way
  Git Bash writes them: `/c/Users/ada` for `C:\Users\ada`. Under PowerShell, a command left
  running in the background ends when the daemon restarts, as it does to update itself.
- **On Linux** a desktop without a tray (GNOME without the AppIndicator extension) has no icon
  to bring the window back with. Starting the app again does it.
