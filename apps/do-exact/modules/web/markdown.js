import { parse, endsInOpenFence, ID_PREFIX, resolveLink, tableCsv, tableMarkdown } from './markdown-built/markdown-source.js';
import { shell, appearance, themes, button, copy } from './content-style.js';
import { block } from './code.js';
import alertIcons from './markdown-built/alert-icons.js';
import { diagram } from './mermaid.js';

const words = node => node.type === 'text' ? node.value : (node.children || []).map(words).join('');
const attrName = name => ({ className: 'class', htmlFor: 'for', tabIndex: 'tabindex', colSpan: 'colspan', rowSpan: 'rowspan' })[name]
  || (name.startsWith('aria') ? 'aria-' + name.slice(4).toLowerCase() : name.startsWith('data') ? 'data-' + name.slice(4).replace(/[A-Z]/g, c => '-' + c.toLowerCase()).replace(/^-/, '') : name);
const cleanURL = value => /^(https?:|mailto:|tel:|blob:)/i.test(value) || !/^\w[\w+.-]*:/.test(value);

function attributes(element, props = {}) {
  const keep = new Set();
  element.style.removeProperty('text-align');
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'style' || name.toLowerCase().startsWith('on')) continue;
    if ((name === 'href' || name === 'src') && !cleanURL(String(value))) continue;
    const attr = attrName(name); keep.add(attr);
    element.setAttribute(attr, value === true ? '' : Array.isArray(value) ? value.join(' ') : String(value));
    if (name === 'align' && ['left', 'center', 'right'].includes(value)) { element.style.textAlign = value; keep.add('style'); }
  }
  for (const { name } of [...element.attributes]) if (!keep.has(name)) element.removeAttribute(name);
}

