import { shell, appearance, themes, button, copy } from './content-style.js';

const remembered = new Map();
let highlighter;
async function highlight(code, language) {
  if (!language || code.length > 80_000) return;
  const key = `${language}\n${code}`;
  if (remembered.has(key)) return remembered.get(key);
  highlighter ??= import('./markdown-built/highlight-source.js');
  const tokens = await (await highlighter).tokensOf(code, language);
  if (tokens) {
    remembered.set(key, tokens);
    if (remembered.size > 200) remembered.delete(remembered.keys().next().value);
  }
  return tokens;
}

// The same block is used inside a message and by the standalone native tag.
export function block(container, props, event) {
  const box = document.createElement('div'); box.className = 'code';
  const head = document.createElement('div'); head.className = 'head';
  const label = document.createElement('span'); label.className = 'language';
  const pre = document.createElement('pre');
  const code = document.createElement('code'); pre.append(code);
  const wrap = button('Wrap long lines', 'wrap', b => {
    const on = pre.classList.toggle('wrap'); b.setAttribute('aria-pressed', String(on));
  });
  wrap.setAttribute('aria-pressed', 'false');
  const copyIt = button('Copy code', 'copy', b => copy(current.code || '', b, emit));
  head.append(label, wrap, copyIt); box.append(head, pre); container.append(box);
  let current = {}, generation = 0, alive = true, loaded = false, initialized = false;
  const emit = (kind, value) => { if (alive) event(kind, value); };
  let ready = Promise.resolve();
  const setProps = next => {
    const old = current; current = next;
    label.textContent = next.language || '';
    box.dataset.language = next.language || '';
    if (initialized && old.code === next.code && old.language === next.language && old.streaming === next.streaming) return;
    initialized = true;
    const version = ++generation;
    const value = next.code || '';
    copyIt.setAttribute('aria-label', 'Copy code'); copyIt.title = 'Copy code';
    // Updating a text node, rather than replacing the pre, keeps selection and scroll while writing.
    if (code.childNodes.length === 1 && code.firstChild.nodeType === Node.TEXT_NODE) {
      const text = code.firstChild;
      if (value.startsWith(text.data)) text.appendData(value.slice(text.data.length));
      else text.data = value;
    }
    else code.replaceChildren(document.createTextNode(value));
    ready = (next.streaming === 'true' ? Promise.resolve() : highlight(value, next.language || '')).then(tokens => {
      if (!alive || version !== generation) return;
      if (tokens) {
        const fragment = document.createDocumentFragment();
        tokens.forEach((line, at) => {
          if (at) fragment.append('\n');
          for (const token of line) {
            const part = document.createElement('span'); part.textContent = token.text;
            if (token.color) part.style.color = token.color;
            if (token.italic) part.style.fontStyle = 'italic';
            fragment.append(part);
          }
        });
        code.replaceChildren(fragment);
        emit(8, 'highlighted');
      }
    }).catch(() => { /* Plain code is still readable when a grammar fails. */ }).then(() => {
      if (alive && version === generation && !loaded) { loaded = true; emit(7); }
    });
  };
  setProps(props);
  return { box, head, pre, code, label, wrap, setProps, get props() { return current; }, get ready() { return ready; }, destroy() { alive = false; generation++; box.remove(); } };
}

export function create(element, props, event) {
  const { root, body } = shell(element);
  appearance(body, element, props);
  const view = block(body, props, event);
  let current = props;
  const stop = themes(() => appearance(body, element, current));
  return {
    setProps(next) { appearance(body, element, next); view.setProps(next); current = next; },
    destroy() { stop(); view.destroy(); root.replaceChildren(); },
  };
}
