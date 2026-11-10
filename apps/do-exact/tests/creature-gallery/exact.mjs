// This isolated app exercises native views without adding a route to Do Computer.
import { resolve } from 'node:path';
const exact2 = process.env.EXACT2 || resolve(process.env.HOME, '.do-code/exact/exact');
const { run } = await import(resolve(exact2, 'scripts/app-cli.mjs'));
process.exit(await run({ dir: import.meta.dir, name: 'creature-gallery', exact2, args: process.argv.slice(2) }));
