/** What a run of the daemon was asked for on its command line. */
export type Arguments = {
  /** The deployment to pair with. Only needed the first time; after that it is remembered. */
  server: string | undefined
  /** What the agent should call this computer. */
  name: string | undefined
  readOnly: boolean
  installService: boolean
  unpair: boolean
  version: boolean
  help: boolean
}

/**
 * Reads the command line. The server is the first argument that is an address, wherever it is
 * put, except the word after `--name`: someone could name their computer like one.
 */
export function parseArguments(args: readonly string[]): Arguments {
  const nameAt = args.indexOf("--name")
  const named = nameAt === -1 ? undefined : nameAt + 1
  const server = args.find((arg, index) => /^https?:\/\//.test(arg) && index !== named)
  return {
    server: server?.replace(/\/+$/, ""),
    name: named === undefined ? undefined : args[named],
    readOnly: args.includes("--read-only"),
    installService: args.includes("--install-service"),
    unpair: args.includes("--unpair"),
    version: args.includes("--version"),
    help: args.includes("--help") || args.includes("-h"),
  }
}
