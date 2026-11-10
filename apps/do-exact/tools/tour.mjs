// Every screen of the app beside the React app's, for looking at them together: one server
// (server.ts, with DC_EXACT_APP) serves both at one origin, so the same account, Doods and data
// are drawn by each at the same address. Each screen is taken at 1280x800 and 390x844, light and
// dark, into .exact/shots/tour/<react|exact>/<screen>-<size>-<scheme>.png, and put together
// (tools/side.sh) as .exact/shots/tour/<screen>-<size>.png: React light, Exact light, React
// dark, Exact dark.
//
//   tools/tour.sh [screen…]     (it builds the web app and takes this checkout's slot)
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))('@playwright/test');
const slot = Number(process.env.DCX_SLOT ?? (() => { try { return readFileSync(`${here}.slot`, 'utf8').trim(); } catch { return '0'; } })());
const origin = `http://127.0.0.1:${3911 + slot}`;
const out = `${here}.exact/shots/tour`;
const only = process.argv.slice(2);
for (const d of ['react', 'exact']) mkdirSync(`${out}/${d}`, { recursive: true });

const server = spawn(process.env.BUN ?? 'bun', ['server.ts'], {
  cwd: here,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, API_BASE_URL: origin, DC_EXACT_APP: `${here}target/web-dist` },
});
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

