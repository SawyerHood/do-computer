// Browser integration checks while ./x agent holds the app and real server open.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = process.argv[2] ?? 'http://127.0.0.1:8768';
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
const out = '.exact/shots/composer/native'; mkdirSync(out, { recursive: true });
try {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(); await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Ada');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(`composer-native-${Date.now()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct horse');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'New Dood', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true }); await composer.waitFor();
  await composer.fill('A draft kept while dictating');
  await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await page.getByText('Listening', { exact: true }).waitFor();
  await page.waitForTimeout(700);
  const hasWaveform = await page.evaluate(() => [...document.querySelectorAll('*')].some(element => {
    const canvas = element.shadowRoot?.querySelector('.mic')?.parentNode.querySelector('canvas');
    if (!canvas || canvas.hidden || canvas.width < 100) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, i) => i % 4 === 3 && value > 0);
  }));
  assert.ok(hasWaveform, 'The recording waveform drew visible pixels.');
  await page.screenshot({ path: `${out}/recording.png` });
  await page.getByRole('button', { name: 'Cancel dictating', exact: true }).click();
  await page.getByRole('button', { name: 'Dictate', exact: true }).waitFor();
  assert.equal(await composer.inputValue(), 'A draft kept while dictating');
  await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await page.getByText('Listening', { exact: true }).waitFor();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Stop dictating', exact: true }).click();
  await page.getByText('Dictation needs a model key, and this deployment has none configured.', { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Dictate', exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(await composer.inputValue(), 'A draft kept while dictating');
  await page.screenshot({ path: `${out}/transcribe-refused.png` });
  console.log('Real microphone recording (fake browser device), cancel, draft retention, stop and transcription refusal checked.');
} finally { await browser.close(); }
