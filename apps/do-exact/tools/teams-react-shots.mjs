// The React reference for the teams port, with an isolated server and accounts.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const web = resolve(import.meta.dirname, '../../web');
const { chromium } = createRequire(join(web, 'package.json'))('@playwright/test');
const out = resolve(import.meta.dirname, '../.exact/shots/teams/react');
mkdirSync(out, { recursive: true });
const port = 3997, origin = `http://127.0.0.1:${port}`;
const data = mkdtempSync(join(tmpdir(), 'teams-react-'));
const server = spawn(process.execPath, ['server.node.mjs'], { cwd: web, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PORT: `${port}`, HOST: '127.0.0.1', DC_BASE_URL: origin, DC_DATA_DIR: data, DC_SIGNUP: 'open', OPENROUTER_API_KEY: '', DC_CHROME_PATH: 'none' } });
const stop = () => { server.kill(); rmSync(data, { recursive: true, force: true }); };
process.on('exit', stop);
let browser;
try {
  for (let n = 0; n < 300; n++) { if (await fetch(`${origin}/api/health`).then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ executablePath: process.env.CHROME });
  const setup = await browser.newContext({ baseURL: origin });
  const api = setup.request;
  await api.post('/api/auth/sign-up/email', { data: { name: 'Ada', email: 'teams-shots@example.com', password: 'correct horse' } });
  // React's first-run requires a personal Dood before showing the signed-in shell.
  const { agent } = await (await api.post('/api/agents')).json();
  await api.patch(`/api/agents/${agent.id}`, { data: { name: 'Pico', hatched: true } });
  const { workspace } = await (await api.post('/api/workspaces', { data: { name: 'Studio', color: 'plum' } })).json();
  const invited = await (await api.post(`/api/workspaces/${workspace.id}/invitations`, { data: { who: ['grace@example.com'], note: 'Come make things' } })).json();
  const state = await setup.storageState();
  for (const [label, width, height] of [['wide', 1280, 800], ['phone', 390, 844]]) for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ baseURL: origin, viewport: { width, height }, colorScheme: scheme, storageState: state });
    await context.addInitScript(() => { localStorage.setItem('dc-chat-list', 'open'); });
    const page = await context.newPage();
    const shot = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: join(out, `${label}-${name}-${scheme}.png`) }); };
    await page.goto(`/w/${workspace.id}`); await shot('workspace');
    await page.goto(`/w/${workspace.id}?settings=workspace.${workspace.id}.people`); await shot('people');
    await page.getByRole('button', { name: 'Invite people', exact: true }).last().click(); await shot('invite');
    await page.keyboard.press('Escape');
    await page.goto(`/w/${workspace.id}`);
    if (label === 'phone') await page.getByRole('button', { name: /^Show your Doods/ }).click().catch(() => {});
    await page.getByRole('button', { name: 'New team', exact: true }).click();
    await page.getByRole('textbox', { name: 'Team name' }).fill('Studio');
    await page.getByRole('button', { name: 'Plum', exact: true }).click(); await shot('create');
    await context.close();
    const guest = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
    const preview = await guest.newPage(); await preview.goto(invited.invitations[0].link); await preview.waitForTimeout(900);
    await preview.screenshot({ path: join(out, `${label}-preview-${scheme}.png`) }); await guest.close();
  }
} finally { await browser?.close(); stop(); }
