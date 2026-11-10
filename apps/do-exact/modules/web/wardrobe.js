import { create as creature } from './creature.js';
import { wearItem } from './engine.js';

// A wardrobe tile uses the same creature and garment geometry as the chat.
export function create(element, props, event) {
  const itemProps = props => {
    const item = wearItem(props.item);
    return { ...props, ...(item ? { [item.slot]: item.id } : {}), still: 'true', pettable: 'false', state: 'idle' };
  };
  const view = creature(element, itemProps(props), event);
  const set = view.setProps.bind(view);
  view.setProps = props => set(itemProps(props));
  return view;
}
