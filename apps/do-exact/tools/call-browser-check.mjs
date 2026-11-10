// Run by tools/call-browser-run.mjs while ./x agent owns this checkout's page and scripted
// server (its slot's ports). No other server is started.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))('@playwright/test');
const slot = Number(process.env.DCX_SLOT ?? (() => { try { return readFileSync('.slot', 'utf8').trim(); } catch { return '0'; } })());
const origin = process.env.CALL_PAGE ?? `http://127.0.0.1:${8766 + slot}`;
const api = process.env.CALL_API ?? `http://127.0.0.1:${3911 + slot}`;
const out = '.exact/shots/calls'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const errors = [];
async function exact(context, email, name = 'Juniper') {
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct horse');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: `Talk to ${name}` }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  return page;
}
async function account(context, suffix) {
  const email = `call-browser-${suffix}-${Date.now()}@example.com`;
  assert.equal((await context.request.post(`${api}/api/auth/sign-up/email`, { data: { name: 'Ada', email, password: 'correct horse' } })).status(), 200);
  const { agent } = await (await context.request.post(`${api}/api/agents`)).json();
  await context.request.patch(`${api}/api/agents/${agent.id}`, { data: { name: 'Juniper', avatar: { seed: 'juniper', color: 'moss' } } });
  const chat = await (await context.request.post(`${api}/api/agents/${agent.id}/chats/main`)).json();
  await context.request.post(`${api}/api/agents/${agent.id}/chats/${chat.id}/messages`, { data: { text: 'The launch is on Friday.', requestId: 'r1' } });
  return { email, agentId: agent.id, chatId: chat.id };
}
try {
  for (const size of (process.env.CALL_MEDIA_ONLY || process.env.CALL_GUARDS_ONLY ? [] : [{ width: 1280, height: 800 }, { width: 390, height: 844 }])) for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: size, colorScheme: scheme });
    const made = await account(context, `${size.width}-${scheme}`);
    const page = await exact(context, made.email);
    if (size.width > 900) await page.getByRole('button', { name: "Show Juniper's panel", exact: true }).click();
    await page.getByRole('button', { name: size.width > 900 ? 'Call' : 'Call Juniper', exact: true }).click();
    await page.getByRole('region', { name: 'The call', exact: true }).getByText('Any time.', { exact: true }).waitFor({ timeout: 25000 });
    await page.screenshot({ path: `${out}/exact-${size.width}-${scheme}.png` });
    if (size.width > 900) {
      await page.getByRole('button', { name: 'Hide words', exact: true }).click();
      await page.getByRole('button', { name: 'Show words', exact: true }).click();
      await page.getByRole('button', { name: "Hide Juniper's panel", exact: true }).click();
    }
    await page.getByRole('button', { name: 'Mute', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'You’re muted' }).waitFor();
    await page.getByRole('button', { name: 'Unmute', exact: true }).click();
    await page.screenshot({ path: `${out}/exact-card-${size.width}-${scheme}.png` });
    await page.getByRole('button', { name: 'End', exact: true }).click();
    await page.getByRole('button', { name: 'Show what was said', exact: true }).click();
    await page.screenshot({ path: `${out}/exact-record-${size.width}-${scheme}.png` });
    const react = await context.newPage();
    await react.addInitScript(() => { localStorage.setItem('dc-agent-panel', 'open'); localStorage.setItem('dc-chat-list', 'open'); });
    await react.goto(`${api}/a/${made.agentId}/c/${made.chatId}`);
    const panelCall = react.getByRole('complementary', { name: 'About Juniper' }).getByRole('button', { name: 'Call', exact: true });
    if (size.width > 900) await panelCall.click();
    else await react.getByRole('button', { name: 'Call Juniper', exact: true }).click();
    await react.getByRole('region', { name: 'The call', exact: true }).getByText('Any time.', { exact: true }).waitFor({ timeout: 25000 });
    await react.screenshot({ path: `${out}/react-${size.width}-${scheme}.png` });
    await react.getByRole('button', { name: size.width > 900 ? 'End' : 'End the call', exact: true }).click();
    await context.close();
  }
  if (!process.env.CALL_MEDIA_ONLY) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const made = await account(context, 'long-name');
    const name = 'JuniperWithAnUnbrokenNameThatMustNotPushTheCallOutsideThePhone'.slice(0, 40);
    assert.equal((await context.request.patch(`${api}/api/agents/${made.agentId}`, { data: { name } })).status(), 200);
    const page = await exact(context, made.email, name);
    const call = page.getByRole('button', { name: `Call ${name}`, exact: true });
    await call.waitFor();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A draft');
    await call.waitFor({ state: 'hidden' });
    assert.equal(await call.count(), 0, 'Writing keeps Send instead of Call.');
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('');
    let release, arrived;
    const gate = new Promise(resolve => { release = resolve; });
    const upload = new Promise(resolve => { arrived = resolve; });
    await page.route('**/api/agents/*/library?*', async route => { if (route.request().method() === 'POST') { arrived(); await gate; } await route.continue(); });
    // A local path uses CDP's trusted picker event; a payload FileList is untrusted to Exact.
    writeFileSync('.exact/guard.txt', 'attachment guard');
    await page.getByLabel('Choose files to attach', { exact: true }).setInputFiles('.exact/guard.txt');
    await Promise.race([upload, new Promise((_, reject) => setTimeout(() => reject(new Error('The attachment request did not arrive.')), 10000))]).catch(async error => { console.log(await page.locator('body').innerText()); await page.screenshot({ path: `${out}/attachment-diagnostics.png` }); throw error; });
    await call.waitFor({ state: 'hidden' });
    assert.equal(await call.count(), 0, 'A pending attachment keeps Send instead of Call.');
    release();
    await page.getByRole('button', { name: 'Remove guard.txt', exact: true }).waitFor();
    assert.equal(await call.count(), 0, 'An attached file keeps Send instead of Call.');
    await page.getByRole('button', { name: 'Remove guard.txt', exact: true }).click();
    await call.click();
    const live = page.getByRole('region', { name: 'The call', exact: true });
    await live.getByText('Any time.', { exact: true }).waitFor({ timeout: 25000 });
    assert.equal(await live.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'A long name fits the live call.');
    await page.screenshot({ path: `${out}/exact-long-name-390.png` });
    await page.getByRole('button', { name: 'End', exact: true }).click();
    const record = page.getByRole('region', { name: 'A call', exact: true });
    await record.getByRole('button', { name: 'Show what was said', exact: true }).click();
    assert.equal(await record.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'A long name fits the saved call.');
    await page.screenshot({ path: `${out}/exact-long-record-390.png` });
    await context.close();
    console.log('Draft/attachment call-button guards and long-name phone call/record checked.');
  }
  // The real adapter negotiates a real local WebRTC loopback, using Chromium's fake microphone.
  const mediaContext = await browser.newContext({ permissions: ['microphone'] });
  const mediaPage = await mediaContext.newPage(); await mediaPage.goto(origin);
  const media = await mediaPage.evaluate(async () => {
    let step = "import"; try {
    const { openLine } = await import('/modules/call-media.js');
    const tracks = [], players = [], events = [];
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { step = 'getUserMedia'; const stream = await get(...args); step = 'after microphone'; tracks.push(...stream.getTracks()); return stream; };
    const Audio_ = window.Audio; window.Audio = function() { step = 'Audio'; const audio = new Audio_(); players.push(audio); return audio; };
    const other = new RTCPeerConnection();
    other.ontrack = e => other.addTrack(e.track, e.streams[0]);
    other.ondatachannel = e => { e.channel.onopen = () => e.channel.send('{"type":"session.started"}'); };
    step = "openLine"; const opened = await openLine(async sdp => {
      step = "remote offer"; await other.setRemoteDescription({ type: 'offer', sdp });
      step = "local answer"; await other.setLocalDescription(await other.createAnswer());
      await new Promise(resolve => { if (other.iceGatheringState === 'complete') return resolve(); other.onicegatheringstatechange = () => { if (other.iceGatheringState === 'complete') resolve(); }; });
      return { id: 'local-only', dialect: 'openai', sdp: other.localDescription.sdp, maxSeconds: 60, quietSeconds: 120 };
    }, data => events.push(data), () => {});
    await new Promise(resolve => setTimeout(resolve, 800));
    opened.line.setMuted(true); const muted = tracks.every(t => !t.enabled);
    opened.line.setMuted(false); const unmuted = tracks.every(t => t.enabled);
    const remote = players.some(p => p.srcObject?.getTracks().length > 0);
    const measured = opened.line.levels().you > 0;
    opened.line.close(); other.close();
    return { muted, unmuted, remote, measured, stopped: tracks.every(t => t.readyState === 'ended'), detached: players.every(p => p.srcObject === null), data: events.some(e => e.includes('session.started')) };
    } catch (e) { return { error: String(e), stack: e.stack, step }; }
  });
  console.log('Media adapter result:', media);
  assert.deepEqual(media, { muted: true, unmuted: true, remote: true, measured: true, stopped: true, detached: true, data: true });
  console.log('Real local WebRTC loopback:', media);
  await mediaContext.close();
  // Boundary fault injection: the real deployment is scripted; only metadata is changed to
  // make the app ask for a microphone. No provider or microphone outcome is faked here.
  const deniedBrowser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-fake-device-for-media-stream'] });
  const denied = await deniedBrowser.newContext(); const made = await account(denied, 'denied');
  await denied.route('**/api/agents/*/calls', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { available: true, dialect: 'openai', voices: ['marin'], voice: 'marin' } });
    return route.fulfill({ status: 503, json: { error: 'Voice provider unavailable (test fault).' } });
  });
  await denied.addInitScript(() => { const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__callTracks = []; navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await get(...args); window.__callTracks.push(...stream.getTracks()); return stream; }; });
  const page = await exact(denied, made.email);
  const cdp = await denied.newCDPSession(page);
  const { browserContextId } = (await cdp.send('Target.getTargetInfo')).targetInfo;
  await cdp.send('Browser.setPermission', { browserContextId, permission: { name: 'microphone' }, setting: 'denied', origin });
  console.log('Permission before calling:', await page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state));
  await page.getByRole('button', { name: 'Call Juniper', exact: true }).click();
  await page.getByText('The microphone is not allowed here. Check the permission for this site, then call again.', { exact: true }).waitFor().catch(async e => { await page.screenshot({ path: `${out}/permission-diagnostics.png` }); console.log(await page.locator('body').innerText()); throw e; });
  await page.screenshot({ path: `${out}/permission-denied.png` });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await deniedBrowser.close();
  const granted = await browser.newContext({ permissions: ['microphone'] });
  const providerAccount = await account(granted, 'provider-error');
  await granted.route('**/api/agents/*/calls', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { available: true, dialect: 'openai', voices: ['marin'], voice: 'marin' } });
    return route.fulfill({ status: 503, json: { error: 'Voice provider unavailable (test fault).' } });
  });
  await granted.addInitScript(() => { const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__callTracks = []; navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await get(...args); window.__callTracks.push(...stream.getTracks()); return stream; }; });
  const providerPage = await exact(granted, providerAccount.email);
  await providerPage.getByRole('button', { name: 'Call Juniper', exact: true }).click();
  await providerPage.getByText('Voice provider unavailable (test fault).', { exact: true }).waitFor({ timeout: 15000 });
  await providerPage.screenshot({ path: `${out}/provider-refused.png` });
  assert.equal(await providerPage.evaluate(() => window.__callTracks.length > 0 && window.__callTracks.every(t => t.readyState === 'ended')), true, 'Provider failure releases every microphone track.');
  await providerPage.getByRole('button', { name: 'OK', exact: true }).click();
  assert.equal(await providerPage.getByRole('button', { name: 'Call Juniper', exact: true }).isEnabled(), true);
  await granted.close();
  assert.deepEqual(errors, []);
  console.log('Scripted real-server calls, panel/card/record, light/dark at both widths, real permission denial, and injected provider refusal checked.');
} finally { await browser.close(); writeFileSync('.exact/call-browser.done', 'done'); }
