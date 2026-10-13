// Writes the app's colors into its stylesheet from the one table that says them
// (packages/protocol/src/theme.ts), which is also what every page of the library is given.
// Run after changing the table: `pnpm --filter @do-computer/web theme`.
import { writeFileSync } from "node:fs"
import { appThemeCss } from "../../../packages/protocol/src/theme.ts"

writeFileSync(new URL("../src/theme-tokens.css", import.meta.url), appThemeCss())
