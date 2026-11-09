// Makes this app runnable on this machine. Exact has no releases: an app uses a checkout of
// https://github.com/expo/exact by path, and `exact new` writes the files that hold that path
// (exact.mjs, Cargo.toml, the host crates, AGENTS.md). Git keeps only the app's own files, so a
// fresh clone runs this once:
//
//   bun setup.mjs <path to an Exact checkout that has run `bun scripts/exact.mjs setup`>
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const exact = process.argv[2] && resolve(process.argv[2]);
if (!exact || !existsSync(join(exact, 'scripts/exact.mjs'))) {
  console.error('usage: bun setup.mjs <Exact checkout>   (git clone https://github.com/expo/exact, then `bun scripts/exact.mjs setup` in it)');
  process.exit(1);
}
const here = import.meta.dir;
const manifest = JSON.parse(readFileSync(join(here, 'app.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'do-exact-setup-'));
try {
  // `exact new` names the crates after the folder, so the scratch app takes this one's name.
  const work = join(scratch, 'do-exact');
  const made = Bun.spawnSync(['bun', join(exact, 'scripts/exact.mjs'), 'new', work, '--name', manifest.app.name, '--bundle-id', manifest.app.id], { stdout: 'inherit', stderr: 'inherit' });
  if (made.exitCode !== 0) process.exit(made.exitCode ?? 1);
  let added = 0;
  for (const entry of readdirSync(work, { recursive: true, withFileTypes: true })) {
    const file = relative(work, resolve(entry.parentPath, entry.name));
    if (!entry.isFile() || existsSync(join(here, file))) continue;
    mkdirSync(dirname(join(here, file)), { recursive: true });
    cpSync(join(work, file), join(here, file));
    added++;
  }
  console.log(`do-exact: ${added} generated files added for this machine.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
// Exact's web build looks at `snapback4/ts` in its checkout whenever an app mounts outside
// TypeScript (`typescript.sources`, as this one mounts the protocol), and the public repository
// does not ship that folder, so the build stops with ENOENT. An empty one is enough.
mkdirSync(join(exact, 'snapback4/ts'), { recursive: true });
console.log('Next: bun exact.mjs update   (points the generated files at the checkout), then README.md.');
