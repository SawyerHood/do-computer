// Run while ./x agent holds this checkout's server open; this starts no server.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = process.argv[2] ?? 'http://127.0.0.1:3913';
const out = resolve('.exact/shots/composer/react'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
try {
  const setup = await browser.newContext({ baseURL: origin });
  await setup.request.post('/api/auth/sign-up/email', { data: { name: 'Ada', email: `composer-react-${Date.now()}@example.com`, password: 'correct horse' } });
  const made = await (await setup.request.post('/api/agents')).json(); const id = made.agent.id;
  await setup.request.patch(`/api/agents/${id}`, { data: { name: 'New Dood', hatched: true } });
  const chat = await (await setup.request.post(`/api/agents/${id}/chats/main`)).json();
  const state = await setup.storageState();
  for (const [name, width, height] of [['wide',1280,800],['phone',390,844]]) {
    for (const scheme of ['light','dark']) {
      const context = await browser.newContext({ baseURL: origin, viewport: { width, height }, colorScheme: scheme, storageState: state });
      const page = await context.newPage(); await page.goto(`/a/${id}/c/${chat.id}`);
      await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
      await page.screenshot({ path: `${out}/${name}-rest-${scheme}.png` });
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Please read the attached note and help me plan the next step.');
      await page.screenshot({ path: `${out}/${name}-draft-${scheme}.png` });
      await page.locator('input[type=file]').setInputFiles('tests/composer/picture.png');
      await page.getByRole('button', { name: /^Remove picture/ }).waitFor();
      await page.screenshot({ path: `${out}/${name}-picture-${scheme}.png` });
      await context.close();
    }
  }
} finally { await browser.close(); }
console.log(out);
