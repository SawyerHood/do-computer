// Only run while the root ./x drive owns the test server. Never start a server here.
import { chromium } from '../../../web/node_modules/@playwright/test/index.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixtures } from './fixtures.mjs';
const output = resolve(import.meta.dir, '.exact');
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3911', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const post = async (url, data) => {
    const response = await page.request.post(url, data === undefined ? {} : { data });
    if (!response.ok()) throw new Error(`${url}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  await post('/api/auth/sign-up/email', { name: 'Markdown reference', email: 'markdown@example.com', password: 'markdown gallery password' });
  const { agent } = await post('/api/agents');
  await page.request.patch(`/api/agents/${agent.id}`, { data: { name: 'Pip', hatched: true } });
  const chat = await post(`/api/agents/${agent.id}/chats/main`);
  const url = `/a/${agent.id}/c/${chat.id}`;
  await page.goto(url);
  for (const [prompt, markdown] of Object.entries(fixtures)) {
    await post(`/api/agents/${agent.id}/chats/${chat.id}/messages`, { text: prompt, requestId: crypto.randomUUID() });
    const reply = page.locator('[data-markdown].prose-chat').last();
    await page.waitForFunction(text => [...document.querySelectorAll('[data-markdown]')].some(element => element.textContent.includes(text)), prompt === 'gallery-syntax' ? 'made-up-language' : 'Math $a^2');
    if (prompt === 'gallery-syntax') {
      await reply.locator('.md-code pre code span').first().waitFor();
      await reply.locator('.md-diagram svg').waitFor();
    }
    for (const [width, height, size] of [[1280, 800, 'desktop'], [390, 844, 'mobile']]) {
      await page.setViewportSize({ width, height });
      for (const mode of ['light', 'dark']) {
        await page.evaluate(mode => {
          localStorage.setItem('dc-theme', mode); document.documentElement.classList.toggle('dark', mode === 'dark');
        }, mode);
        if (prompt === 'gallery-syntax') await page.waitForFunction(() => document.querySelector('.md-diagram svg')?.innerHTML.includes('Reply'));
        await reply.locator('h1,h2').first().evaluate(element => element.scrollIntoView({ block: 'start' }));
        // Keep the real React app's frame; no replacement Markdown component or copied CSS.
        await page.screenshot({ path: resolve(output, `react-${prompt.slice(8)}-${size}-${mode}.png`) });
      }
    }
    console.log(`React rendered ${prompt}: ${markdown.length} characters, four reference screenshots`);
  }
} finally { await browser.close(); writeFileSync(resolve(output, 'reference.done'), 'done'); }
