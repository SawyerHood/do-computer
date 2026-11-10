import { block } from './code.js';
import { shell, appearance, themes, button } from './content-style.js';

let loader, turn = Promise.resolve(), serial = 0;
function hex(body, name) {
  const probe = document.createElement('span'); probe.style.color = `var(${name})`; body.append(probe);
  const color = getComputedStyle(probe).color; probe.remove();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = color; context.fillRect(0, 0, 1, 1);
  return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('');
}
function draw(source, body, live) {
  const next = turn.then(async () => {
    if (!live()) return;
    loader ??= import('./markdown-built/diagram-source.js');
    const { default: mermaid } = await loader;
    if (!live()) return;
    const color = name => hex(body, `--${name}`);
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'base', look: 'classic',
      fontFamily: getComputedStyle(body).fontFamily,
      flowchart: { minNodeWidth: 0, nodeSpacing: 36, rankSpacing: 40, padding: 12 }, state: { minNodeWidth: 0 },
      themeVariables: {
        darkMode: body.classList.contains('dark'), background: color('background'),
        primaryColor: color('surface'), primaryTextColor: color('foreground'), primaryBorderColor: color('input'),
        secondaryColor: color('accent'), secondaryTextColor: color('foreground'), secondaryBorderColor: color('border'),
        tertiaryColor: color('muted'), tertiaryTextColor: color('foreground'), tertiaryBorderColor: color('border'),
        lineColor: color('muted-foreground'), textColor: color('foreground'), titleColor: color('foreground'),
        edgeLabelBackground: color('muted'), noteBkgColor: color('muted'), noteTextColor: color('foreground'),
        noteBorderColor: color('border'), fontSize: '14px',
      },
    });
    // Mermaid needs a connected measuring surface. Own it so parse errors cannot litter the page.
    const scratch = document.createElement('div'); scratch.style.cssText = 'position:absolute;left:-100000px;top:0;opacity:0;pointer-events:none';
    document.body.append(scratch);
    try { return (await mermaid.render(`do-diagram-${++serial}`, source, scratch)).svg; }
    finally { scratch.remove(); }
  });
  turn = next.catch(() => {});
  return next;
}

export function diagram(container, props, event, body) {
  let current = {}, generation = 0, alive = true, svg, asCode = false, failed = false, loaded = false, initialized = false;
  const emit = (kind, payload) => { if (alive) event(kind, payload); };
  const code = block(container, { code: props.diagram || '', language: 'mermaid', streaming: 'true' }, (kind, payload) => { if (kind !== 7) emit(kind, payload); });
  const picture = document.createElement('div'); picture.className = 'diagram';
  picture.setAttribute('role', 'img'); picture.setAttribute('aria-label', 'Diagram');
  const toggle = button('Show the code', 'code', b => { asCode = !asCode; b.setAttribute('aria-label', asCode ? 'Show the diagram' : 'Show the code'); show(); });
  code.head.insertBefore(toggle, code.wrap); code.box.append(picture);
  const show = () => {
    const fallback = current.streaming === 'true' || failed || asCode;
    code.pre.hidden = !fallback; picture.hidden = fallback; toggle.hidden = current.streaming === 'true' || failed;
    code.wrap.hidden = !fallback;
    if (!fallback && !svg) picture.textContent = 'Drawing the diagram…';
  };
  let ready = Promise.resolve();
  const setProps = next => {
    const changed = !initialized || next.diagram !== current.diagram || next.dark !== current.dark || next.streaming !== current.streaming;
    current = next; initialized = true;
    if (!changed) return;
    const version = ++generation; failed = false;
    code.setProps({ code: next.diagram || '', language: 'mermaid', streaming: 'true' }); show();
    const live = () => alive && version === generation;
    ready = (next.streaming === 'true' || !(next.diagram || '').trim() ? Promise.resolve() : draw(next.diagram, body, live).then(drawn => {
      if (!live() || !drawn) return;
      svg = drawn; picture.innerHTML = drawn;
      picture.style.setProperty('--drawn', (/max-width:\s*([\d.]+)px/.exec(drawn)?.[1] || '0') + 'px');
      emit(8, 'diagram');
    }).catch(() => { if (live()) { failed = true; emit(8, 'diagram-fallback'); } })).then(() => {
      if (!live()) return;
      show();
      if (!loaded) { loaded = true; emit(7); }
    });
  };
  setProps(props);
  return { box: code.box, setProps, get ready() { return ready; }, destroy() { alive = false; generation++; code.destroy(); } };
}

export function create(element, props, event) {
  const { root, body } = shell(element);
  let current = props; appearance(body, element, props);
  const view = diagram(body, { ...props, dark: String(body.classList.contains('dark')) }, event, body);
  const update = next => { current = next; appearance(body, element, next); view.setProps({ ...next, dark: String(body.classList.contains('dark')) }); };
  const stop = themes(() => update(current));
  return { setProps: update, destroy() { stop(); view.destroy(); root.replaceChildren(); } };
}
