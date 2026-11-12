const KEY = 'moviq-trips';

/** The trips kept at most; past this the oldest is forgotten. */
export const MAX_SAVED_TRIPS = 20;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export interface SavedTrips {
  /** The ids of the trips started in this browser, newest first. */
  readonly list: () => string[];
  /** Puts a trip first; a trip already kept moves to the front. */
  readonly remember: (id: string) => void;
  /** Forgets a trip the server no longer gives to this traveller. */
  readonly forget: (id: string) => void;
}

const isId = (value: unknown): value is string => typeof value === 'string' && value !== '';

function read(storage: Store): string[] {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const items: unknown[] = value;
    return [...new Set(items.filter(isId))].slice(0, MAX_SAVED_TRIPS);
  } catch {
    // Unreadable or blocked: as if nothing had been kept.
    return [];
  }
}

function write(storage: Store, ids: readonly string[]): void {
  try {
    storage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Full or blocked: the trips of this visit are still shown from the server.
  }
}

/**
 * The ids of the trips started in this browser. The server has no list of a traveller's trips,
 * so each one is asked for by its id; only ids are kept here, never the trip itself.
 */
export function createSavedTrips(storage: Store | null): SavedTrips {
  const list = (): string[] => (storage === null ? [] : read(storage));
  return {
    list,
    remember(id) {
      if (storage === null || !isId(id)) return;
      write(storage, [id, ...list().filter((kept) => kept !== id)].slice(0, MAX_SAVED_TRIPS));
    },
    forget(id) {
      if (storage === null) return;
      write(
        storage,
        list().filter((kept) => kept !== id),
      );
    },
  };
}

function browserStorage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const savedTrips = createSavedTrips(browserStorage());
