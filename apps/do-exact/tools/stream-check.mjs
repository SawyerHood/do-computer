// Checks that a long reply arrives whole, piece by piece: one drive signs up, asks the echo
// model for "Say something long" (server.ts scripts a thought of 120 words, written a few
// letters at a time), and reads the thought on screen every 50 ms as it comes. Every reading has
// to be the beginning of the whole thought, and each at least as long as the one before: a
// piece that never arrived would leave a gap that every later reading carries. A test line can
// only compare whole values, so this is a drive. Run from the app's folder:
//   node tools/stream-check.mjs
import { spawnSync } from 'node:child_process';

const whole = Array.from({ length: 120 }, (_, n) => `Word${n + 1}`).join(' ');
const reads = 160;
const ops = [
  'clock data', 'tap sign-toggle', 'type sign-name Ada', 'type sign-email stream-check@example.com',
  "type sign-password 'correct horse'", 'tap sign-submit', 'clock data',
  'tap new-dood', 'clock data', 'clock settle', 'clock data',
  "type composer 'Say something long'", 'tap send', 'clock data',
  ...Array.from({ length: reads }, () => ['clock +50 real', 'state chat']).flat(),
];
const run = spawnSync('./x', ['agent', 'web', '--json', '--size', '1280x800', ...ops], { encoding: 'utf8', maxBuffer: 64 << 20 });
const chats = run.stdout.split('\n').filter((line) => line.startsWith('{"owner"')).map((line) => JSON.parse(line));
if (chats.length !== reads) {
  console.error(run.stdout.slice(-2000), run.stderr.slice(-2000));
  throw new Error(`stream-check: ${chats.length} readings of the chat, expected ${reads}`);
}
// The transcript draws no thinking, as the React app does not; the chat's answer carries it as `thought`.
const thoughts = chats.map((chat) => chat.thought ?? '');
let before = '';
let lost = 0;
for (const [at, thought] of thoughts.entries()) {
  if (!whole.startsWith(thought)) throw new Error(`stream-check: reading ${at} is not the beginning of the thought: …${thought.slice(-80)}`);
  if (thought.length < before.length) throw new Error(`stream-check: reading ${at} is shorter than the one before`);
  if (chats[at].lost) lost++;
  before = thought;
}
const seen = new Set(thoughts.filter((t) => t !== '' && t !== whole)).size;
if (before !== whole) throw new Error(`stream-check: the thought ended as …${before.slice(-80)}`);
if (seen < 10) throw new Error(`stream-check: only ${seen} readings in between; it did not arrive piece by piece`);
if (lost > 0) throw new Error(`stream-check: the chat was lost in ${lost} readings`);
console.log(`stream-check: ok. ${seen} different readings on the way, each the beginning of the whole; never lost.`);
