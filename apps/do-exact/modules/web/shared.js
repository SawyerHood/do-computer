import { THREE, AgentOrbCore, AgentOrbWardrobe, AgentOrbSky, AgentOrbPortrait, avatarLook } from './engine.js';

let engine;
export function drawing() {
  if (!engine) {
    const core = AgentOrbCore(THREE);
    const wardrobe = AgentOrbWardrobe(THREE, core);
    const sky = AgentOrbSky(THREE);
    engine = { core, wardrobe, sky, portrait: AgentOrbPortrait(core, sky) };
  }
  return engine;
}

// One session-clock ticket, not one browser loop or WebGL context per avatar.
const views = new Set();
let stop, previous, current = 0;
export const now = () => current;
export function start() {
  if (stop || !views.size || !globalThis.exact?.hatches) return;
  previous = undefined;
  stop = globalThis.exact.hatches.frames(frame => {
    current = frame.now;
    const seconds = previous === undefined ? 0 : Math.max(0, Math.min((current - previous) / 1000, .25));
    previous = current;
    for (const view of views) view.frame?.(seconds, current);
    if (engine) engine.core.Runner.tick(current);
  });
}
export function watch(view) { views.add(view); start(); return () => { views.delete(view); if (!views.size) { stop?.(); stop = null; } }; }
export function ended() { for (const view of [...views]) view.destroy(); stop?.(); stop = null; }
export const flag = (value, fallback = false) => value === undefined ? fallback : value === 'true';
export const number = (value, fallback, min = 1, max = 1024) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
export function look(props) {
  const seed = props.seed || 'do-computer';
  const picked = avatarLook({ seed, color: props.color || props.colour || 'clay' }, seed);
  const color = props.color || props.colour;
  if (/^#[\da-f]{6}$/i.test(color || '')) picked.color = color;
  return picked;
}
export function outfit(props) {
  let result = {};
  if (props.outfit) result = JSON.parse(props.outfit);
  for (const slot of ['hat', 'glasses', 'face', 'neck']) if (props[slot] !== undefined) result[slot] = props[slot];
  return result;
}
export function surface(element) {
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ':host{display:block} .box{position:relative;width:100%;height:100%;overflow:hidden;display:grid;place-items:center} canvas,img{display:block;image-rendering:pixelated;max-width:100%;max-height:100%;pointer-events:none} canvas{width:100%;height:100%;object-fit:contain} .hearts{position:absolute;inset:0;pointer-events:none} .heart{position:absolute;color:#ed7396;font:22px system-ui;line-height:1;pointer-events:none}';
  const box = document.createElement('div'); box.className = 'box';
  const canvas = document.createElement('canvas'); box.append(canvas);
  root.replaceChildren(style, box);
  return { root, box, canvas };
}
export function observe(view) {
  const observer = new ResizeObserver(() => view.resize()); observer.observe(view.element);
  const dark = matchMedia('(prefers-color-scheme: dark)'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const change = () => view.setProps(view.props);
  dark.addEventListener('change', change); reduced.addEventListener('change', change);
  return () => { observer.disconnect(); dark.removeEventListener('change', change); reduced.removeEventListener('change', change); };
}
export const calm = props => flag(props.reduced, matchMedia('(prefers-reduced-motion: reduce)').matches);
export const dark = props => flag(props.dark, globalThis.exact?.systemScheme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches);
