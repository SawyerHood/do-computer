// Applies one deployment's settings to the Cloudflare build before `wrangler deploy` uploads it.
//
// What is particular to a deployment (which database, which address) comes from the environment
// and is written into the build's generated config, which is not in git. So the repository stays
// the same for everyone who hosts it, and CI can deploy from variables alone. With none of them
// set this changes nothing, and `wrangler.jsonc` is used as it is written.
//
//   DC_D1_DATABASE_ID   id of the D1 database, as `wrangler d1 create` printed it
//   DC_ROUTE            address to serve, for example `agent.example.com/*`
//   DC_ROUTE_ZONE       the zone that address is in, if Wrangler should not look it up
//   DC_CUSTOM_DOMAIN    instead of DC_ROUTE: a host for Cloudflare to create the DNS record of
//
// and any of the plain settings in SETTINGS below, which become the Worker's variables. Keys and
// other secrets are not set here: they are Worker secrets (`wrangler secret put`), which a deploy
// leaves alone.
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const SETTINGS = [
  "DC_BASE_URL",
  "DC_SIGNUP",
  "DC_LANDING",
  "DC_ALLOWED_EMAILS",
  "DC_DEFAULT_MODEL",
  "DC_SEARCH_MODEL",
  "DC_JUDGE_MODEL",
  "DC_REVIEW_MODEL",
  "DC_TRANSCRIPTION_MODEL",
  "DC_SANDBOX",
  "DC_SANDBOX_KINDS",
  "DC_SANDBOX_NETWORK",
  "DC_DAYTONA_SNAPSHOT",
  "DC_DAYTONA_IMAGE",
  "DAYTONA_API_URL",
  "DAYTONA_TARGET",
  "DC_CLOUDFLARE_IMAGE",
  "DC_CLOUDFLARE_INSTANCE",
  "DC_EMAIL_FROM",
]

const setting = (name) => (process.env[name] === "" ? undefined : process.env[name])
const path = new URL("../dist/cloudflare/server/wrangler.json", import.meta.url)
if (!existsSync(path)) {
  console.error("There is no Cloudflare build to configure. Run `pnpm build:cloudflare` first.")
  process.exit(1)
}
const config = JSON.parse(readFileSync(path, "utf8"))
const applied = []

const database = setting("DC_D1_DATABASE_ID")
if (database !== undefined) {
  config.d1_databases[0].database_id = database
  applied.push("the database")
}

const route = setting("DC_ROUTE")
const domain = setting("DC_CUSTOM_DOMAIN")
if (route !== undefined && domain !== undefined) {
  console.error("Set DC_ROUTE or DC_CUSTOM_DOMAIN, not both.")
  process.exit(1)
}
if (route !== undefined) {
  const zone = setting("DC_ROUTE_ZONE")
  config.routes = [zone === undefined ? route : { pattern: route, zone_name: zone }]
  applied.push(`the route ${route}`)
}
if (domain !== undefined) {
  config.routes = [{ pattern: domain, custom_domain: true }]
  applied.push(`the domain ${domain}`)
}
// One address, the one sign-in is set up for: not also the workers.dev one.
if (route !== undefined || domain !== undefined) config.workers_dev = false

for (const name of SETTINGS) {
  const value = setting(name)
  if (value === undefined) continue
  config.vars = { ...config.vars, [name]: value }
  applied.push(name)
}

if (applied.length === 0) {
  console.log("No deployment settings in the environment; deploying wrangler.jsonc as written.")
} else {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`Deployment settings applied: ${applied.join(", ")}.`)
}
