# Screen and browser adapters

A paired computer's daemon has separate screen and browser adapters. Pairing, updates,
transport, and shell/jobs stay in the daemon; changing the screen adapter does not replace
those or require a wrapper around the installed bundle.

## Selection is not permission

Screen sharing is **off by default** for a standalone daemon. Finding `DISPLAY`,
`WAYLAND_DISPLAY`, or a compositor socket never enables it. Its owner must opt in:

```sh
node ~/.durable-computer/bin/daemon.cjs --enable-screen --screen-adapter=auto
```

`--no-screen` disables it again. These choices persist in the daemon's existing private
`daemon.json`. The shorthand `--screen=auto|hyprland|wayland|x11|ipc|embedded` (or
`--screen MODE`, or a bare `--screen` for `auto`) is an explicit owner opt-in plus selection;
`--screen=off` disables it, and a later `--enable-screen` turns it back on. Like `--browser`,
a server address or option after `--screen` is never read as its mode. `wayland` currently means the
Hyprland backend, not generic Wayland; `embedded` means IPC. The lower-level
`--screen-adapter=...` selects only and does not grant permission. Read-only mode
continues to override screen and browser permissions. In the desktop app, the app's own
screen setting is an additional permission gate; an explicit daemon opt-out still wins.
This is an owner-consent control, not isolation from a process that already runs as that
same user with unrestricted shell access.

`--screen-adapter` accepts `auto`, `ipc`, `hyprland`, `x11`, or `none`, as either
`--screen-adapter=value` or `--screen-adapter value`. An unavailable explicit selection
reports its failure; it does not silently switch to another desktop.

`auto` chooses:

- The app's IPC adapter when embedded. A missing app parent does not trigger native fallback.
- Hyprland when the explicit or safely discovered environment identifies a Hyprland session.
- X11 when an explicit or safely discovered native X11 session is available.
- No screen otherwise. Generic Wayland/portal support is not implemented; a Wayland session
  does not fall back to its XWayland `DISPLAY`.

The browser registry currently supplies `dev-browser`, the existing CDP-based implementation.
`--browser-adapter=dev-browser` selects it independently. Existing `--browser` and
`--no-browser` settings retain their meaning; `--browser=auto|dev-browser|off` is also supported.
The backend may use an allowed own Chrome or an agent-kept Chromium; it starts on demand,
so a browser probe does not launch or certify an installed browser. No graphical session
is required. There is no arbitrary executable or third-party package loader.

## Diagnose before enabling

```sh
node ~/.durable-computer/bin/daemon.cjs --doctor
node ~/.durable-computer/bin/daemon.cjs --doctor --enable-screen --screen-adapter=hyprland
```

Doctor prints JSON and exits without pairing, connecting to the server, changing configuration,
or injecting input. Native probes check prerequisites and session metadata, not screenshots.
The report separates `enabled` (permission), `available` (adapter support), and `ready` (current
session state), and gives the explicit state `unsupported`, `disabled`, `blocked`, or `ready`.
Unsupported means no usable backend here; disabled means the owner has not allowed it;
blocked means a supported backend cannot currently be used (for example, no display, asleep,
inactive, or locked). An enabled but unready adapter gives doctor a nonzero exit status. The report
contains no pairing token or environment dump.

While the screen is off, the daemon does nothing about it: no `loginctl`, no PATH scans, no
compositor calls, and no startup delay, exactly as before adapters existed. Only an owner who
enabled the screen (or ran `--doctor`) pays for discovery, and even then it runs while the
daemon connects rather than before; the screen is announced once it is ready.

Temporarily locked, inactive, or sleeping sessions remain configured. Native operations
recheck readiness and can work after their owner unlocks/wakes the same session; restarting
the daemon is not required. While the screen is enabled, health checks retry missing-session
discovery and native probes every 30 seconds, with no screenshots, input, or display wake-up. Once bound to a usable
session/output, the adapter does not silently switch to another one. Changes to an explicit
service environment still need a restart. The server's existing screen boolean remains the
sharing/capability gate; additive hello metadata identifies adapters, tools, supported actions,
and the last reported state/reason. Changes are sent over the existing connection. The
Computers settings list shows these diagnostics, as does the agent's `computers` list for
computers it is already allowed to use. Legacy runners are shown as unreported, not unsupported.

## Linux prerequisites

Run as the **non-root desktop user**. Explicit session environment wins. Otherwise discovery
uses only that UID's graphical logind sessions and private, owned sockets under
`XDG_RUNTIME_DIR` (default `/run/user/<uid>`). It rejects multiple graphical sessions,
multiple Wayland sockets, multiple Hyprland instances, symlinked or other-writable runtime
directories, and foreign-owned entries. It does not read process environments or search
`/tmp` or another user's runtime. If discovery is ambiguous, supply the intended
`XDG_SESSION_ID` and display environment yourself. Group-writable entries (umask 0002) are
accepted beneath the private runtime directory; world-writable ones are not. Every capture
and input operation checks the session's owner, type, active state, and `LockedHint`. An
unknown lock state is refused. `LockedHint` is weak: many Wayland lockers never report to
logind and leave it at `no`. On Hyprland the adapter therefore also refuses whenever Hyprland
itself reports a session lock (`hyprctl monitors` lists `LOCK` in `solitaryBlockedBy`), which
covers any ext-session-lock locker. X11 still relies on `LockedHint` alone. This is a readiness
check, not a new OS security boundary; do not run the daemon under another user's identity or
grant it root.

