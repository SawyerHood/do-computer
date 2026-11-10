// Run while the root app's ./x agent holds its server open, never start another server here.
import { chromium } from '../../../web/node_modules/@playwright/test/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const output = resolve(import.meta.dir, '.exact');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 480 }, reducedMotion: 'reduce' });
  const response = await page.request.post('http://127.0.0.1:3911/api/doods', { data: { name: 'Pip', color: 'moss', seed: 'pip0' } });
  if (!response.ok()) throw new Error(`Create reference Dood: ${response.status()}`);
  const { dood } = await response.json();
  await page.goto(`http://127.0.0.1:3911/dood/${dood.id}`);
  await page.locator('[data-egg]:not(.invisible)').waitFor();
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-egg] canvas');
    return c?.width > 20 && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-dood-card] > canvas')).opacity === '1');
  await page.screenshot({ path: resolve(output, 'react-pip0-moss.png') });
  // Keep the whole React frame and its actual creature canvas for comparison.
  await page.locator('[data-egg]').screenshot({ path: resolve(output, 'react-pip0-creature.png') });
  console.log('React reference: pip0, moss; screenshots in tests/creature-gallery/.exact/.');
} finally {
  await browser.close();
  writeFileSync(resolve(output, 'reference.done'), 'done');
}
