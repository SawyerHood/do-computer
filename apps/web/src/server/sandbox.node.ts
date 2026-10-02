import { modalSandbox } from "@durable-computer/sandbox/modal"
import { ConfigError } from "./platform.ts"
import type { RuntimeProviders } from "./sandbox.ts"

export const nodeProviders: RuntimeProviders = {
  modal: (config) => {
    const { tokenId, tokenSecret, app, image, environment } = config.modal
    if (tokenId === undefined || tokenSecret === undefined) {
      throw new ConfigError(
        "DC_SANDBOX is modal, which needs MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.",
      )
    }
    return (host) => modalSandbox({ id: host.name, tokenId, tokenSecret, app, image, environment })
  },
}
