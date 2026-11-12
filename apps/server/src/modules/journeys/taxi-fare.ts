import type { Money } from '@moviq/contracts';

import {
  fromNewYorkWallClock,
  newYorkGtfsDate,
  weekdayOfGtfsDate,
} from '../../infrastructure/clock/new-york.js';

/**
 * The upfront price the demo taxi partner charges, computed with the official NYC TLC yellow taxi
 * rates (https://www.nyc.gov/site/tlc/passengers/taxi-fare.page, read on 11/11/2026):
 * $3.00 initial charge; 70 cents per 1/5 mile above 12 mph or per minute in slow traffic; 50 cents
 * MTA State Surcharge; $1.00 Improvement Surcharge; $1.00 overnight (8 pm to 6 am); $2.50 rush
 * hour (4 pm to 8 pm on weekdays); $2.50 Congestion Surcharge south of 96th Street in Manhattan;
 * 75 cents congestion pricing toll south of 60th Street; $70 flat between Manhattan and JFK
 * (plus the State, Improvement and Congestion surcharges, and $5.00 at rush hour); $5.00 to or
 * from LaGuardia. Tips and bridge or tunnel tolls are not included, and Newark is not priced:
 * MovIQ has no verified rule for it.
 */
export interface TaxiTrip {
  /** [longitude, latitude] pairs of the road route. */
  readonly path: readonly (readonly [number, number])[];
  readonly durationSeconds: number;
  readonly startsAt: Date;
  readonly airport: 'JFK' | 'LGA' | 'EWR' | null;
}

export interface TaxiFare {
  readonly amount: Money;
  /** What the price includes, in one sentence. */
  readonly note: string;
}

const CENTS = {
  initial: 300,
  unit: 70,
  state: 50,
  improvement: 100,
  overnight: 100,
  rushHour: 250,
  congestion: 250,
  congestionToll: 75,
  laGuardia: 500,
  jfkFlat: 7000,
  jfkRushHour: 500,
} as const;
const METERS_PER_UNIT = 1609.344 / 5;
const SLOW_MPH = 12;

export function taxiFare(trip: TaxiTrip): TaxiFare | null {
  if (trip.airport === 'EWR') return null;
  const inCongestionZone = trip.path.some(
    ([lon, lat]) => inManhattan(lon, lat) && southOf(lon, lat, STREET_96),
  );
  const inTollZone = trip.path.some(
    ([lon, lat]) => inManhattan(lon, lat) && southOf(lon, lat, STREET_60),
  );
  const touchesManhattan = trip.path.some(([lon, lat]) => inManhattan(lon, lat));
  const rush = isRushHour(trip.startsAt);
  let cents =
    CENTS.state +
    CENTS.improvement +
    (inCongestionZone ? CENTS.congestion : 0) +
    (inTollZone ? CENTS.congestionToll : 0);
  if (trip.airport === 'JFK' && touchesManhattan) {
    cents += CENTS.jfkFlat + (rush ? CENTS.jfkRushHour : 0);
  } else {
    cents +=
      meteredCents(trip) +
      (isOvernight(trip.startsAt) ? CENTS.overnight : 0) +
      (rush ? CENTS.rushHour : 0);
    if (trip.airport === 'LGA') cents += CENTS.laGuardia;
  }
  return {
    amount: { amountMinor: roundUpToQuarter(cents), currency: 'USD' },
    note:
      'Upfront price from the demo taxi partner, at the official NYC TLC yellow taxi rates ' +
      'and surcharges; tips and tolls not included.',
  };
}

function meteredCents(trip: TaxiTrip): number {
  const meters = pathLength(trip.path);
  const hours = trip.durationSeconds / 3600;
  const mph = hours === 0 ? 0 : meters / 1609.344 / hours;
  const units =
    mph > SLOW_MPH ? Math.ceil(meters / METERS_PER_UNIT) : Math.ceil(trip.durationSeconds / 60);
  return CENTS.initial + units * CENTS.unit;
}

function roundUpToQuarter(cents: number): number {
  return Math.ceil(cents / 25) * 25;
}

function newYorkHour(at: Date): { hour: number; weekday: number } {
  const date = newYorkGtfsDate(at);
  const midnight = fromNewYorkWallClock({
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(4, 6)),
    day: Number(date.slice(6, 8)),
    hour: 0,
    minute: 0,
    second: 0,
  });
  const hour =
    midnight === undefined ? 0 : Math.floor((at.getTime() - midnight.getTime()) / 3_600_000);
  return { hour, weekday: weekdayOfGtfsDate(date) };
}

/** Weekdays from 4 pm to 8 pm. Legal holidays are not known to MovIQ, so they count as weekdays. */
function isRushHour(at: Date): boolean {
  const { hour, weekday } = newYorkHour(at);
  return weekday < 5 && hour >= 16 && hour < 20;
}

function isOvernight(at: Date): boolean {
  const { hour } = newYorkHour(at);
  return hour >= 20 || hour < 6;
}

function pathLength(path: TaxiTrip['path']): number {
  let meters = 0;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    if (a !== undefined && b !== undefined) meters += haversine(a, b);
  }
  return meters;
}

function haversine(
  [lon1, lat1]: readonly [number, number],
  [lon2, lat2]: readonly [number, number],
): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Manhattan's shoreline, simplified: enough to tell whether a route enters the island. */
const MANHATTAN: readonly (readonly [number, number])[] = [
  [-74.017, 40.7003],
  [-74.009, 40.748],
  [-73.994, 40.772],
  [-73.976, 40.799],
  [-73.929, 40.879],
  [-73.91, 40.874],
  [-73.93, 40.802],
  [-73.942, 40.783],
  [-73.958, 40.759],
  [-73.971, 40.744],
  [-73.976, 40.711],
  [-74.012, 40.701],
];

/** 96th and 60th Streets, river to river, as straight lines between their ends. */
const STREET_96 = { west: [-73.9764, 40.7944], east: [-73.9437, 40.7857] } as const;
const STREET_60 = { west: [-73.9918, 40.7712], east: [-73.9586, 40.7592] } as const;

function southOf(
  lon: number,
  lat: number,
  street: { readonly west: readonly [number, number]; readonly east: readonly [number, number] },
): boolean {
  const [x1, y1] = street.west;
  const [x2, y2] = street.east;
  return (x2 - x1) * (lat - y1) - (y2 - y1) * (lon - x1) < 0;
}

function inManhattan(lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = MANHATTAN.length - 1; i < MANHATTAN.length; j = i, i += 1) {
    const [xi, yi] = MANHATTAN[i] ?? [0, 0];
    const [xj, yj] = MANHATTAN[j] ?? [0, 0];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
