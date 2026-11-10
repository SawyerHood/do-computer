// The app served by Do Computer's own server at `/x/` (`DC_EXACT_APP`), in a browser beside the
// React app on the same origin: signing in to either is signing in to both, signing out of the
// Exact app signs the React app out, a deep link under /x/ opens there, and /x/off goes back.
// Exact's own driver drives one app on one page, so this is Playwright's (apps/web has it).
// tools/same-origin.sh runs it, after tests/same-origin.test.contract; it needs the web build
// (./x web-build) and the server (pnpm --filter @do-computer/web build:node).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))('@playwright/test');
const slot = Number(process.env.DCX_SLOT ?? (() => { try { return readFileSync(`${here}.slot`, 'utf8').trim(); } catch { return '0'; } })());
const origin = `http://127.0.0.1:${3911 + slot}`;

const server = spawn(process.env.BUN ?? 'bun', ['server.ts'], {
  cwd: here,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, API_BASE_URL: origin, DC_EXACT_APP: `${here}target/web-dist` },
});
const check = (ok, said) => {
  if (!ok) throw new Error(`same-origin: ${said}`);
  console.log(`same-origin: ok: ${said}`);
};

try {
  for (let tries = 0; ; tries++) {
    const up = await fetch(`${origin}/api/health`).then((r) => r.ok, () => false);
    if (up) break;
    if (tries > 100) throw new Error(`same-origin: the server at ${origin} did not start`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  try {
    // Signed in to the React app: the Exact app is signed in as well.
    const react = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
    const page = await react.newPage();
    const made = await page.request.post('/api/auth/sign-up/email', {
      headers: { origin },
      data: { name: 'Ada', email: 'same-origin-react@example.com', password: 'correct horse' },
    });
    check(made.ok(), 'an account is made in the React app, and its cookie kept');
    await page.goto('/x/');
    check(new URL(page.url()).pathname === '/', '/x/ opens the Exact app at /');
    await page.getByTestId('account').waitFor({ timeout: 20000 });
    check(await page.getByTestId('sign-submit').count() === 0, 'the Exact app is signed in as the React app is');

    // A Dood made in the Exact app, opened by a deep link under /x/ and by its own address after a reload.
    // The final first run owns an empty account, rather than the old New Dood button.
    await page.getByTestId('welcome-skip').click();
    await page.getByTestId('welcome-hello').click();
    await page.getByTestId('welcome-name').fill('Pip');
    await page.getByTestId('welcome-named').click();
    await page.getByTestId('welcome-think').click();
    await page.getByTestId('welcome-start').click();
    await page.getByTestId('screen-dood').waitFor({ timeout: 20000 });
    const dood = new URL(page.url()).pathname;
    check(/^\/a\/[^/]+$/.test(dood), `a Dood opens at ${dood}`);
    await page.goto(`/x${dood}/library`);
    check(new URL(page.url()).pathname === `${dood}/library`, 'a deep link under /x/ opens at its own address');
    await page.getByTestId('screen-library').waitFor({ timeout: 20000 });
    await page.reload();
    await page.getByTestId('screen-library').waitFor({ timeout: 20000 });
    check(true, 'a reload stays in the Exact app');

    // A document read by the library's own requests keeps the cookie: a bearer header the server
    // cannot read would have signed the browser out of both apps.
    const agentId = dood.split('/')[2];
    const doc = await page.request.post(`/api/agents/${agentId}/library?path=notes.md`, {
      headers: { origin, 'content-type': 'application/octet-stream' }, data: '# Notes\n\nKept.\n',
    });
    check(doc.ok(), 'a document is put in the library');
    await page.goto(`${dood}/library?file=${(await doc.json()).id}`);
    await page.getByTestId('library-markdown').waitFor({ timeout: 20000 });
    await page.waitForTimeout(2000);
    check((await page.request.get('/api/me')).ok() && await page.getByTestId('sign-submit').count() === 0, 'reading a document keeps the browser signed in');

    // Signed out in the Exact app: the React app is signed out too.
    await page.goto('/');
    await page.getByTestId('account').click();
    await page.getByTestId('sign-out').click();
    await page.getByTestId('sign-submit').waitFor({ timeout: 20000 });
    check((await page.request.get('/api/me')).status() === 401, 'signing out of the Exact app signs the React app out');

    // Signed in to the Exact app: the React app is signed in, and keeps being the React app after /x/off.
    const exact = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
    const other = await exact.newPage();
    await other.goto('/x/');
    await other.getByTestId('sign-toggle').click();
    await other.getByTestId('sign-name').fill('Grace');
    await other.getByTestId('sign-email').fill('same-origin-exact@example.com');
    await other.getByTestId('sign-password').fill('correct horse');
    await other.getByTestId('sign-submit').click();
    await other.getByTestId('account').waitFor({ timeout: 20000 });
    const me = await other.request.get('/api/me');
    check(me.ok() && (await me.json()).user.email === 'same-origin-exact@example.com', 'signing in to the Exact app signs the React app in');
    const cookies = await exact.cookies();
    check(!cookies.some((c) => c.name === 'dc-app' && !c.httpOnly), 'the cookie that picks the app is for the server alone');
    await other.goto('/x/off');
    check(new URL(other.url()).pathname === '/' && (await other.locator('base[href="/x/"]').count()) === 0, '/x/off goes back to the React app');
    check(!(await exact.cookies()).some((c) => c.name === 'dc-app' && c.value === 'exact'), '/x/off lets go of the Exact app');
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
