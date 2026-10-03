import { createClient } from "@durable-computer/client"

/** Same-origin API client; the session cookie rides along. */
export const client = createClient({ baseUrl: "" })
