// The browser owns the destination; a Blob keeps cross-origin downloads as files, not tabs.
export function create(element, props, event) {
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  const button = document.createElement('button');
  button.textContent = 'Download';
  button.style.cssText = 'font:inherit;color:inherit;background:transparent;border:0;padding:6px 10px;cursor:pointer;width:100%;text-align:start';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  root.append(button, status);
  let latest = props, dead = false;
  const click = async () => {
    button.disabled = true; status.textContent = '';
    try {
      const url = new URL(latest.address);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid download address');
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not download. Try again.');
      const blob = await response.blob();
      if (dead) return;
      const address = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = address; a.download = latest.filename || 'download'; a.click();
      setTimeout(() => URL.revokeObjectURL(address), 1000);
      event(8, 'downloaded');
    } catch (e) { if (!dead) { status.textContent = e.message; event(8, `error:${e.message}`); } }
    finally { if (!dead) button.disabled = false; }
  };
  button.addEventListener('click', click);
  event(7);
  return { setProps(next) { latest = next; }, destroy() { dead = true; button.removeEventListener('click', click); root.replaceChildren(); } };
}
