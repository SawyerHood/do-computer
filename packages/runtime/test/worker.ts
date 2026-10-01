import { createDurableActorClass, r2Blobs } from "../src/cloudflare/index.ts"
import { conformanceActor } from "../src/testing.ts"

export type Env = { ACTOR: DurableObjectNamespace; BLOBS: R2Bucket; DB: D1Database }

export const ConformanceActor = createDurableActorClass<Env>({
  create: conformanceActor,
  blobs: (env, name) => r2Blobs(env.BLOBS, `${encodeURIComponent(name)}/`),
})

export default {
  fetch: () => new Response("conformance worker"),
} satisfies ExportedHandler<Env>
