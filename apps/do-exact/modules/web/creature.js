import { avatarSvg } from './engine.js';
import { drawing, watch, now, flag, number, look, outfit, surface, observe, calm, dark } from './shared.js';

export function create(element, props, event) { return new Creature(element, props, event); }
export class Creature {
  constructor(element, props, event) {
    this.element = element; this.event = event; this.props = {};
    Object.assign(this, surface(element));
    const { core } = drawing();
    this.orb = new core.Orb(this.canvas, { ...look(props), size: number(props.side, 160), reduced: calm(props), dark: dark(props), notice: false });
    core.Runner.add(this.orb, flag(props.slow));
    this.hearts = document.createElement('div'); this.hearts.className = 'hearts'; this.box.append(this.hearts);
    this.hand = { at: -1e9, rubbed: 0, owed: 0, pressed: false, petting: false };
    this.heartAt = -1e9; this.liveHearts = [];
    this.down = e => this.pointer(e, true); this.move = e => this.pointer(e, false);
    this.up = () => { this.hand.pressed = false; };
    this.leave = () => Object.assign(this.hand, { at: -1e9, rubbed: 0, owed: 0, pressed: false, petting: false });
    this.click = e => {
      // Exact handles the authored press; emitting it again would press twice.
      if (this.orb.getState() === 'hatching') this.orb.skipHatch();
      // Agent taps are clicks without pointer input. A real pointer already patted on down.
      if (now() - this.hand.at > 50) this.pet(0, .75);
    };
    element.addEventListener('pointerdown', this.down); element.addEventListener('pointermove', this.move);
    element.addEventListener('pointerup', this.up); element.addEventListener('pointercancel', this.up); element.addEventListener('pointerleave', this.leave);
    element.addEventListener('click', this.click);
    this.setProps(props);
    this.unobserve = observe(this); this.unwatch = watch(this);
    this.event(7);
    this.orb.onAuto = state => { if (this.props.state === 'done') this.event(8, `state:${state}`); };
  }
  setProps(props) {
    // Parse before changing the accepted look: malformed JSON leaves the last aggregate intact.
    const worn = outfit(props), picked = look(props), old = this.props;
    this.props = props;
    const orb = this.orb;
    if (look(old).seed !== picked.seed) orb.setSeed(picked.seed);
    orb.setColor(picked.color); orb.setTheme(dark(props)); orb.reduced = calm(props);
    orb.notice = !flag(props.slow); orb.half = flag(props.slow);
    this.box.style.touchAction = flag(props.pettable) ? 'none' : 'auto';
    const state = props.state === 'asking' ? 'waiting' : props.state || 'idle';
    if (props.state !== old.state || props.variant !== old.variant || !this.initialised) {
      orb.setState((state === 'egg' || drawing().core.STATES.includes(state)) ? state : 'idle', props.variant);
    }
    if (JSON.stringify(worn) !== this.wearing) { drawing().wardrobe.dress(orb, worn); this.wearing = JSON.stringify(worn); }
    this.resize();
    orb.paused = flag(props.still, this.side <= 64) || orb.reduced;
    if (flag(props.hatching) && !flag(old.hatching)) {
      orb.paused = false;
      orb.hatch({ onOut: () => this.event(8, 'out'), onDone: () => { this.event(8, 'hatched'); orb.paused = flag(this.props.still, this.side <= 64) || orb.reduced; } });
    } else if (!flag(props.hatching) && flag(old.hatching)) orb.skipHatch();
    if (props.crack !== old.crack) orb.crack(number(props.crack, 0, 0, 1));
    // Let a held picture reach its expression, as AgentAvatar's still does.
    if (orb.paused) for (let n = 0; n < 12; n++) orb.update(1 / 30);
    orb.update(0); orb.render();
    this.fallback(picked);
    this.initialised = true;
  }
  fallback(picked) {
    if (!this.orb.owed) { this.fallbackImage?.remove(); return; }
    if (!this.fallbackImage) { this.fallbackImage = document.createElement('img'); this.box.prepend(this.fallbackImage); }
    this.fallbackImage.src = 'data:image/svg+xml,' + encodeURIComponent(avatarSvg({ seed: picked.seed, color: this.props.colour || this.props.color || 'clay' }, picked.seed));
    this.fallbackImage.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    this.event(8, 'fallback');
  }
  resize() {
    const rect = this.element.getBoundingClientRect();
    this.side = number(this.props.side, Math.min(rect.width || 160, rect.height || rect.width || 160), 16, 600);
    this.orb.resize(this.side);
    if (this.orb.getState() !== 'hatching') this.orb.paused = flag(this.props.still, this.side <= 64) || this.orb.reduced;
    this.orb.rect = null;
    this.orb.render();
  }
  pointer(e, pressed) {
    if (['egg', 'hatching'].includes(this.orb.getState())) return;
    const rect = this.element.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - .5, y = (e.clientY - rect.top) / rect.height - .5;
    if (this.orb.notice) this.orb.attend(x * 2, -y * 2, 1);
    if (!flag(this.props.pettable) || Math.hypot(x, y) > .44) return;
    const hand = this.hand, at = now();
    if (pressed) Object.assign(hand, { pressed: true, petting: true, owed: 0 });
    else if (at - hand.at > 450) Object.assign(hand, { rubbed: 0, owed: 0, petting: hand.pressed });
    else { const moved = Math.hypot(e.clientX - hand.x, e.clientY - hand.y) / rect.width; hand.rubbed += moved; hand.owed += moved; }
    Object.assign(hand, { x: e.clientX, y: e.clientY, at });
    if (hand.rubbed >= .9) hand.petting = true;
    if (pressed || (hand.petting && hand.owed >= .14)) { hand.owed = 0; this.pet(x / .44, pressed ? .75 : 1, x + .5, y + .5); }
    if (this.orb.notice) this.orb.attend(x * 2, -y * 2, 1);
  }
  pet(x, amount, left = .5, top = .5) {
    if (!flag(this.props.pettable) || ['egg', 'hatching'].includes(this.orb.getState())) return;
    this.orb.pet(x, amount);
    if (now() - this.heartAt < 380) return;
    this.heartAt = now();
    this.event(8, 'pet');
    const heart = document.createElement('span'); heart.className = 'heart'; heart.textContent = '♥'; heart.style.left = `${left * 100}%`; heart.style.top = `${top * 100}%`;
    this.hearts.append(heart); this.liveHearts.push({ element: heart, at: now() });
    if (this.liveHearts.length > 8) this.liveHearts.shift().element.remove();
  }
  frame(seconds, time) {
    if (document.hidden) return;
    for (const heart of [...this.liveHearts]) {
      const age = (time - heart.at) / 1000;
      if (age > 1.2) { heart.element.remove(); this.liveHearts.splice(this.liveHearts.indexOf(heart), 1); continue; }
      heart.element.style.opacity = String(1 - age / 1.2);
      heart.element.style.transform = this.orb.reduced ? 'none' : `translate(-50%,${-age * 50}px)`;
    }
  }
  destroy() {
    if (this.gone) return; this.gone = true;
    this.unwatch?.(); this.unobserve?.(); this.orb.dispose();
    for (const [kind, fn] of [['pointerdown', this.down], ['pointermove', this.move], ['pointerup', this.up], ['pointercancel', this.up], ['pointerleave', this.leave], ['click', this.click]]) this.element.removeEventListener(kind, fn);
    this.root.replaceChildren();
  }
}
