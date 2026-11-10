// Bun-only checks of the actual data bridge, without a server, provider or credentials.
import assert from 'node:assert/strict';
import { callSources } from '../data/call.ts';
import { ownerOf } from '../data/api.ts';
const old = { owner: 'old-user', active: true, lines: [{ who: 'you', text: 'old words' }], works: [{ id: 'w1', ask: 'old ask', done: false }] };
const decoded = callSources.readCallView(['new-user', JSON.stringify(old)] as never) as typeof old;
assert.equal(decoded.owner, 'old-user', 'A late snapshot must keep its old owner, so the Contract guard hides it.');
assert.equal(decoded.owner === 'new-user', false);
assert.equal(decoded.lines[0].text, 'old words');
const store = { get: () => 'current-token' };
const refused = await callSources.callRequest(['different-user', JSON.stringify({ id: 'r1', verb: 'start', agentId: 'a1' })] as never, store as never);
assert.equal(JSON.parse(refused.json).ok, false);
assert.match(JSON.parse(refused.json).error, /Sign in again/);
const unknown = await callSources.callRequest([ownerOf('test-user', store as never), JSON.stringify({ id: 'r2', verb: 'anything-else', agentId: 'a1' })] as never, store as never);
assert.equal(JSON.parse(unknown.json).ok, false);
assert.match(JSON.parse(unknown.json).error, /Unknown call request/);
console.log('Call data bridge: owner isolation, stale-session refusal and RPC allowlist passed.');
