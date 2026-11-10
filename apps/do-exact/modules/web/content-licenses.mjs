// Keep upstream notices beside the generated bundles, including their runtime dependencies.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
export function notices() {
  const seen = new Set(), texts = [];
  const visit = manifest => {
    manifest = realpathSync(manifest);
    if (seen.has(manifest)) return;
    seen.add(manifest);
    const data = JSON.parse(readFileSync(manifest, 'utf8')), dir = dirname(manifest);
    const files = readdirSync(dir).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
    texts.push(`${data.name} ${data.version}\n${files.map(file => readFileSync(join(dir, file), 'utf8')).join('\n') || `License: ${data.license || 'See upstream package'}`}\n`);
    const require = createRequire(manifest);
    for (const dependency of Object.keys(data.dependencies || {})) {
      let entry;
      try { entry = require.resolve(dependency); } catch { continue; }
      let parent = dirname(realpathSync(entry));
      while (parent !== dirname(parent)) {
        const path = join(parent, 'package.json');
        if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).name === dependency) { visit(path); break; }
        parent = dirname(parent);
      }
    }
  };
  for (const name of ['mermaid', 'shiki', 'react-markdown', 'remark-gfm', 'rehype-raw', 'rehype-sanitize']) visit(new URL(`../../../web/node_modules/${name}/package.json`, import.meta.url));
  return texts.sort().join('\n----------------------------------------\n\n');
}
