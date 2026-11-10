// Run while tools/composer-shots.sh holds the real server/page. Installs only an
// obviously fake key in this ephemeral account; never sends a model request.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium, request, expect } = require('@playwright/test');
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const app = process.argv[2] || 'http://127.0.0.1:8768';
const server = process.argv[3] || 'http://127.0.0.1:3913';
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const api = await request.newContext({ baseURL: server });
const out = resolve('.exact/shots/composer/model'); await mkdir(out, { recursive: true });
const email = `model-${Date.now()}@example.com`, password = 'correct horse';
async function json(path, data, method = 'POST') { const r = await api.fetch(path, { method, ...(data === undefined ? {} : { data }) }); if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`); return r.json(); }
try {
  await page.goto(app); await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Ada');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'New Dood', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  await json('/api/auth/sign-in/email', { email, password });
  const { workspaces } = await json('/api/workspaces', undefined, 'GET'); const wid = workspaces[0].id;
  const base = `/api/workspaces/${wid}`;
  const started = await json(`${base}/model-logins`, { providerId: 'anthropic', type: 'api_key' });
  const login = started.login;
  await json(`${base}/model-logins/${login.id}/answer`, { promptId: login.prompt.id, value: 'not-a-real-key-exact-ui-test' });
  // Reload loads the newly available model catalog; no text has been sent.
  await page.reload();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A model picker draft');
  await page.getByRole('button', { name: 'Model and thinking', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search models', exact: true }).fill('sonnet');
  await page.screenshot({ path: `${out}/picker.png` });
  const search = page.getByRole('textbox', { name: 'Search models', exact: true });
  await search.press('ArrowDown'); await search.press('ArrowUp'); await search.press('Enter');
  await page.getByRole('button', { name: 'High', exact: true }).waitFor();
  await expect(page.getByRole('button', { name: /Claude Sonnet 5\.5/ }).first()).toBeEnabled();
  await page.getByRole('button', { name: /Claude Sonnet 5\.5/ }).first().click();

  const high = page.getByRole('button', { name: 'High', exact: true });
  await expect(high).toBeEnabled(); await high.click(); await expect(high).toHaveAttribute('aria-pressed', 'true'); await expect(high).toBeEnabled();
  await page.screenshot({ path: `${out}/selected.png` });
  const id = new URL(page.url()).pathname.split('/')[2];
  const { agent } = await json(`/api/agents/${id}`, undefined, 'GET');
  if (agent.model !== 'anthropic/claude-sonnet-5-5' || agent.thinking !== 'high') throw new Error(`Settings not saved: ${agent.model} / ${agent.thinking}`);
  await json(`${base}/model-providers/anthropic`, undefined, 'DELETE');
  console.log('Real-server model search/selection and thinking selection persisted. Only a fake ephemeral key was used; no provider request.');
} finally { await api.dispose(); await browser.close(); }
