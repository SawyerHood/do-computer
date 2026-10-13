# Desktop app

`apps/desktop` is an Electron app for macOS, Windows and Linux. It is two things in one program:

- **The app, in a window of its own.** The window shows your deployment the way a browser
  does, so everything the web app can do is there and stays in step with it. On first launch it
  asks for the server's address, unless it was built for one. The window never shows anywhere
  else. Links that lead away open in your browser, and so does a connector's sign-in: you agree
  at the service in the browser you are already signed in to it with, and the app shows the
  connector connected. The browser need not be signed in to Do Computer for that.
- **The daemon for the computer it runs on.** While the app runs, the Doods you connected to
  that computer can work on it. Closing the window leaves the app in the tray with the daemon
  going; **Quit** in the tray menu ends both. It can open when you sign in to the computer.

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

Things to know:

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