function picture(container, node, context) {
  let signature = '', mounted, alive = true;
  const dom = document.createElement('span'); container.append(dom);
  const update = (next, nextContext = context) => {
    context = nextContext;
    const props = next.properties || {}, source = String(props.src || ''), alt = String(props.alt || 'A picture');
    const filePath = resolveLink('', source);
    const file = context.files.find(file => file.path === filePath);
    const key = JSON.stringify([props, file]); if (key === signature) return; signature = key;
    mounted = undefined; dom.replaceChildren(); dom.className = '';
    const missing = () => { dom.className = 'missing'; dom.textContent = alt; };
    const show = () => {
      dom.className = ''; dom.replaceChildren();
      const src = file?.href || source;
      const kind = /\.(mp4|webm|mov)(?:[?#]|$)/i.test(src) ? 'video' : /\.(mp3|wav|ogg|m4a)(?:[?#]|$)/i.test(src) ? 'audio' : 'img';
      const media = document.createElement(kind); mounted = media;
      if (kind === 'img') {
        media.alt = alt; media.loading = 'lazy'; media.referrerPolicy = 'no-referrer';
        for (const name of ['width', 'height']) if (props[name]) media.setAttribute(name, props[name]);
        if (props.dataAlone !== undefined) { media.dataset.alone = ''; media.dataset.loading = ''; }
        media.addEventListener('click', () => {
          if (media.closest('a') || props.dataAlone === undefined) return;
          // The host opens it: the chat's picture viewer, or the library's file.
          context.event(8, 'image:' + src);
        });
      } else { media.controls = true; media.preload = 'none'; }
      media.addEventListener('error', () => { if (alive && mounted === media) missing(); }, { once: true });
      media.addEventListener('load', () => { if (alive) { delete media.dataset.loading; context.event(8, 'image-loaded'); } }, { once: true });
      media.src = src; dom.append(media);
    };
    if (!source || !cleanURL(source)) return missing();
    if (filePath !== undefined) { if (file?.href && cleanURL(file.href)) show(); else missing(); return; }
    if (/^(data|blob):/i.test(source)) { show(); return; }
    let host;
    try { const url = new URL(source, location.href); if (!/^https?:$/.test(url.protocol)) return missing(); host = url.host; }
    catch { return missing(); }
    // No request is made to a model-chosen remote host until the reader says Show, or has said
    // Always for it: the React app's list (lib/shown-hosts.ts), kept in this browser.
    if (host === location.host || shownHosts().includes(host)) { show(); return; }
    dom.className = 'remote';
    const label = document.createElement('span'); label.textContent = `${alt} from ${host}`;
    const always = button(`Always from ${host}`, '', () => { alwaysShow(host); show(); });
    always.title = `Show what is at ${host} without asking, from now on`;
    dom.append(label, button('Show', '', show), always);
  };
  update(node);
  return { dom, update, destroy() { alive = false; mounted?.pause?.(); dom.remove(); } };
}

const SHOWN_HOSTS = 'dc-shown-hosts';
function shownHosts() { try { return (localStorage.getItem(SHOWN_HOSTS) ?? '').split('\n').filter(Boolean); } catch { return []; } }
function alwaysShow(host) {
  try { localStorage.setItem(SHOWN_HOSTS, [...new Set([...shownHosts(), host])].join('\n')); } catch { /* shown this once */ }
}

function rowData(table) {
  const rows = [...table.rows].map(row => [...row.cells].map(cell => (cell.textContent || '').trim()));
  const aligns = [...(table.rows[0]?.cells || [])].map(cell => cell.getAttribute('align') || undefined);
  return { rows, aligns };
}

function key(node) {
  if (node.type === 'text') return 'text';
  if (node.tagName === 'pre') return /(?:^|\s)language-mermaid(?:\s|$)/.test((node.children?.[0]?.properties?.className || []).join(' ')) ? 'fence-mermaid' : 'fence-code';
  if (node.tagName === 'img') return 'picture';
  if (node.tagName === 'blockquote' && node.properties?.dataAlert) return 'alert';
  return node.tagName || 'skip';
}
function remove(record) { record.children?.forEach(remove); record.handle?.destroy(); record.dom.remove(); }

function reconcile(parent, records, nodes, context) {
  const next = [];
  for (const node of nodes) {
    if (node.type !== 'text' && node.type !== 'element') continue;
    // Responsive source URLs bypass the image-consent UI; keep only the picture's img.
    if (node.tagName === 'source') continue;
    const kind = key(node), at = next.length;
    let record = records[at];
    if (!record || record.kind !== kind) {
      if (record) remove(record);
      record = { kind, children: [] };
      if (kind === 'text') record.dom = document.createTextNode('');
      else if (kind === 'fence-code' || kind === 'fence-mermaid') {
        record.dom = document.createElement('div');
        record.handle = kind === 'fence-code' ? block(record.dom, { code: '' }, context.event) : diagram(record.dom, { diagram: '' }, context.event, context.body);
      } else if (kind === 'picture') record.handle = picture(parent, node, context), record.dom = record.handle.dom;
      else if (kind === 'table') {
        record.dom = document.createElement('div'); record.dom.className = 'table';
        record.scroller = document.createElement('div'); record.scroller.className = 'table-scroll';
        record.target = document.createElement('table'); record.scroller.append(record.target);
        const tools = document.createElement('div'); tools.className = 'tools';
        const menu = document.createElement('div'); menu.className = 'table-menu'; menu.hidden = true;
        const copyTable = button('Copy table', 'copy', b => { menu.hidden = !menu.hidden; b.setAttribute('aria-expanded', String(!menu.hidden)); });
        copyTable.setAttribute('aria-expanded', 'false');
        menu.append(...['Markdown', 'CSV'].map(format => button(`Copy as ${format}`, '', b => {
          const { rows, aligns } = rowData(record.target);
          copy(format === 'CSV' ? tableCsv(rows) : tableMarkdown(rows, aligns), copyTable, context.event);
          menu.hidden = true; copyTable.setAttribute('aria-expanded', 'false');
        })));
        tools.append(button('Keep each row on one line', 'wrap', b => { b.setAttribute('aria-pressed', String(record.dom.classList.toggle('one-line'))); }), copyTable, menu);
        tools.addEventListener('focusout', e => { if (!tools.contains(e.relatedTarget)) { menu.hidden = true; copyTable.setAttribute('aria-expanded', 'false'); } });
        tools.addEventListener('keydown', e => { if (e.key === 'Escape') { menu.hidden = true; copyTable.focus(); } });
        record.dom.append(record.scroller, tools);
      } else if (kind === 'alert') {
        record.dom = document.createElement('div'); record.dom.className = 'alert'; record.dom.setAttribute('role', 'note');
        record.title = document.createElement('p'); record.title.className = 'alert-title';
        record.target = document.createElement('div'); record.dom.append(record.title, record.target);
      } else {
        record.dom = document.createElement(kind);
      }
    }
    if (kind === 'text') {
      if (record.dom.data !== node.value) {
        if (node.value.startsWith(record.dom.data)) record.dom.appendData(node.value.slice(record.dom.data.length));
        else record.dom.data = node.value;
      }
    } else if (kind === 'fence-code' || kind === 'fence-mermaid') {
      const language = /(?:^|\s)language-(\S+)/.exec((node.children?.[0]?.properties?.className || []).join(' '))?.[1] || '';
      const code = words(node).replace(/\n$/, '');
      const streaming = context.writing && node.properties?.dataLast !== undefined;
      record.handle.setProps({ code, diagram: code, language, streaming: String(streaming), dark: String(context.body.classList.contains('dark')) });
    } else if (kind === 'picture') record.handle.update(node, context);
    else {
      const target = record.target || record.dom;
      if (kind === 'alert') {
        const alert = node.properties.dataAlert; record.dom.dataset.alert = alert;
        const icon = (alertIcons[alert] || []).map(d => `<path d="${d}"/>`).join('');
        record.title.innerHTML = icon === '' ? '' : `<svg viewBox="0 0 256 256" aria-hidden="true">${icon}</svg>`;
        record.title.append(alert[0].toUpperCase() + alert.slice(1));
      } else attributes(target, node.properties);
      if (kind === 'a') {
        const href = record.dom.getAttribute('href') || '';
        if (!href.startsWith('#')) { record.dom.target = '_blank'; record.dom.rel = 'noreferrer noopener'; }
        record.dom.onclick = event => {
          if (href.startsWith('#')) {
            event.preventDefault();
            let id = href.slice(1); try { id = decodeURIComponent(id); } catch { /* Keep the authored fragment. */ }
            const wanted = id.startsWith(ID_PREFIX) ? id : ID_PREFIX + id;
            [...context.body.querySelectorAll('[id]')].find(el => el.id === wanted)?.scrollIntoView({ block: 'start' });
          } else {
            const path = resolveLink('', href), file = context.files.find(file => file.path === path);
            if (file) { event.preventDefault(); context.event(8, 'file:' + (file.id || file.path)); }
          }
        };
      }
      record.children = reconcile(target, record.children, node.children || [], context);
    }
    const before = parent.childNodes[at]; if (before !== record.dom) parent.insertBefore(record.dom, before || null);
    next.push(record);
  }
  records.slice(next.length).forEach(remove);
  return next;
}

function read(props) {
  const files = JSON.parse(props.files || '[]');
  if (!Array.isArray(files) || files.some(file => !file || typeof file !== 'object' || typeof file.path !== 'string' || (file.id !== undefined && typeof file.id !== 'string') || (file.href !== undefined && typeof file.href !== 'string'))) throw new Error('files must be a JSON array of path, id and href records');
  return files;
}

export function create(element, props, event) {
  const { root, body } = shell(element);
  let current, records = [], alive = true, loaded = false;
  const emit = (kind, payload) => { if (alive) event(kind, payload); };
  const setProps = next => {
    const files = read(next);
    appearance(body, element, next);
    if (current?.text === next.text && current?.streaming === next.streaming && current?.files === next.files && current?.dark === body.classList.contains('dark')) return;
    const tree = parse(next.text || '');
    records = reconcile(body, records, tree.children || [], { body, files, event: (kind, payload) => { if (kind !== 7) emit(kind, payload); }, writing: next.streaming === 'true' && endsInOpenFence(next.text || '') });
    current = { ...next, dark: body.classList.contains('dark') };
    if (!loaded) { loaded = true; emit(7); }
  };
  setProps(props);
  const stop = themes(() => setProps(props));
  return { setProps(next) { setProps(next); props = next; }, destroy() { alive = false; stop(); records.forEach(remove); root.replaceChildren(); } };
}
