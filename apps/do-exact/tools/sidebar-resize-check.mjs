// A real mouse on the sidebar's edge, while `./x agent web` holds the app and server open:
//   ./x agent web 'clock +60000 real until .exact/resize.done' &  node tools/sidebar-resize-check.mjs http://127.0.0.1:<page port>
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = process.argv[2] ?? 'http://127.0.0.1:8766';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
try {
  const page = await (await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Ada');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(`resize-${Date.now()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct horse');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'New Dood', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  const edge = page.getByRole('separator', { name: 'Resize the sidebar' });
  const width = async () => Number(await edge.getAttribute('aria-valuenow'));
  const drag = async (to) => {
    const box = await edge.boundingBox(); const y = 400, x = box.x + box.width / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(x + (to - x) * i / 12, y); await page.waitForTimeout(20); }
    await page.mouse.up(); await page.waitForTimeout(100);
    return width();
  };
  assert.equal(await width(), 288);
  assert.equal(await drag(900), 448, 'dragged past its widest, it stops there');
  const back = await drag(340);
  assert.ok(Math.abs(back - 340) <= 2, `after an overshoot the next drag follows the pointer (${back})`);
  assert.equal(await drag(150), 208, 'dragged a little past its narrowest, it stops there');
  const out = await drag(400);
  assert.ok(Math.abs(out - 400) <= 2, `and out again (${out})`);
  const chat = await page.getByRole('textbox', { name: 'Message', exact: true }).boundingBox();
  assert.ok(chat.x > out, 'the chat is beside the wider sidebar');
  const shots = process.argv[3] ?? '.exact/shots/sidebar'; mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/wide-400.png` });
  await page.reload(); await edge.waitFor();
  assert.equal(await width(), out, 'kept over a reload');
  // Dragged in past half way to its narrowest, it is a column of faces; pulled out, the list.
  assert.equal(await drag(100), 60, 'shut to its faces');
  assert.equal(await page.getByRole('button', { name: 'New team', exact: true }).count(), 0, 'no words in the rail');
  const face = await page.getByRole('link', { name: /^Talk to / }).first().boundingBox();
  assert.ok(face.x >= 0 && face.x + face.width <= 60, 'a face fits the rail');
  assert.ok((await page.getByRole('textbox', { name: 'Message', exact: true }).boundingBox()).x < 400, 'the chat takes the room');
  await page.screenshot({ path: `${shots}/rail.png` });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: `${shots}/rail-dark.png` }); await page.emulateMedia({ colorScheme: 'light' });
  await page.reload(); await edge.waitFor();
  assert.equal(await width(), 60, 'shut over a reload');
  const opened = await drag(300);
  assert.ok(Math.abs(opened - 300) <= 2, `pulled open again (${opened})`);
  console.log('sidebar resize: ok');
} finally { await browser.close(); }
