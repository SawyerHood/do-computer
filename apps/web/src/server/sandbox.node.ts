import { lookup } from "node:dns/promises"
import { modalSandbox } from "@durable-computer/sandbox/modal"
import { ConfigError } from "./platform.ts"
import type { RuntimeProviders } from "./sandbox.ts"

export const nodeProviders: RuntimeProviders = {
  resolveHost: async (hostname) =>
    (await lookup(hostname, { all: true })).map((entry) => entry.address),
  modal: (config) => {
    const { tokenId, tokenSecret, app, image, environment } = config.modal
    if (tokenId === undefined || tokenSecret === undefined) {
      throw new ConfigError("Modal needs MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.")
    }
    return (key) =>
      modalSandbox({
        id: key,
        tokenId,
        tokenSecret,
        app,
        image,
        environment,
        network: config.sandboxNetwork,
      })
  },
}
