// Slack needs a PNG, not the live canvas. Render one pose, then hand the file to the browser.
import { drawing, look, outfit, standIn } from './shared.js';
export function create(element, props, event) {
  let previous = props.ticket, gone = false;
  async function save(p) {
    let orb;
    try {
      const side = 1024, picked = look(p), canvas = document.createElement('canvas');
      canvas.width = canvas.height = side;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot draw the picture.');
      const channel = at => Math.round(255 + (parseInt(picked.color.slice(at, at + 2), 16) - 255) * .2);
      context.fillStyle = `rgb(${channel(1)} ${channel(3)} ${channel(5)})`;
      context.fillRect(0, 0, side, side);
      const sketch = document.createElement('canvas'), engine = drawing();
      orb = new engine.core.Orb(sketch, { ...picked, size: side, pixelRatio: 1, dark: false, notice: false });
      engine.wardrobe.dress(orb, outfit(p));
      orb.setState('idle');
      for (let n = 0; n < 45; n++) orb.update(1 / 30);
      orb.render();
      if (orb.owed) {
        const image = new Image(); image.src = standIn(picked); await image.decode();
        context.drawImage(image, side * .1, side * .1, side * .8, side * .8);
      } else {
        context.imageSmoothingEnabled = false;
        context.drawImage(sketch, 0, 0, side, side);
      }
      const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('The picture could not be made.')), 'image/png'));
      if (gone) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${(p.botname || 'dood').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dood'}.png`;
      link.click();
      // A download has already taken the blob when the next Exact clock turn runs.
      const release = globalThis.exact?.hatches?.after;
      if (release) release(10000, () => URL.revokeObjectURL(url)); else URL.revokeObjectURL(url);
      event(8, 'Picture downloaded.');
    } catch (error) {
      if (!gone) event(8, error instanceof Error ? error.message : 'The picture could not be made.');
    } finally { orb?.dispose(); }
  }
  return {
    setProps(p) { if (p.ticket !== previous) { previous = p.ticket; if (Number(p.ticket) > 0) void save(p); } },
    destroy() { gone = true; element.replaceChildren(); },
  };
}
