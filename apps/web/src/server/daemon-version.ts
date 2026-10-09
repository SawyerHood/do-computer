/**
 * The version of the daemon this deployment serves, for telling a daemon that is another to
 * catch up. Loaded on demand: it sits beside the daemon itself, which is a large string.
 */
export async function servedDaemon(): Promise<string> {
  return (await import("./daemon-bundle.generated.ts")).DAEMON_VERSION
}
