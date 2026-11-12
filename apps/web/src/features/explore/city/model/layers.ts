import type { BoundingBox, CityGroup, CityItem, CityLayerId } from '@moviq/contracts';

/** The groups of the panel under the modes of transport, in their order. */
export const CITY_GROUPS = [
  'street',
  'places',
  'harbor',
  'weather',
] as const satisfies readonly CityGroup[];

/** City layers start off until the traveller enables them. */
export const FIRST_ON: ReadonlySet<CityLayerId> = new Set();

/**
 * The widest box, in degrees of longitude, a dense layer is asked for: parking meters and signs
 * need a street in view, and the signs are asked by tile of 1,000 feet.
 */
const WIDEST: Partial<Record<CityLayerId, number>> = {
  'parking-meters': 0.06,
  'parking-signs': 0.02,
};

const widthOf = (box: BoundingBox) => box[2] - box[0];

/** False while the map is too far out for a dense layer: it is asked once the traveller zooms. */
export function askable(layer: CityLayerId, box: BoundingBox): boolean {
  const widest = WIDEST[layer];
  return widest === undefined || widthOf(box) <= widest;
}

/** The parking signs come from their own route, by tile, not from the layers answer. */
const OWN_ROUTE: ReadonlySet<CityLayerId> = new Set(['parking-signs']);

/** The layers asked of `/api/city/layers`: those on, and near enough when they are dense. */
export function layersToAsk(on: ReadonlySet<CityLayerId>, box: BoundingBox): CityLayerId[] {
  return [...on].filter((layer) => !OWN_ROUTE.has(layer) && askable(layer, box)).sort();
}

/** The calendar day of an instant in New York, such as `2026-11-11`. */
const NEW_YORK_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/** True when the instant falls on the New York day of `now`. */
export const isCityToday = (instant: string, now: number): boolean =>
  NEW_YORK_DAY.format(new Date(instant)) === NEW_YORK_DAY.format(new Date(now));

/** When an item happens, by its own kind: it starts, was sent or published, or is due. */
function instantOf(item: CityItem): string | null {
  const { detail } = item;
  switch (detail.kind) {
    case 'road-event':
      return detail.startsAt ?? detail.updatedAt;
    case 'permitted-event':
      return detail.startsAt;
    case 'vessel-call':
      return detail.arrived ?? detail.expectedArrival;
    case 'notice':
      return detail.publishedAt;
    case 'transit-alert':
      return detail.sentAt ?? detail.periods[0]?.from ?? null;
    case 'weather-alert':
      return detail.startsAt;
    case 'harbor-reading':
      return detail.observedAt;
    case 'landmark':
    case 'street-closure':
    case 'camera':
    case 'charger':
    case 'defibrillator':
    case 'restroom':
    case 'subway-entrance':
    case 'parking-meter':
    case 'parking-sign':
    case 'road-condition':
      return null;
  }
}

/** The time an item is listed by: `at` it happens, or `until` it ends when it began before. */
export interface ListedTime {
  readonly at: string;
  readonly until: boolean;
}

/**
 * The time an item is listed by. A permit in force since another day (a park path closed from
 * 2024 to 2026) is listed until it ends, never by the day it began.
 */
export function itemTime(item: CityItem, now: number): ListedTime | null {
  const { detail } = item;
  if (detail.kind === 'permitted-event' && !isCityToday(detail.startsAt, now)) {
    return { at: detail.endsAt, until: true };
  }
  const at = instantOf(item);
  return at === null ? null : { at, until: false };
}

/**
 * The unplaced items of a layer, as each kind reads best: events and ship calls soonest first,
 * those running since another day after them by when they end; the rest newest first.
 */
export function listedItems(
  items: readonly CityItem[],
  layer: CityLayerId,
  now: number,
): CityItem[] {
  const own = items.filter((item) => item.layer === layer && item.point === null);
  const keyOf = (item: CityItem) => {
    const time = itemTime(item, now);
    return { until: time?.until === true ? 1 : 0, at: Date.parse(time?.at ?? '') || 0 };
  };
  const soonestFirst = layer === 'permitted-events' || layer === 'vessel-calls';
  return own.sort((a, b) => {
    const [first, second] = [keyOf(a), keyOf(b)];
    if (!soonestFirst) return second.at - first.at;
    return first.until - second.until || first.at - second.at;
  });
}

/** What the map draws: the placed items of the layers on. */
export function drawnItems(items: readonly CityItem[], on: ReadonlySet<CityLayerId>): CityItem[] {
  return items.filter((item) => item.point !== null && on.has(item.layer));
}

/**
 * How a mark is coloured, after the art direction: red for what is closed, amber for what is a
 * risk on the way, ink for the places and the facts of the harbor and the weather.
 */
type MarkTone = 'closed' | 'risk' | 'place' | 'quiet';

const TONES: Record<CityLayerId, MarkTone> = {
  'transit-alerts': 'risk',
  incidents: 'risk',
  closures: 'closed',
  construction: 'risk',
  'street-permits': 'quiet',
  'permitted-events': 'quiet',
  cameras: 'place',
  chargers: 'place',
  defibrillators: 'place',
  restrooms: 'place',
  landmarks: 'place',
  'subway-entrances': 'place',
  'parking-meters': 'place',
  'parking-signs': 'place',
  'vessel-calls': 'quiet',
  'harbor-conditions': 'place',
  'coast-guard': 'quiet',
  'road-conditions': 'quiet',
  'weather-alerts': 'risk',
};

export const toneOf = (layer: CityLayerId): MarkTone => TONES[layer];
