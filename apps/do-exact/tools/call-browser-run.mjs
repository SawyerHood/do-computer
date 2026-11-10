import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
rmSync('.exact/call-browser.done', { force: true });
const env = { ...process.env, DC_CALLS: 'on', DC_CALLS_SCRIPT: '1' };
const drive = spawn('./x', ['agent', 'web', 'clock +240000 real until .exact/call-browser.done'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let helper, result = 1;
function output(bytes) {
  process.stdout.write(bytes);
  if (!helper && bytes.toString().includes('served at http://127.0.0.1:8771/')) {
    helper = spawn(process.execPath, ['tools/call-browser-check.mjs'], { env, stdio: 'inherit' });
    helper.on('exit', code => { result = code ?? 1; });
  }
}
drive.stdout.on('data', output); drive.stderr.on('data', output);
drive.on('exit', code => { process.exitCode = code || result; });
