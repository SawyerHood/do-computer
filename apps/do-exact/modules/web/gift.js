import { Creature } from './creature.js';
import { drawing, flag } from './shared.js';
import { RARITIES, wearItem } from './engine.js';

export function create(element, props, event) {
  const creature = new Creature(element, { ...props, pettable: 'false', still: 'false', state: 'idle' }, event);
  const gift = drawing().wardrobe.unwrap(creature.orb, { onPop: () => event(8, 'pop'), onShown: () => event(8, 'shown') });
  const view = {
    props: {},
    setProps(props) {
      const old = this.props;
      // Do not strip the gift when updating a creature's wardrobe.
      creature.setProps({ ...props, pettable: 'false', still: 'false', state: 'idle' });
      creature.orb.paused = false;
      this.props = props;
      const item = wearItem(props.item);
      if (props.open === 'true' && (old.open !== 'true' || props.item !== old.item) && item) {
        gift.open({ id: item.id, tiers: RARITIES.slice(0, RARITIES.findIndex(r => r.id === item.rarity) + 1).map(r => r.color) });
      } else if (flag(props.shake) && !flag(old.shake)) gift.shake();
      else if (!flag(props.shake) && flag(old.shake) && props.open !== 'true') gift.calm();
      creature.orb.update(0); creature.orb.render();
    },
    destroy() { gift.dispose(); creature.destroy(); },
  };
  view.setProps(props); return view;
}
