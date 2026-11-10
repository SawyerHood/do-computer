import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
// Run from apps/do-exact; the page is at this checkout's slot (.slot, as ./x reads it).
const slot = Number(process.env.DCX_SLOT ?? (() => { try { return readFileSync('.slot', 'utf8').trim(); } catch { return '0'; } })());
rmSync('.exact/call-browser.done', { force: true });
const env = { ...process.env, DC_CALLS: 'on', DC_CALLS_SCRIPT: '1' };
const drive = spawn('./x', ['agent', 'web', '--storage', 'call-browser', 'clock +240000 real until .exact/call-browser.done'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let helper, result = 1;
function output(bytes) {
  process.stdout.write(bytes);
  if (!helper && bytes.toString().includes(`served at http://127.0.0.1:${8766 + slot}/`)) {
    helper = spawn(process.execPath, ['tools/call-browser-check.mjs'], { env, stdio: 'inherit' });
    helper.on('exit', code => { result = code ?? 1; });
  }
}
drive.stdout.on('data', output); drive.stderr.on('data', output);
drive.on('exit', code => { process.exitCode = code || result; });
