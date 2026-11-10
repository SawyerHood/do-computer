import { Creature } from './creature.js';
import { drawing, watch, observe, surface, calm, flag, number, look, outfit } from './shared.js';

// The sky places the egg; its drawing stays in the mascot package. This mirrors welcome/Stage.
export function create(element, props, event) {
  const { root, box, canvas } = surface(element);
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const egg = document.createElement('div');
  egg.style.cssText = 'position:absolute;left:0;top:0;width:160px;height:160px';
  box.append(egg);
  const creature = new Creature(egg, { ...props, state: 'egg', side: '160', dark: 'true', still: 'false', slow: 'false', pettable: 'false' }, () => {});
  const sky = drawing().sky.create(canvas, { reduced: calm(props) });
  const view = {
    element, root, box, canvas, props: {}, creature, sky,
    setProps(props) {
      outfit(props);
      const old = this.props;
      this.props = props;
      creature.setProps({ ...props, state: 'egg', side: String(creature.side), dark: 'true', still: 'false', slow: 'false', pettable: 'false' });
      creature.orb.paused = false;
      if (sky) {
        sky.calm = calm(props);
        if (old.dawn !== props.dawn || !this.initialised) sky.dawn(number(props.dawn, 0, 0, 3), sky.calm);
        if (!this.initialised || old.restart !== props.restart) {
          if (!flag(props.hatching)) creature.orb.setState('egg');
          if (props.fall === 'false' || sky.calm) {
            const wasFalling = sky.falling;
            sky.land();
            if (!wasFalling) event(8, 'land');
          } else sky.fall();
        } else if ((props.fall === 'false' && old.fall !== 'false') || (sky.calm && sky.falling)) sky.land();
        if (props.clear !== old.clear) sky.clear(props.clear === undefined ? null : number(props.clear, 0, 0, 1000));
      }
      this.initialised = true; this.resize();
    },
    resize() {
      const rect = element.getBoundingClientRect();
      this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
      sky?.resize(this.width, this.height);
      this.frame(0);
    },
    frame(seconds) {
      if (document.hidden) return;
      if (!sky) {
        egg.style.left = '50%'; egg.style.top = '50%'; egg.style.transform = 'translate(-50%,-50%)'; return;
      }
      sky.step(seconds); sky.render();
      const place = sky.egg(), orb = creature.orb, stance = orb.stance();
      const side = number(String(Math.round(place.heading * this.height / stance.egg / drawing().sky.PIXEL) * drawing().sky.PIXEL), 160, 60, 600);
      egg.style.width = egg.style.height = `${side}px`;
      orb.resize(side); creature.side = side;
      orb.shadow = place.shadow; orb.turn = place.turn;
      const top = Math.max(1 - side, Math.round(place.y - side * stance.ground));
      egg.style.transformOrigin = `50% ${stance.ground * 100}%`;
      egg.style.transform = `translate(${Math.round(place.x - side / 2)}px,${top}px) rotate(${place.lean}deg) scale(${place.part / place.heading})`;
      // The reduced-motion picture still needs the new position and shadow.
      if (orb.reduced) { orb.update(0); orb.render(); }
    },
    destroy() { this.unwatch?.(); this.unobserve?.(); creature.destroy(); sky?.dispose(); root.replaceChildren(); },
  };
  creature.event = (kind, text) => {
    if (text === 'out') { sky?.chips(look(view.props).color); sky?.confetti(); sky?.dawn(3, calm(view.props)); }
    if (kind !== 7) event(kind, text);
  };
  if (sky) sky.onLand = () => event(8, 'land'); else event(8, 'fallback');
  view.setProps(props); view.unobserve = observe(view); view.unwatch = watch(view); event(7); return view;
}
