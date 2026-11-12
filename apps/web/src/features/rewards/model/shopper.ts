import { needRequestSchema, type Taste } from '@moviq/contracts';

/** What Sara may tell the merchants: an alias and the tastes, kept on this device only. */
export interface Shopper {
  readonly alias: string;
  readonly taste: Taste;
}

const KEY = 'moviq-shopper';
const shopperSchema = needRequestSchema.pick({ alias: true, taste: true });

/** Nothing ruled out until the traveller says so; no spice, so a merchant asks when it matters. */
const NO_TASTES: Taste = {
  allergies: [],
  avoid: [],
  noAlcohol: false,
  diet: 'any',
  drink: null,
  spice: null,
};

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The alias and tastes saved on this device, or the first ones in the traveller's language. */
export function readShopper(store: Store, lang: 'en' | 'es'): Shopper {
  const fallback = { alias: lang === 'es' ? 'Viajera' : 'Traveller', taste: NO_TASTES };
  try {
    const parsed = shopperSchema.safeParse(JSON.parse(store.getItem(KEY) ?? 'null'));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/** Saves the shopper if the contract accepts it; false otherwise, and nothing is kept. */
export function saveShopper(store: Store, shopper: Shopper): boolean {
  const parsed = shopperSchema.safeParse(shopper);
  if (!parsed.success) return false;
  try {
    store.setItem(KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

/** The browser's storage, or none (private windows may refuse it). */
export function deviceStore(): Store {
  try {
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}
