import { getPlatform } from "#platform"

/**
 * The installer a user pipes to `sh` on a computer they want to pair. It fetches the daemon from
 * this same deployment and starts it, which begins pairing.
 */
export function installScript(request: Request): Response {
  const origin = getPlatform().config.baseUrl ?? new URL(request.url).origin
  const script = `#!/bin/sh
# Pairs this computer with your Dood on ${origin}.
set -eu
command -v node >/dev/null 2>&1 || { echo "Node.js 20 or newer is required: https://nodejs.org" >&2; exit 1; }
DIR="\${DC_DAEMON_DIR:-$HOME/.durable-computer}"
mkdir -p "$DIR/bin"
curl -fsSL "${origin}/daemon.js" -o "$DIR/bin/daemon.cjs"
chmod 755 "$DIR/bin/daemon.cjs"
echo "Installed the daemon to $DIR/bin/daemon.cjs"
echo "To keep it running in the background later: node $DIR/bin/daemon.cjs ${origin} --install-service"
exec node "$DIR/bin/daemon.cjs" "${origin}" "$@"
`
  return new Response(script, { headers: { "content-type": "text/x-shellscript; charset=utf-8" } })
}

export async function daemonBundle(): Promise<Response> {
  // Loaded on demand: it is a large string that most requests never need.
  const { DAEMON_BUNDLE } = await import("./daemon-bundle.generated.ts")
  return new Response(DAEMON_BUNDLE, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
  })
}

/**
 * Which daemon this deployment serves. A daemon asks when it connects and now and then after,
 * and fetches the one at `/daemon.js` when it is not the one it is running.
 */
export async function daemonVersion(): Promise<Response> {
  const { DAEMON_VERSION, DAEMON_SHA256 } = await import("./daemon-bundle.generated.ts")
  return Response.json(
    { version: DAEMON_VERSION, sha256: DAEMON_SHA256 },
    { headers: { "cache-control": "no-cache" } },
  )
}
