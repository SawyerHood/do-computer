// Test the production module and Contract component, not a gallery implementation.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
const app = new URL('../../', import.meta.url);
const result = Bun.spawnSync([process.execPath, new URL('modules/web/build.mjs', app).pathname, '--check'], { stdout: 'inherit', stderr: 'inherit' });
if (result.exitCode) process.exit(result.exitCode);
rmSync(new URL('./modules/', import.meta.url), { recursive: true, force: true });
cpSync(new URL('modules/web/', app), new URL('./modules/web/', import.meta.url), { recursive: true });
mkdirSync(new URL('./views/', import.meta.url), { recursive: true });
cpSync(new URL('views/markdown.contract', app), new URL('./views/markdown.contract', import.meta.url));
