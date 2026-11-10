// Add a tag's implementation here; its DOM and lifetime belong in its own file.
import * as connectorsPicture from './connectors-picture.js';
import * as dictation from './dictation.js';
import * as creature from './creature.js';
import * as portrait from './portrait.js';
import * as gift from './gift.js';
import * as wardrobe from './wardrobe.js';
import * as sky from './sky.js';
import * as push from './push.js';
import * as libraryDownload from './library-download.js';
import * as libraryFormat from './library-format.js';
import * as libraryFrame from './library-frame.js';
import { start, ended } from './shared.js';
import { markdown, code, mermaid } from './content-views.js';
const views = { 'do-slack-picture': connectorsPicture, 'do-dictation': dictation, 'do-creature': creature, 'do-portrait': portrait, 'do-gift': gift, 'do-wardrobe': wardrobe, 'do-sky': sky, 'do-markdown': markdown, 'do-code': code, 'do-mermaid': mermaid, 'do-push': push, 'do-library-download': libraryDownload, 'do-library-format': libraryFormat, 'do-library-frame': libraryFrame };
export const abi = 1;
export const roster = Object.fromEntries(Object.keys(views).map(tag => [tag, { snapshot: false }]));
export function create(tag, element, json, event) {
  const view = views[tag];
  if (!view) throw new Error(`Unknown native view: ${tag}`);
  return view.create(element, JSON.parse(json), event);
}
export function setProps(handle, json) { handle.setProps(JSON.parse(json)); }
export function destroy(handle) { handle.destroy(); }
// Exporting app loads Exact's hatch clock even when there are no element hatches.
export function app() { start(); push.listen(); }
export function appEnded() { ended(); }
