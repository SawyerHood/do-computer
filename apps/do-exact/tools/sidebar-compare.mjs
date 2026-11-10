// The sidebar in the React app and in this one, on the same server and account, side by side:
// open, a row pointed at, and shut to its faces, light and dark, with and without a team.
// Needs ./x web-build and the server built. Run from apps/do-exact: node tools/sidebar-compare.mjs [out]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))('@playwright/test');
const slot = Number(process.env.DCX_SLOT ?? (() => { try { return readFileSync(`${here}.slot`, 'utf8').trim(); } catch { return '0'; } })());
const origin = `http://127.0.0.1:${3911 + slot}`;
const out = process.argv[2] ?? `${here}.exact/shots/sidebar-compare`; mkdirSync(out, { recursive: true });
const server = spawn(process.env.BUN ?? 'bun', ['server.ts'], { cwd: here, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, API_BASE_URL: origin, DC_EXACT_APP: `${here}target/web-dist` } });
try {
  for (let tries = 0; ; tries++) {
    if (await fetch(`${origin}/api/health`).then((r) => r.ok, () => false)) break;
    if (tries > 100) throw new Error('the server did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  try {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const api = async (method, path, data) => { const r = await page.request.fetch(path, { method, headers: { origin }, data }); if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`); return r.json().catch(() => ({})); };
    await api('POST', '/api/auth/sign-up/email', { name: 'Ada Lovelace', email: `sidebar-${Date.now()}@example.com`, password: 'correct horse' });
    const made = [];
    for (const [name, text] of [['Penjamin', 'The team sent a calendar invite for Friday'], ['Terry Tutor', 'Yes, partly on purpose and partly my bias'], ['Journal Jim', '']]) {
      const { agent } = await api('POST', '/api/agents', {});
      await api('PATCH', `/api/agents/${agent.id}`, { name, hatched: true });
      if (text) { const chat = await api('POST', `/api/agents/${agent.id}/chats/main`); await api('POST', `/api/agents/${agent.id}/chats/${chat.id}/messages`, { text, images: [], requestId: crypto.randomUUID(), timezone: 'UTC' }); }
      made.push(agent.id);
    }
    await new Promise((r) => setTimeout(r, 2500));
    const shoot = async (app, tag) => {
      await page.goto(app === 'exact' ? '/x/' : '/x/off');
      const edge = page.getByRole('separator', { name: 'Resize the sidebar' });
      const set = async (open) => { if ((await edge.getAttribute('aria-valuenow') !== '60') !== open) { await edge.focus(); await page.keyboard.press(open ? 'End' : 'Home'); } await page.evaluate(() => document.activeElement?.blur()); await page.mouse.move(900, 600); await page.waitForTimeout(400); };
      for (const scheme of ['light', 'dark']) {
        // The React app reads the scheme as its page loads.
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/a/${made[1]}`);
        await page.getByRole('textbox', { name: /^Message/ }).first().waitFor({ timeout: 30000 });
        await page.waitForTimeout(1500);
        await set(true);
        // Both at the width they start at, whatever was left.
        const clip = { x: 0, y: 0, width: Math.round((await edge.boundingBox()).x + 8), height: 800 };
        await page.screenshot({ path: `${out}/${tag}-${app}-open-${scheme}.png`, clip });
        // What is where, to set one beside the other in numbers.
        if (scheme === 'light') console.log(app, tag, JSON.stringify(await page.evaluate(() => {
          const all = [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right <= 300 && e.getBoundingClientRect().width > 0);
          const said = (t) => all.filter((e) => e.children.length === 0 && e.textContent.trim() === t).at(-1);
          const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10, c.fontSize, c.fontWeight, c.color, c.lineHeight].join(' '); };
          const rows = [...document.querySelectorAll('a')].filter((a) => /Terry|Penjamin|Journal/.test(a.textContent + (a.getAttribute('aria-label') ?? '')) && a.getBoundingClientRect().right <= 300);
          return { heading: box(said('Doods') ?? said('Personal')), terry: box(said('Terry Tutor')), line: box(all.filter((e) => e.children.length === 0 && e.textContent.startsWith('You said: Yes')).at(-1)), time: box(said('now')), jim: box(said('Journal Jim')), team: box(said('New team')), rows: rows.map(box), faces: [...document.querySelectorAll('canvas, do-creature, [data-exact-native]')].filter((e) => e.getBoundingClientRect().right <= 300).slice(0, 3).map(box), svgs: [...document.querySelectorAll('svg')].filter((e) => e.getBoundingClientRect().right <= 300).map(box) };
        })));
        const row = await page.getByRole('link', { name: /Penjamin/ }).first().boundingBox();
        await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2); await page.waitForTimeout(400);
        await page.screenshot({ path: `${out}/${tag}-${app}-hover-${scheme}.png`, clip });
        await set(false);
        await page.screenshot({ path: `${out}/${tag}-${app}-rail-${scheme}.png`, clip: { x: 0, y: 0, width: 96, height: 800 } });
      }
    };
    await shoot('react', 'alone'); await shoot('exact', 'alone');
    await api('POST', '/api/workspaces', { name: 'bb', color: 'plum', agentIds: [made[2]] });
    await shoot('react', 'team'); await shoot('exact', 'team');
    console.log(`sidebar-compare: ${out}`);
  } finally { await browser.close(); }
} finally { server.kill(); }
