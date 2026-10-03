import { createDurableActorClass, r2Blobs } from "../src/cloudflare/index.ts"
import { CONFORMANCE_AUTO_RESPONSE, conformanceActor } from "../src/testing.ts"

export type Env = { ACTOR: DurableObjectNamespace; BLOBS: R2Bucket; DB: D1Database }

export const ConformanceActor = createDurableActorClass<Env>({
  create: conformanceActor,
  blobs: (env, name) => r2Blobs(env.BLOBS, `${encodeURIComponent(name)}/`),
  socketAutoResponse: CONFORMANCE_AUTO_RESPONSE,
})

export default {
  fetch: () => new Response("conformance worker"),
} satisfies ExportedHandler<Env>
