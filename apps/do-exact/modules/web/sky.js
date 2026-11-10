import { Creature } from './creature.js';
import { drawing, watch, observe, surface, calm, flag, number, look, outfit, now } from './shared.js';
import { AVATAR_COLORS } from './engine.js';

/** How long the creature takes from the island to its place in the chat (welcome/scene.tsx FLIGHT_MS). */
const FLIGHT_MS = 950;
/** How long the sky takes to go once the scene is over, and how long a place to land is looked for. */
const FADE_MS = 700;
const LOOK_MS = 5000;

// The sky places the egg; its drawing stays in the mascot package. This mirrors welcome/Stage.
export function create(element, props, event) {
  const { root, box, canvas } = surface(element);
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const egg = document.createElement('div');
  egg.style.cssText = 'position:absolute;left:0;top:0;width:160px;height:160px';
  box.append(egg);
  // Out of its egg it does what the caller says; until then it is an egg.
  const creatureProps = props => ({
    ...props, state: flag(props.out) ? props.state || 'idle' : 'egg', side: String(creature?.side ?? 160), dark: 'true', still: 'false', slow: 'false', pettable: 'false',
    // The counters below are the sky's to interpret, not the creature's.
    talk: undefined, cheer: undefined, feed: undefined, key: undefined,
  });
  let creature;
  creature = new Creature(egg, creatureProps(props), () => {});
  const sky = drawing().sky.create(canvas, { reduced: calm(props) });
  const view = {
    element, root, box, canvas, props: {}, creature, sky,
    setProps(props) {
      outfit(props);
      const old = this.props;
      this.props = props;
      creature.setProps(creatureProps(props));
      creature.orb.paused = false;
      const orb = creature.orb;
      if (sky) {
        sky.calm = calm(props);
        if (old.dawn !== props.dawn || !this.initialised) sky.dawn(number(props.dawn, 0, 0, 3), sky.calm);
        if (!this.initialised || old.restart !== props.restart) {
          if (!flag(props.hatching) && !flag(props.out)) orb.setState('egg');
          if (props.fall === 'false' || sky.calm) {
            const wasFalling = sky.falling;
            sky.land();
            if (!wasFalling) event(8, 'land');
          } else sky.fall();
        } else if ((props.fall === 'false' && old.fall !== 'false') || (sky.calm && sky.falling)) sky.land();
        if (props.clear !== old.clear) sky.clear(props.clear === undefined ? null : number(props.clear, 0, 0, 1000));
        // Each answer cracks the shell a little more, with bits of it in the colour picked.
        if (this.initialised && props.crack !== old.crack && number(props.crack, 0, 0, 1) > number(old.crack, 0, 0, 1)) sky.chips(look(props).color);
      }
      if (this.initialised) {
        // A colour was picked: it is patted, and the light comes up about it.
        if (props.glow !== old.glow && props.glow) { orb.pet(1); sky?.glow(0.6); }
        if (props.cheer !== old.cheer && props.cheer) orb.cheer();
        // A letter of what it says: out, it talks with its whole self; an egg can only rock.
        if (props.talk !== old.talk && props.talk) {
          const count = number(props.talk, 0, 0, 1e9);
          if (flag(props.out)) orb.feed('token');
          else if (count % 14 === 1) orb.pet(count % 28 === 1 ? 1 : -1);
        }
        if (props.fly && props.fly !== old.fly) this.leave(props.fly);
      }
      orb.notice = flag(props.out);
      this.initialised = true; this.resize();
    },
    resize() {
      const rect = element.getBoundingClientRect();
      this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
      sky?.resize(this.width, this.height);
      this.frame(0);
    },
    // The scene is over: the sky goes, and the creature goes to where the page's own picture of
    // it is (the element with that test id), and comes to be that one's size (Stage.fly).
    leave(target) {
      canvas.style.transition = `opacity ${FADE_MS}ms`;
      canvas.style.opacity = '0';
      this.flight = { target, since: now(), last: null };
    },
    fly(seconds, time) {
      const flight = this.flight;
      if (flight.from) {
        const t = Math.min(1, (time - flight.started) / FLIGHT_MS), k = ease(t), { from, to } = flight;
        const at = (a, b) => a + (b - a) * k;
        egg.style.transformOrigin = '0 0';
        egg.style.transform = `translate(${at(from.left, to.left)}px,${at(from.top, to.top)}px) scale(${at(from.width, to.width) / creature.side})`;
        if (t >= 1 && !flight.done) { flight.done = true; event(8, 'flown'); }
        return;
      }
      // Where it goes is looked for until it has stopped moving about, as welcome's `landing` does.
      const found = document.querySelector(`[data-testid="${CSS.escape(flight.target)}"]`);
      const rect = found?.getBoundingClientRect(), base = element.getBoundingClientRect();
      // The page's picture is drawn 12% past its box (do-creature `overscan`), and so is this one.
      const there = rect && rect.width > 0 ? { left: rect.left - base.left - rect.width * 0.12, top: rect.top - base.top - rect.width * 0.12, width: rect.width * 1.24 } : null;
      const still = there && flight.last && there.left === flight.last.left && there.top === flight.last.top;
      flight.last = there;
      if (still || time - flight.since > LOOK_MS) {
        const now = egg.getBoundingClientRect();
        flight.from = { left: now.left - base.left, top: now.top - base.top, width: now.width };
        flight.to = there ?? flight.from;
        flight.started = time;
      }
    },
    frame(seconds, time = now()) {
      if (document.hidden) return;
      if (this.flight) {
        sky?.step(seconds); sky?.render();
        return this.fly(seconds, time);
      }
      if (!sky) {
        egg.style.left = '50%'; egg.style.top = '50%'; egg.style.transform = 'translate(-50%,-50%)'; return;
      }
      // The card under the egg: the view keeps the egg clear of it while it shows (Stage.card).
      const card = this.props.card ? document.querySelector(`[data-testid="${CSS.escape(this.props.card)}"]`) : null;
      if (card && this.props.clear === undefined) {
        const top = card.getBoundingClientRect().top - element.getBoundingClientRect().top;
        if (Math.abs(top - (this.cardTop ?? -1)) > 0.5) { this.cardTop = top; sky.clear(top); }
      } else if (this.cardTop !== undefined && this.props.clear === undefined) { this.cardTop = undefined; sky.clear(null); }
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
    // A click on the scene brings the egg down at once, and a touch on the creature makes it hop.
    click(e) {
      if (this.flight || !sky) return;
      if (sky.falling) return sky.land();
      const rect = egg.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
      if (x > 0.25 && x < 0.75 && y > 0.2 && y < 1) creature.orb.cheer();
    },
    destroy() { element.removeEventListener('click', onClick); this.unwatch?.(); this.unobserve?.(); creature.destroy(); sky?.dispose(); root.replaceChildren(); },
  };
  const onClick = e => view.click(e);
  element.addEventListener('click', onClick);
  creature.event = (kind, text) => {
    if (text === 'out') {
      sky?.flash(0.55); sky?.dawn(3, calm(view.props)); sky?.bump(0.9);
      sky?.confetti(AVATAR_COLORS.map(color => color.hex));
    }
    if (kind !== 7) event(kind, text);
  };
  if (sky) sky.onLand = () => event(8, 'land'); else event(8, 'fallback');
  view.setProps(props); view.unobserve = observe(view); view.unwatch = watch(view); event(7); return view;
}

// welcome/stage.ts's cubic-bezier(0.55, 0, 0.2, 1), near enough: slow out, quick across, slow in.
function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
