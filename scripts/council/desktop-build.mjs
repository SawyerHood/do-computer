import { build } from '../../apps/desktop/node_modules/esbuild/lib/main.js'
import { mkdirSync, cpSync } from 'node:fs'
const out='.council/desktop'
mkdirSync(out,{recursive:true})
await build({entryPoints:['apps/desktop/src/pages/computer.ts','apps/desktop/src/pages/devices.ts'],bundle:true,outdir:out,platform:'browser',format:'iife',target:'chrome130'})
for(const f of ['computer.html','devices.html','pages.css']) cpSync(`apps/desktop/src/pages/${f}`,`${out}/${f}`)