For **Hyprland**, install `hyprctl`, `grim`, and `wtype`, alongside `loginctl`. Supply
`WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, and `HYPRLAND_INSTANCE_SIGNATURE` from that same
graphical login. The backend uses `hyprctl monitors` for geometry and lock state, grim for
capture, and wtype for keyboard input. Pointer input (move, clicks, drag, scroll) speaks the
`zwlr_virtual_pointer_v1` protocol to the compositor directly, so `wlrctl` is not needed:
each action is one Wayland connection, so a drag presses, moves through intermediate points,
and releases on the same virtual device, a double click's two clicks are 60 ms apart, and a
button still held when an action is cancelled or fails is released before disconnecting.
Display wake-up uses the classic `dpms` dispatcher or, on Hyprland with a Lua config, the
`hl.dsp.dpms` one. Command failures are reported, not worked around with privileged input
injection.

The initially focused output is selected and remains pinned by name. Coordinates are mapped
from the agent's resized screenshot into that output's logical coordinates, including its
scale and layout offset. A layout change invalidates pointer coordinates until another
screenshot is taken. Rotated outputs are explicitly unsupported for now.

For **X11**, install `xdotool`, `xset`, and ImageMagick's `import`, alongside `loginctl`.
Supply `DISPLAY` and, where needed, `XAUTHORITY`. Captures and coordinates cover the X11 root
window. Native Wayland sessions with XWayland are rejected by this adapter.

By default neither backend turns DPMS on. `--wake-display` explicitly permits waking an
unlocked sleeping display during a screen action or active viewer capture; `--no-wake-display`
restores the default. This setting persists separately and does not grant screen permission.
Hyprland wakes only its pinned output; X11 wakes its configured display. Probes never wake.
Neither backend dismisses a lock screen, guesses another session, scans other users' sockets,
installs tools, or obtains elevated permissions. Unlock the session yourself. Both support whole-screen screenshot, pointer movement, clicks, drag,
scroll, typing, keys, and bounded waits. `windows`, `open`, and `in_window` are refused;
background-window behavior must never silently become foreground input.

The native adapter is foreground automation: it does not provide the desktop app's overlay
or local Escape-key monitoring. The owner can pause via the existing screen hold controls,
disable sharing, or stop the user service. Do not enable native screen sharing on an
unattended shared desktop without understanding that distinction.

### A systemd user service

A user service does not automatically inherit a graphical terminal's environment. Normally
same-user discovery handles this. If it cannot resolve a unique session, import the relevant
values from the intended graphical terminal into the user manager:

```sh
systemctl --user import-environment DISPLAY XAUTHORITY WAYLAND_DISPLAY \
  HYPRLAND_INSTANCE_SIGNATURE XDG_RUNTIME_DIR XDG_SESSION_ID XDG_SESSION_TYPE
node ~/.durable-computer/bin/daemon.cjs --doctor --enable-screen --screen-adapter=hyprland
node ~/.durable-computer/bin/daemon.cjs --enable-screen --screen-adapter=hyprland --install-service
systemctl --user restart durable-computer-daemon.service
```

Use `x11` instead for an X11 session. Arrange the environment import on subsequent graphical
logins using your desktop's session-start mechanism. Do not hard-code a socket belonging to
another login. Screen adapter settings are persisted, so the installed unit needs no special
embedding variables. Setting `DC_DAEMON_EMBEDDED=1` on a bare service is not the solution.

## Desktop-app IPC

The existing `DC_DAEMON_EMBEDDED` and `DC_DAEMON_SCREEN` flags remain launch hints and the
app's permission gate. As before the handshake existed, a daemon the app starts with the
screen on announces it at once; nothing waits for the app. It then asks for details over the
existing `@dc-call ` JSON-lines transport, on the one transport it keeps for its whole life:

```jsonl
{"id":"c1","op":"hello","protocolVersion":1}
{"id":"c1","value":{"protocolVersion":1,"screen":true,"available":true}}
```

The first line is the contents of an `@dc-call ` request; the second is the app's reply on
stdin. The app runner answers the handshake without invoking its screen driver. An answer
that says sharing is off or unavailable narrows what is announced; malformed answers and
unknown versions are errors. Released apps answer an op they do not know with an ordinary
(not refused) error; any such answer to `hello`, whatever its wording, is taken as an app from
before the handshake, which keeps the screen it was started with. A refused answer is the app
saying no. Silence is reported as a reason, not guessed at. The handshake is repeated with the
30-second health check on the same transport, so a change (a revoked OS permission, say)
reaches the server without the daemon restarting.

IPC deadlines bound the caller's wait; they do not undo an app action already issued.
EOF, input errors, and disposal reject pending calls; late
answers are discarded. Pending calls and buffered input are capped. Native subprocesses
also have cancellation, output limits, and completion deadlines independent of pipe closure.
Native actions are serialized, disposal cancels queued/in-flight work, viewer captures do not
replace the agent's coordinate frame, and captures are not taken when nobody is using the screen.
A watcher's `view(after, waitMs)` returns at once when a newer picture exists (an action's
counts), and otherwise waits, capturing at most every 500 ms however many watch. Adapter
reasons are cut to 300 characters before they reach the server's settings page or an agent.

## Extending adapters

Keep platform effects behind `ScreenDriver` and the existing `ScreenIO`/`BrowserIO` contracts.
Native screen policy (permission, pause/stop, serialization, coordinate frames, image limits,
and lifecycle) belongs in the coordinator, not each platform driver. Add a named built-in
factory and a non-input probe rather than branching throughout the daemon.

The tests use injected command runners and streams, including unavailable/locked sessions,
HiDPI coordinates, stale geometry, missing app parents, deadlines, cancellation, and literal
stdin typing, and a fake Wayland compositor for the virtual-pointer wire protocol. They do not
certify behavior on a real Hyprland or X11 installation; live compositor testing is still
required for a new backend or compositor release.
