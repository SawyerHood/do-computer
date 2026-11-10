// React's echo model and Exact's gallery read the very same Markdown strings.
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./app.contract', import.meta.url), 'utf8');
export const value = name => JSON.parse(new RegExp(`^  state ${name} = (".*")$`, 'm').exec(source)[1]);
export const fixtures = { 'gallery-syntax': value('sample'), 'gallery-prose': value('rich') };
