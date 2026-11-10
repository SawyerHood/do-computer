// The deployment the app talks to, for the tests and the dev loop: Do Computer's own server
// (../web, built with `pnpm --filter @do-computer/web build:node`) on an empty data folder that
// goes when it stops. With no model key it answers with its built-in echo model.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { API } from './app.ts';

const web = resolve(import.meta.dir, '../web');
if (!existsSync(join(web, 'dist/node/server/server.node.js'))) {
  console.error('server.ts: ../web is not built. Run: pnpm --filter @do-computer/web build:node');
  process.exit(1);
}
const data = mkdtempSync(join(tmpdir(), 'do-exact-'));
// Where the web build of this app is served from: `EXACT_PORT`, which the scripts in package.json set.
const client = `http://127.0.0.1:${process.env.EXACT_PORT ?? '8766'}`;
const child = spawn(process.env.NODE ?? 'node', ['server.node.mjs'], {
  cwd: web,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: new URL(API).port,
    HOST: '127.0.0.1',
    DC_DATA_DIR: data,
    DC_SIGNUP: 'open',
    DC_CLIENT_ORIGINS: process.env.DC_CLIENT_ORIGINS ?? client,
    OPENROUTER_API_KEY: process.env.DO_EXACT_MODEL_KEY ?? '',
    // Saved logins and cards for everyone, so that the settings' Passwords can be tested.
    DC_SECRETS: process.env.DC_SECRETS ?? 'on',
    DC_SECRET_KINDS: process.env.DC_SECRET_KINDS ?? 'passwords,cards',
  },
});
const stop = () => {
  child.kill();
  rmSync(data, { recursive: true, force: true });
};
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
child.on('exit', (code) => { rmSync(data, { recursive: true, force: true }); process.exit(code ?? 0); });
