import { drawing, watch, now, flag, number, look, outfit, surface, observe, calm, dark, standIn } from './shared.js';

export function create(element, props, event) { return new Creature(element, props, event); }
export class Creature {
  constructor(element, props, event) {
    outfit(props);
    this.element = element; this.event = event; this.props = {};
    Object.assign(this, surface(element));
    const { core } = drawing();
    this.orb = new core.Orb(this.canvas, { ...look(props), size: number(props.side, 160), reduced: calm(props), dark: dark(props), notice: false });
    core.Runner.add(this.orb, flag(props.slow));
    this.hearts = document.createElement('div'); this.hearts.className = 'hearts'; this.box.append(this.hearts);
    // Hearts and crumbs rise and fall past the picture's edge, as React's do past its span.
    this.box.style.overflow = 'visible';
    // What is still to come of a treat being eaten, on Exact's clock.
    this.timeline = []; this.crumbs = [];
    this.hand = { at: -1e9, rubbed: 0, owed: 0, pressed: false, petting: false };
    this.heartAt = -1e9; this.liveHearts = [];
    this.down = e => this.pointer(e, true); this.move = e => this.pointer(e, false);
    this.up = () => { this.hand.pressed = false; };
    this.leave = () => Object.assign(this.hand, { at: -1e9, rubbed: 0, owed: 0, pressed: false, petting: false });
    this.click = () => {
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
    // Counters the caller bumps for one-off acts: each change is one more of it.
    if (this.initialised) {
      if (props.feed !== old.feed && props.feed) this.eat(props.crumb);
      if (props.cheer !== old.cheer && props.cheer) { orb.paused = false; orb.cheer(); }
      if (props.talk !== old.talk && props.talk) { orb.paused = false; orb.feed('token'); }
      if (props.key !== old.key && props.key) { orb.paused = false; orb.feed('key'); }
      // A treat held out near its mouth: it opens for it, and closes when it is taken away.
      if (props.offer !== old.offer && !this.timeline.length) { orb.paused = false; orb.offer(flag(props.offer)); }
    }
    // Let a held picture reach its expression, as AgentAvatar's still does.
    if (orb.paused) for (let n = 0; n < 12; n++) orb.update(1 / 30);
    orb.update(0); orb.render();
    this.fallback(picked);
    this.initialised = true;
  }
  fallback(picked) {
    if (!this.orb.owed) { this.fallbackImage?.remove(); this.fallbackImage = null; this.canvas.style.visibility = ''; this.failed = false; return; }
    if (!this.fallbackImage) { this.fallbackImage = document.createElement('img'); this.box.prepend(this.fallbackImage); }
    this.fallbackImage.src = standIn(picked);
    this.canvas.style.visibility = 'hidden';
    this.fallbackImage.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    if (!this.failed) this.event(8, 'fallback');
    this.failed = true;
  }
  resize() {
    if (this.gone) return;
    const rect = this.element.getBoundingClientRect();
    this.side = number(this.props.side, Math.min(rect.width || 160, rect.height || rect.width || 160), 16, 600);
    // Drawn a little past its box, as AgentAvatar's canvas is: room for hops and rings.
    const over = flag(this.props.overscan);
    this.canvas.style.cssText = over ? 'position:absolute;left:-12%;top:-12%;width:124%;height:124%;max-width:none;max-height:none' : '';
    this.orb.resize(over ? Math.min(600, Math.round(this.side * 1.24)) : this.side);
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
  }
  pet(x, amount, left = .5, top = .5) {
    if (!flag(this.props.pettable) || ['egg', 'hatching'].includes(this.orb.getState())) return;
    this.orb.pet(x, amount);
    if (now() - this.heartAt < 380) return;
    this.heartAt = now();
    this.event(8, 'pet');
    this.heart(left, top, (this.heartCount = (this.heartCount ?? 0) + 1) % 2 ? 1 : -1);
  }
  // React's PetHeart: the creature's blocky heart, rising from the hand and fading.
  heart(left, top, drift) {
    const heart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    heart.setAttribute('viewBox', '0 0 7 6'); heart.setAttribute('shape-rendering', 'crispEdges'); heart.setAttribute('class', 'heart');
    heart.innerHTML = '<path fill="#ff6b8e" d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z"/><path fill="#ffd0db" d="M1 1h1v1H1z"/>';
    heart.style.left = `${left * 100}%`; heart.style.top = `${top * 100}%`; heart.style.opacity = '0';
    this.hearts.append(heart); this.liveHearts.push({ element: heart, at: now(), drift: drift * (0.5 + Math.random()) });
    if (this.liveHearts.length > 8) this.liveHearts.shift().element.remove();
  }
  // A treat at its mouth: it opens for it, takes three bites, and is pleased (care.tsx useTreats).
  eat(crumb) {
    const orb = this.orb, at = now();
    orb.paused = false; orb.offer(true);
    for (let bite = 1; bite <= 3; bite++) this.timeline.push({ at: at + bite * 300, act: () => { orb.bite(); this.crumble(crumb); } });
    this.timeline.push({ at: at + 3.8 * 300, act: () => {
      orb.offer(false); orb.cheer();
      [0.3, 0.52, 0.72].forEach((x, index) => this.heart(x, 0.3 - 0.06 * (index % 2), index - 1));
    } });
  }
  crumble(color) {
    if (this.orb.reduced) return;
    for (let n = 0; n < 4; n++) {
      const angle = Math.random() * Math.PI, bit = document.createElement('span');
      bit.style.cssText = `position:absolute;left:50%;top:70%;width:4px;height:4px;background:${/^#[\da-f]{3,8}$/i.test(color || '') ? color : '#d3cdbb'}`;
      this.hearts.append(bit);
      this.crumbs.push({ element: bit, at: now(), dx: Math.round(Math.cos(angle) * 34), dy: Math.round(Math.sin(angle) * 18 + 26) });
    }
  }
  frame(seconds, time) {
    if (document.hidden) return;
    if (this.orb.owed !== !!this.failed) this.fallback(look(this.props));
    while (this.timeline.length && this.timeline[0].at <= time) this.timeline.shift().act();
    for (const heart of [...this.liveHearts]) {
      const age = (time - heart.at) / 1100;
      if (age >= 1) { heart.element.remove(); this.liveHearts.splice(this.liveHearts.indexOf(heart), 1); continue; }
      heart.element.style.opacity = String(heartOpacity(age));
      heart.element.style.transform = heartPlace(age, heart.drift, this.orb.reduced);
    }
    for (const bit of [...this.crumbs]) {
      const age = (time - bit.at) / 550;
      if (age >= 1) { bit.element.remove(); this.crumbs.splice(this.crumbs.indexOf(bit), 1); continue; }
      const eased = 1 - (1 - age) * (1 - age);
      bit.element.style.opacity = String(1 - age);
      bit.element.style.transform = `translate(${bit.dx * eased}px,${bit.dy * eased}px)`;
    }
  }
  destroy() {
    if (this.gone) return; this.gone = true;
    this.unwatch?.(); this.unobserve?.(); this.orb.dispose();
    for (const [kind, fn] of [['pointerdown', this.down], ['pointermove', this.move], ['pointerup', this.up], ['pointercancel', this.up], ['pointerleave', this.leave], ['click', this.click]]) this.element.removeEventListener(kind, fn);
    this.root.replaceChildren();
  }
}

// The pet-heart keyframes of apps/web/src/styles.css, stepped as they are there (steps(14)).
function heartOpacity(age) {
  const t = Math.floor(age * 14) / 14;
  return t < 0.2 ? t / 0.2 : t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
}
function heartPlace(age, drift, reduced) {
  if (reduced) return 'translate(-50%,-130%)';
  const t = Math.floor(age * 14) / 14, mix = (a, b, k) => a + (b - a) * k;
  const [x, y, scale] = t < 0.2
    ? [mix(0, drift * 12, t / 0.2), mix(-60, -130, t / 0.2), mix(0.4, 1, t / 0.2)]
    : [mix(drift * 12, drift * 60, (t - 0.2) / 0.8), mix(-130, -420, (t - 0.2) / 0.8), mix(1, 0.85, (t - 0.2) / 0.8)];
  return `translate(calc(-50% + ${x}%),${y}%) scale(${scale})`;
}
