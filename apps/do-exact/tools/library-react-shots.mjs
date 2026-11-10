// Run while ./x agent holds this checkout's server; it never starts another server.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { chromium } = createRequire(resolve('../web/package.json'))('@playwright/test');
const origin = process.env.API_BASE_URL ?? 'http://127.0.0.1:3915';
const out = resolve('.exact/shots/library-react');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/home/sawyer/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
try {
  const setup = await browser.newContext({ baseURL: origin });
  const deadline = Date.now() + 45000;
  while (true) {
    const r = await setup.request.post('/api/auth/sign-in/email', { data: { email: 'library-shots@example.com', password: 'correct horse' } }).catch(() => null);
    if (r?.ok()) break;
    if (Date.now() > deadline) throw new Error('Exact screenshot drive did not sign up.');
    await new Promise(r => setTimeout(r, 200));
  }
  // The drive uploads before it pauses. Wait on that fixture, not on another server.
  let agents, files, id;
  while (true) {
    ({ agents } = await (await setup.request.get('/api/agents')).json());
    id = agents[0]?.id;
    files = id ? (await (await setup.request.get(`/api/agents/${id}/library`)).json()).files : [];
    if (files.length >= 3) break;
    if (Date.now() > deadline) throw new Error('Screenshot uploads did not finish.');
    await new Promise(r => setTimeout(r, 200));
  }
  const doc = files.find(f => f.name === 'report.md');
  const saved = await setup.storageState();
  for (const [name, size] of [['wide', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ baseURL: origin, storageState: saved, viewport: size, colorScheme: scheme, hasTouch: name === 'phone', isMobile: name === 'phone' });
      await context.addInitScript(() => { localStorage.setItem('dc-chat-list', 'open'); localStorage.setItem('dc-agent-panel', 'closed'); });
      const page = await context.newPage();
      for (const [what, query] of [['home', ''], ['document', `?file=${doc.id}`]]) {
        await page.goto(`/a/${id}/library${query}`);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${out}/${name}-${what}-${scheme}.png` });
      }
      await context.close();
    }
  }
  const { sites } = await (await setup.request.get(`/api/agents/${id}/sites`)).json();
  const site = sites[0];
  if (site) {
    const anon = await browser.newContext({ baseURL: origin });
    const privateStatus = (await anon.request.get(`/s/${site.id}`)).status();
    if (privateStatus !== 401) throw new Error(`Private site answered ${privateStatus} to a stranger`);
    if (!(await setup.request.get(`/s/${site.id}`)).ok()) throw new Error('Owner could not open private site');
    await setup.request.patch(`/api/agents/${id}/sites/${site.id}`, { data: { public: true } });
    if (!(await anon.request.get(`/s/${site.id}`)).ok()) throw new Error('Public site did not open');
    await setup.request.patch(`/api/agents/${id}/sites/${site.id}`, { data: { public: false } });
    await anon.close();
    console.log('Site permission checks: restricted 401, owner 200, public 200');
  }
  // Native download buttons are opaque to Contract's tree, so test the browser button too.
  const exactOrigin = origin.replace(':3915', ':8770');
  const nativeContext = await browser.newContext();
  const native = await nativeContext.newPage();
  await native.goto(`${exactOrigin}/a/${id}/library?file=${doc.id}`);
  await native.getByRole('textbox', { name: 'Email', exact: true }).fill('library-shots@example.com');
  await native.getByLabel('Password', { exact: true }).fill('correct horse');
  await native.getByRole('button', { name: 'Sign in', exact: true }).click();
  await native.getByRole('button', { name: 'More', exact: true }).click();
  const downloadWait = native.waitForEvent('download');
  await native.locator('do-library-download').getByRole('button', { name: 'Download', exact: true }).first().click();
  const download = await downloadWait;
  await download.saveAs('.exact/library-native-download.md');
  console.log(`Native download: ${download.suggestedFilename()}`);
  await nativeContext.close();
  console.log(`React library pictures: ${out}`);
} finally {
  await browser.close();
  writeFileSync('.exact/library-react.done', 'done');
}
