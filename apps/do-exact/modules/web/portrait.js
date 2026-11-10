import { drawing, number, look, outfit, surface, observe, flag, standIn } from './shared.js';

// A still of the actual island, not a second moving sky for every player card.
export function create(element, props, event) {
  const view = {
    element, event, ...surface(element),
    setProps(props) { outfit(props); this.props = props; this.resize(); },
    resize() {
      const props = this.props, { portrait, wardrobe } = drawing(), picked = look(props), worn = outfit(props);
      const grid = number(props.grid, 120, 32, 256);
      const key = JSON.stringify([grid, props.hour, props.zoom, props.egg, props.island, picked, worn]);
      if (key === this.key) return;
      this.key = key;
      const options = { grid, hour: number(props.hour, 2, 0, 3), zoom: number(props.zoom, 1, .2, 1) };
      const island = props.island !== 'false' && portrait.island(options);
      const where = island || portrait.backdrop({ ...options, color: picked.color });
      const picture = portrait.tile(where, { ...picked, egg: flag(props.egg), dress: orb => wardrobe.dress(orb, worn) });
      this.canvas.width = grid; this.canvas.height = grid;
      this.canvas.getContext('2d').drawImage(picture, 0, 0);
      if (!island && props.island !== 'false') this.event(8, 'backdrop');
      if (!drawing().core.Stage.get('px')) {
        this.fallbackImage ??= document.createElement('img');
        this.fallbackImage.src = standIn(picked);
        this.fallbackImage.style.cssText = 'position:absolute;left:15%;top:10%;width:70%;height:70%';
        this.box.append(this.fallbackImage);
        this.event(8, 'fallback');
      } else { this.fallbackImage?.remove(); this.fallbackImage = null; }
    },
    destroy() { this.unobserve?.(); this.root.replaceChildren(); },
  };
  view.setProps(props); view.unobserve = observe(view); event(7); return view;
}
