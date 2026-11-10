// A Dood's creature as it is looked after: what it has been given and has on, its workspace's
// wardrobe and boxes (`/api/agents/:id/creature`), giving it a treat, opening a box and dressing
// it. The catalogue, rarities and which treat comes next are the protocol's (wardrobe.ts).
import type { Result, Sources } from '../app.contract.d.ts';
import {
  BOX_EVERY_MS,
  type CreatureState,
  hasEverything,
  type Outfit,
  RARITIES,
  rarityOf,
  topTreat,
  WEAR_ITEMS,
  WEAR_SLOTS,
  type WearItem,
  wearItem,
} from '../protocol/wardrobe.ts';
import { current, get, NOBODY, post, put, reply, seg } from './api.ts';

type Creature = Result<'loadCreature'>;
type Thing = Creature['things'][number];

const NONE: Creature = {
  owner: NOBODY, agentId: '', loaded: false, fed: 0, joy: 0, boxes: 0, shared: 0, nextBoxAt: 0, every: BOX_EVERY_MS,
  owned: 0, total: WEAR_ITEMS.length, everything: false, treat: 'cookie', outfit: '{}', hat: '', glasses: '', face: '', neck: '', things: [], rarities: [],
};

/** Which rarity comes where, commonest first: what isn't found yet is shown in that order. */
const rank = (item: WearItem) => RARITIES.findIndex((rarity) => rarity.id === item.rarity);

/**
 * Everything there is to wear, a place at a time, as the wardrobe window lists it: what the
 * workspace has first, in the catalogue's order, then what it has not, commonest first.
 */
function thingsOf(state: CreatureState): Thing[] {
  const owned = new Set(state.owned);
  return WEAR_SLOTS.flatMap((slot) => {
    const here = WEAR_ITEMS.filter((item) => item.slot === slot);
    const ordered = [...here.filter((item) => owned.has(item.id)), ...here.filter((item) => !owned.has(item.id)).sort((a, b) => rank(a) - rank(b))];
    return ordered.map((item) => {
      const rarity = rarityOf(item.rarity);
      return { id: item.id, slot, name: item.name, rarity: rarity.label, color: rarity.color, owned: owned.has(item.id), foundBy: state.foundBy[item.id] ?? '' };
    });
  });
}

function creatureOf(owner: string, agentId: string, state: CreatureState): Creature {
  const outfit = state.outfit ?? {};
  return {
    owner,
    agentId,
    loaded: true,
    fed: state.fed,
    joy: state.joy,
    boxes: state.boxes,
    shared: state.shared,
    nextBoxAt: state.nextBoxAt ?? 0,
    every: BOX_EVERY_MS,
    owned: state.owned.length,
    total: WEAR_ITEMS.length,
    everything: hasEverything(state.owned),
    treat: topTreat(agentId, state),
    outfit: JSON.stringify(outfit),
    hat: outfit.hat ?? '',
    glasses: outfit.glasses ?? '',
    face: outfit.face ?? '',
    neck: outfit.neck ?? '',
    things: thingsOf(state),
    rarities: RARITIES.map((rarity) => ({ id: rarity.id, slot: '', name: rarity.label, rarity: rarity.label, color: rarity.color, owned: false, foundBy: '' })),
  };
}

/** An outfit with one place changed: an id puts that on, "" takes off what is there. */
function changed(outfitJson: string, slot: string, id: string): Outfit {
  const outfit = JSON.parse(outfitJson || '{}') as Outfit;
  const { [slot as keyof Outfit]: _off, ...rest } = outfit;
  return id === '' ? rest : { ...rest, [slot]: id };
}

export const careSources: Pick<Sources, 'loadCreature' | 'feedCreature' | 'openBox' | 'wearThing'> = {
  // Asked while a hatched Dood is open; "" for none.
  loadCreature: async ([owner, agentId], store): Promise<Result<'loadCreature'>> => {
    if (agentId === '' || !current(owner, store)) return NONE;
    return creatureOf(owner, agentId, await get<CreatureState>(store, `/api/agents/${seg(agentId)}/creature`));
  },
  // There is always another treat to give, and all it comes to is the count of them.
  feedCreature: ([agentId], store) => reply(() => post(store, `/api/agents/${seg(agentId)}/creature/feed`)),
  // One of the workspace's boxes, opened by this Dood: what was inside, by its id.
  openBox: async ([agentId], store): Promise<Result<'openBox'>> => {
    let item = '';
    const done = await reply(async () => {
      const { body } = await post<{ item: string }>(store, `/api/agents/${seg(agentId)}/creature/open`);
      item = body.item;
    });
    // A thing this app has not heard of yet is still a thing: it is named, and not drawn.
    const found = wearItem(item);
    const rarity = rarityOf(found?.rarity ?? 'common');
    return { ...done, item, name: found?.name ?? 'Something new', slot: found?.slot ?? 'hat', rarity: rarity.label, color: rarity.color };
  },
  // Put a thing on in its place, or take off what is there, for any Dood of the workspace.
  wearThing: ([agentId, outfit, slot, id], store) => reply(() =>
    put(store, `/api/agents/${seg(agentId)}/creature/outfit`, { outfit: changed(outfit, slot, id) })),
};
