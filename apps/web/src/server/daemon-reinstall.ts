const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

/**
 * A command that replaces the daemon on a computer with the one this deployment serves, for a
 * daemon to run on itself: one from before daemons kept themselves up to date, which will run
 * what it is told and nothing more.
 *
 * It finds the daemon that is running it, which is its parent, puts the new file in that one's
 * place once it has seen that it starts and is the right version, and starts it. The new
 * daemon connecting is what ends the old one: a computer has one connection, and the older
 * gives way. Under systemd or launchd the service then starts again, from the new file.
 */
export function reinstallCommand(origin: string, version: string): string {
  return `set -e
DIR="\${DC_DAEMON_DIR:-$HOME/.durable-computer}"
ARGS=$(ps -o args= -p "$PPID" 2>/dev/null || true)
NODE=$(printf '%s\\n' "$ARGS" | awk '{print $1}')
SCRIPT=$(printf '%s\\n' "$ARGS" | awk '{print $2}')
command -v "$NODE" >/dev/null 2>&1 || NODE=node
[ -f "$SCRIPT" ] || SCRIPT="$DIR/bin/daemon.cjs"
[ -f "$SCRIPT" ] || { echo "The daemon could not be found on this computer." >&2; exit 1; }
curl -fsSL ${quote(`${origin}/daemon.js`)} -o "$SCRIPT.new"
SAYS=$("$NODE" "$SCRIPT.new" --version 2>/dev/null || true)
if [ "$SAYS" != ${quote(version)} ]; then
  rm -f "$SCRIPT.new"
  echo "What was downloaded is not the daemon the server serves." >&2
  exit 1
fi
cp "$SCRIPT" "$SCRIPT.previous"
chmod 755 "$SCRIPT.new"
mv "$SCRIPT.new" "$SCRIPT"
mkdir -p "$DIR"
# After this command has answered, so that the answer is not lost with the daemon it ends.
nohup sh -c 'sleep 1; exec "$0" "$1"' "$NODE" "$SCRIPT" >> "$DIR/daemon.log" 2>&1 < /dev/null &
echo "Installed daemon "${quote(version)}"."
`
}