for (let tries = 0; ; tries++) {
  if (await fetch(`${origin}/api/health`).then((r) => r.ok, () => false)) break;
  if (tries > 150) throw new Error(`tour: the server at ${origin} did not start`);
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  // The account and what it has, made over the API.
  const setup = await browser.newContext({ baseURL: origin });
  const api = setup.request;
  const json = async (r) => { if (!r.ok()) throw new Error(`tour: ${r.url()} ${r.status()} ${await r.text()}`); return r.json(); };
  await json(await api.post('/api/auth/sign-up/email', { headers: { origin }, data: { name: 'Ada Lovelace', email: 'tour@example.com', password: 'correct horse' } }));
  const doods = [];
  for (const [name, color, seed] of [['Pico', 'honey', 'pico'], ['Maple', 'clay', 'maple'], ['Juniper', 'moss', 'juniper']]) {
    const { agent } = await json(await api.post('/api/agents'));
    await json(await api.patch(`/api/agents/${agent.id}`, { data: { name, avatar: { color, seed } } }));
    doods.push(agent.id);
  }
  const id = doods[2];
  const { workspaces } = await json(await api.get('/api/workspaces'));
  const personal = workspaces.find((w) => w.kind === 'personal').id;
  const chat = await json(await api.post(`/api/agents/${id}/chats/main`));
  const say = (text, n) => api.post(`/api/agents/${id}/chats/${chat.id}/messages`, { data: { text, requestId: `r${n}` } });
  await say('Plan a weekend in Lisbon for two, under €900.', 1);
  await new Promise((r) => setTimeout(r, 2500));
  await say('A budget:\n\n| Item | Cost |\n| --- | --- |\n| Flights | €320 |\n| Hotel | €410 |\n\nand `total()`:\n\n```js\nconst total = (xs) => xs.reduce((a, b) => a + b, 0)\n```', 2);
  await new Promise((r) => setTimeout(r, 2500));
  const doc = await json(await api.post(`/api/agents/${id}/library?path=${encodeURIComponent('trips/Lisbon.md')}`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: '# Lisbon\n\nTwo nights in **Alfama**, a day in Sintra.\n\n- Tram 28\n- Pastéis de nata\n\n```sh\necho ola\n```\n',
  }));
  await api.put(`/api/agents/${id}/pins/${doc.id}`);
  const { workspace: team } = await json(await api.post('/api/workspaces', { data: { name: 'Studio', color: 'plum', agentIds: [doods[0]] } }));
  await api.post(`/api/workspaces/${team.id}/invitations`, { data: { who: ['grace@example.com'] } });
  const state = await setup.storageState();

  const settings = (place) => `/a/${id}?settings=${place}`;
  // [name, Exact's address, React's address, a test id the Exact screen shows when drawn]
  const screens = [
    ['chat', `/a/${id}`, `/a/${id}`, 'screen-dood'],
    ['library', `/a/${id}/library`, `/a/${id}/library`, 'screen-library'],
    ['library-doc', `/a/${id}/library?file=${doc.id}`, `/a/${id}/library?file=${doc.id}`, 'screen-library'],
    ['automations', `/a/${id}/automations`, `/a/${id}/automations`, 'screen-automations'],
    ['profile', `/a/${id}/profile`, settings(`agent.${id}.profile`), 'screen-profile'],
    ['memory', `/a/${id}/memory`, settings(`agent.${id}.memory`), 'screen-memory'],
    ['model', `/a/${id}/model`, settings(`agent.${id}.model`), 'screen-model'],
    ['skills', `/a/${id}/skills`, settings(`agent.${id}.skills`), 'screen-skills'],
    ['connectors', `/a/${id}/connectors`, settings(`agent.${id}.connectors`), 'screen-connectors'],
    ['permissions', `/a/${id}/permissions`, settings(`agent.${id}.permissions`), 'screen-permissions'],
    ['usage', `/a/${id}/usage`, settings(`agent.${id}.usage`), 'screen-usage'],
    ['general', '/settings/general', settings('general'), 'screen-general'],
    ['notifications', '/settings/notifications', settings('notifications'), 'screen-notifications'],
    ['doods', '/settings/doods', settings('agents'), 'screen-doodsList'],
    ['workspaces', '/settings/workspaces', settings('workspaces'), 'screen-workspacesList'],
    ['computers', `/w/${personal}/computers`, settings(`workspace.${personal}.computers`), 'screen-workspaceComputers'],
    ['models', `/w/${personal}/models`, settings(`workspace.${personal}.models`), 'screen-workspaceModels'],
    ['passwords', `/w/${personal}/passwords`, settings(`workspace.${personal}.passwords`), 'screen-passwords'],
    ['people', `/w/${team.id}/people`, settings(`workspace.${team.id}.people`), 'screen-people'],
    ['pair', '/pair', '/pair', 'pair-code'],
  ].filter(([name]) => only.length === 0 || only.includes(name));

  const sizes = [['wide', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]];
  for (const [size, viewport] of sizes) {
    for (const scheme of ['light', 'dark']) {
      const context = (exact) => browser.newContext({
        baseURL: origin, viewport, colorScheme: scheme, storageState: state, deviceScaleFactor: 1,
        hasTouch: size === 'phone', isMobile: size === 'phone',
      });
      const reactContext = await context(false);
      // The React app's sidebar open, as the Exact app's always is (lib/atoms.ts SIDEBAR_OPEN_KEY).
      await reactContext.addInitScript(() => localStorage.setItem('dc-chat-list', 'open'));
      const react = await reactContext.newPage();
      const exactContext = await context(true);
      const exact = await exactContext.newPage();
      // /x/ picks the Exact app for this browser (apps/web/src/server/exact-app.ts).
      await exact.goto('/x/');
      await exact.getByTestId('app').waitFor({ timeout: 30000 });
      for (const [name, exactAt, reactAt, ready] of screens) {
        await react.goto(reactAt);
        await react.waitForLoadState('networkidle').catch(() => {});
        await react.waitForTimeout(1200);
        await react.screenshot({ path: `${out}/react/${name}-${size}-${scheme}.png` });
        await exact.goto(exactAt);
        await exact.getByTestId(ready).first().waitFor({ timeout: 20000 }).catch(() => console.log(`tour: ${name} ${size}: no ${ready}`));
        await exact.waitForLoadState('networkidle').catch(() => {});
        await exact.waitForTimeout(1500);
        await exact.screenshot({ path: `${out}/exact/${name}-${size}-${scheme}.png` });
      }
      await react.context().close();
      await exactContext.close();
    }
  }
  for (const [name] of screens) for (const [size] of sizes) {
    const pics = ['light', 'dark'].flatMap((s) => [`${out}/react/${name}-${size}-${s}.png`, `${out}/exact/${name}-${size}-${s}.png`]);
    if (size === 'wide') {
      // Two rows of two: light over dark, React on the left.
      const args = ['-loglevel', 'error', '-y', ...pics.flatMap((p) => ['-i', p]), '-filter_complex',
        '[0][1]hstack[l];[2][3]hstack[d];[l][d]vstack,scale=1900:-1', `${out}/${name}-${size}.png`];
      spawnSync('ffmpeg', args, { stdio: 'inherit' });
    } else spawnSync(`${here}tools/side.sh`, [`${out}/${name}-${size}.png`, ...pics], { stdio: 'inherit' });
    console.log(`tour: ${out}/${name}-${size}.png`);
  }
} finally {
  await browser.close();
  stop();
}
