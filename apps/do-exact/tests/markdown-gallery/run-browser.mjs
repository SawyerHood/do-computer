// The official drive owns the ports; the browser helper joins only after its host is ready.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const reference = process.argv.includes('--reference');
const dir = reference ? resolve(import.meta.dir, '../..') : import.meta.dir;
const sentinel = reference ? 'tests/markdown-gallery/.exact/reference.done' : '.exact/probe.done';
mkdirSync(resolve(dir, sentinel, '..'), { recursive: true });
rmSync(resolve(dir, sentinel), { force: true });
const env = { ...process.env };
if (reference) {
  const { fixtures } = await import('./fixtures.mjs');
  env.DC_ECHO_REPLIES = JSON.stringify(fixtures);
}
const drive = spawn('./x', ['agent', 'web', `clock +60000 real until ${sentinel}`], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let helper, helperExit = 1;
const output = chunk => {
  process.stdout.write(chunk);
  if (!helper && chunk.toString().includes('served at http://127.0.0.1:8766/')) {
    helper = spawn(process.execPath, [resolve(import.meta.dir, reference ? 'reference.mjs' : 'probe.mjs')], { env, stdio: 'inherit' });
    helper.on('exit', code => { helperExit = code ?? 1; });
  }
};
drive.stdout.on('data', output); drive.stderr.on('data', output);
drive.on('exit', code => { process.exitCode = code || helperExit; });
