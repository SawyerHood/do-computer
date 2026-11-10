// Creature-only pages (and their small gallery) do not need the rich-content bundle tree.
function lazy(load) {
  return { create(element, props, event) {
    let view, fallback, current = props, alive = true;
    load().then(module => {
      if (alive) view = module.create(element, current, event);
    }).catch(error => {
      if (!alive) return;
      const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
      fallback = document.createElement('pre');
      fallback.style.cssText = 'margin:0;white-space:pre-wrap;overflow-wrap:break-word';
      fallback.textContent = current.text || current.code || current.diagram || '';
      root.replaceChildren(fallback);
      console.warn('Rich content unavailable:', error);
      event(8, 'content-unavailable'); event(7);
    });
    return {
      setProps(next) {
        if (!alive) return;
        view?.setProps(next); current = next;
        if (fallback) fallback.textContent = next.text || next.code || next.diagram || '';
      },
      destroy() { alive = false; view?.destroy(); },
    };
  } };
}
export const markdown = lazy(() => import('./markdown.js'));
export const code = lazy(() => import('./code.js'));
export const mermaid = lazy(() => import('./mermaid.js'));
