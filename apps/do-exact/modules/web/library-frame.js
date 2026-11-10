// This hatch only speaks to the mounted sandboxed frame, never to other windows.
export function create(element, props, event) {
  let frame, latest = props;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const tell = () => {
    const scheme = getComputedStyle(element).colorScheme.trim();
    const appearance = scheme === 'dark' || (scheme !== 'light' && media.matches) ? 'dark' : 'light';
    frame?.contentWindow?.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: appearance, styles: { variables: latest.colour ? { '--agent-color': latest.colour } : {} } } }, '*');
  };
  const find = () => {
    const next = element.parentElement?.querySelector('#library-page');
    if (frame === next) return;
    frame?.removeEventListener('load', tell);
    frame = next;
    frame?.addEventListener('load', tell);
    tell();
  };
  const heard = e => {
    if (e.source !== frame?.contentWindow || e.data?.type !== 'dc-library-open' || typeof e.data.path !== 'string') return;
    event(8, e.data.path);
  };
  const observer = new MutationObserver(find);
  observer.observe(document.body, { childList: true, subtree: true });
  const colors = new MutationObserver(tell);
  colors.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  window.addEventListener('message', heard);
  media.addEventListener('change', tell);
  find();
  event(7);
  return { setProps(next) { latest = next; find(); tell(); }, destroy() { observer.disconnect(); colors.disconnect(); media.removeEventListener('change', tell); window.removeEventListener('message', heard); frame?.removeEventListener('load', tell); } };
}
