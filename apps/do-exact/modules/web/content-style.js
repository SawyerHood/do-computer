import theme from './markdown-built/theme.js';

export const css = theme + `
:host{display:block;min-width:0;max-width:100%;user-select:text}
.md{font:inherit;font-size:1rem;line-height:1.65;color:var(--foreground);overflow-wrap:anywhere;min-width:0}
.md *{box-sizing:border-box}.md>:first-child{margin-top:0}.md>:last-child{margin-bottom:0}
p,ul,ol,blockquote,pre,table,details,hr,h1,h2,h3,h4,h5,h6{margin:14px 0 0}
h1,h2,h3,h4,h5,h6{font-weight:600;line-height:1.4}h1{font-size:1.125rem}h2,h3{font-size:1rem}h4,h5,h6{font-size:.9375rem}
ul,ol{padding-left:20px}ul{list-style-type:disc}li>ul,li>ol{margin-top:4px}li+li{margin-top:4px}li>p{margin-top:0}a{color:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
blockquote{border-left:2px solid var(--border);padding-left:12px;color:var(--muted-foreground);margin-left:0;margin-right:0}
hr{border:0;border-top:1px solid var(--border)}code,kbd{font-family:ui-monospace,monospace;font-size:.85em;border:1px solid var(--hairline);border-radius:6px;background:var(--muted);padding:1px 5px}
kbd{border-bottom-width:2px}mark{color:inherit;background:color-mix(in oklch,var(--warning) 28%,transparent)}
.code{overflow:hidden;border-radius:8px;background:color-mix(in oklch,var(--foreground) 6%,transparent);margin-top:14px}
.head{height:2rem;display:flex;align-items:center;gap:2px;padding:0 4px 0 12px;font-size:.75rem;line-height:1.4;color:var(--muted-foreground)}
.language{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace}
button{font:inherit;color:inherit;background:transparent;border:0;border-radius:5px;padding:4px 6px;cursor:pointer}button:hover,button[aria-pressed=true]{background:var(--accent);color:var(--foreground)}button:focus-visible,summary:focus-visible{outline:2px solid var(--primary);outline-offset:1px}button svg{width:16px;height:16px;display:block;fill:none;stroke:currentColor;stroke-width:1.5}
.code pre{margin:0;overflow-x:auto;padding:0 12px 12px;font:.8125rem/1.5 ui-monospace,monospace;white-space:pre;overflow-wrap:normal}.code pre.wrap{white-space:pre-wrap;overflow-wrap:anywhere}.code pre code{font:inherit;padding:0;border:0;background:none}
.diagram{display:flex;overflow-x:auto;padding:4px 12px 12px;justify-content:safe center}.diagram svg{flex:none;height:auto;width:max(100%,calc(var(--drawn,0px)*.8))}.diagram[hidden],pre[hidden]{display:none}
.table{position:relative;margin-top:14px}.table-scroll{overflow-x:auto}table{border-collapse:collapse;font-size:.9375rem;font-variant-numeric:tabular-nums;margin:0;overflow-wrap:normal}th,td{border-bottom:1px solid var(--hairline);padding:8px 16px;text-align:left;vertical-align:top}th:first-child,td:first-child{padding-left:0}th{font-size:.8125rem;font-weight:500;color:var(--muted-foreground);border-color:var(--border);vertical-align:bottom}tbody tr:last-child td{border:0}.one-line :is(th,td){white-space:nowrap}.tools{position:absolute;top:0;right:0;display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--background);font-size:12px;color:var(--muted-foreground);box-shadow:var(--elevation-raised);opacity:0}.table:hover .tools,.table:focus-within .tools{opacity:1}@media(pointer:coarse){.tools{opacity:1}}.table-menu{position:absolute;right:0;top:30px;padding:4px;min-width:160px;border-radius:8px;background:var(--background);box-shadow:var(--elevation-float);z-index:1}.table-menu button{display:block;white-space:nowrap;width:100%;text-align:left}.table-menu[hidden]{display:none}
.alert{--alert:var(--muted-foreground);border-left:2px solid var(--alert);padding-left:12px;margin-top:14px}.alert[data-alert=tip]{--alert:var(--success)}.alert[data-alert=important]{--alert:var(--syntax-keyword)}.alert[data-alert=warning]{--alert:var(--warning)}.alert[data-alert=caution]{--alert:var(--destructive)}.alert-title{color:var(--alert);font-size:.875rem;font-weight:600;margin:0}.alert>*+*{margin-top:6px}.alert>div>:first-child{margin-top:0}
details{border-block:1px solid var(--border)}summary{cursor:pointer;font-weight:500;padding:8px 0}details>:not(summary){margin-left:14px}details>:last-child:not(summary){margin-bottom:12px}
.contains-task-list{list-style:none;padding-left:4px}input[type=checkbox]{accent-color:var(--primary);margin-right:8px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}img{max-width:100%;vertical-align:middle}img[data-alone][data-loading]:not([width]){aspect-ratio:16/9;width:min(100%,480px);background:var(--muted)}img[data-alone]{display:block;max-height:384px;width:auto;max-width:min(100%,480px);border:1px solid var(--hairline);border-radius:12px;cursor:zoom-in}.remote,.missing{display:inline-flex;align-items:center;flex-wrap:wrap;gap:8px;max-width:100%;border:1px dashed var(--input);border-radius:8px;padding:6px 10px;color:var(--muted-foreground);font-size:.875rem}.missing{border:1px solid var(--hairline);border-radius:6px;background:var(--muted);padding:1px 6px}.remote button{text-decoration:underline}audio,video{max-width:100%}
`;

export function shell(element) {
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = css;
  const body = document.createElement('div'); body.className = 'md';
  root.replaceChildren(style, body);
  return { root, body };
}

export function appearance(body, element, props) {
  const dark = props.dark === undefined
    ? (globalThis.exact?.systemScheme ?? getComputedStyle(element).colorScheme) === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches
    : props.dark === 'true';
  const changed = body.classList.contains('dark') !== dark;
  body.classList.toggle('dark', dark);
  return changed;
}

export function themes(update) {
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', update);
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-scheme'] });
  return () => { observer.disconnect(); media.removeEventListener('change', update); };
}

const paths = {
  copy: 'M6 6h8v9H6z M9 3h8v9',
  wrap: 'M3 4h12M3 8h9a3 3 0 0 1 0 6H8m0-3-3 3 3 3',
  code: 'm6 4-4 5 4 5m6-10 4 5-4 5',
};
export function button(label, icon, run) {
  const b = document.createElement('button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
  if (paths[icon]) b.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${paths[icon]}"/></svg>`;
  else b.textContent = label;
  b.addEventListener('click', e => { e.stopPropagation(); run(b); });
  return b;
}

export async function copy(text, b, event) {
  try {
    await navigator.clipboard.writeText(text);
    b.setAttribute('aria-label', 'Copied'); b.title = 'Copied'; event(8, 'copied');
  } catch { event(8, 'copy-failed'); }
}
