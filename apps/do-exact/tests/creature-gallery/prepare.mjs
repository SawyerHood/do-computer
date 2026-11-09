// Exact serves only files inside the page module. Mirror the real module, never a test copy.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
const from = new URL('../../modules/web/', import.meta.url);
const to = new URL('./modules/web/', import.meta.url);
rmSync(new URL('./modules/', import.meta.url), { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const file of readdirSync(from)) if (file.endsWith('.js') && file !== 'engine-source.js') cpSync(new URL(file, from), new URL(file, to));
