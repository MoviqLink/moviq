import type { Money } from '@moviq/contracts';

import type { FareQuote, FareRules } from '../ports.js';
import { ridesOf, type Ride } from './omny-rides.js';

/**
 * The MTA subway and bus fare paid with OMNY, as the MTA states it on
 * https://www.mta.info/fares-tolls/subway-bus (read on 11/11/2026 at 01:56 UTC): $3 on subways
 * and local, limited, rush and Select Bus Service buses; one free transfer within two hours of
 * paying, from subway to bus, bus to subway or bus to bus; at most $35 in 7 days on subway and
 * local bus fares with the same card or device.
 */
export const OMNY_FARE = {
  sourceUrl: 'https://www.mta.info/fares-tolls/subway-bus',
  checkedOn: '2026-11-11',
  fare: { amountMinor: 300, currency: 'USD' },
  transferWindowMinutes: 120,
  weeklyCap: { amountMinor: 3500, currency: 'USD' },
  capDays: 7,
} as const satisfies {
  readonly sourceUrl: string;
  readonly checkedOn: string;
  readonly fare: Money;
  readonly transferWindowMinutes: number;
  readonly weeklyCap: Money;
  readonly capDays: number;
};

const CAP_NOTE = 'With the same card or device, subway and local bus fares stop at $35 in 7 days.';

/** Full fares for subways and local buses; anything else is left unpriced (`null`). */
export const omnyFareRules: FareRules = {
  fareFor(legs) {
    if (legs.length === 0) return null;
    if (legs.every((leg) => leg.mode === 'walk')) {
      return { amount: dollars(0), note: 'No fare: the whole trip is on foot.' };
    }
    const rides = ridesOf(legs);
    return rides === undefined ? null : quote(rides);
  },
};

/** Each paid tap opens a two-hour window with one free transfer to another route. */
function quote(rides: readonly Ride[]): FareQuote | null {
  let fares = 0;
  let transfers = 0;
  let window: { readonly paidAt: number; transferLeft: boolean } | undefined;
  let previous: Ride | undefined;
  for (const ride of rides) {
    if (previous?.kind === 'bus' && ride.kind === 'bus' && previous.routeId === ride.routeId) {
      return null;
    }
    const elapsedMinutes =
      window === undefined
        ? Number.POSITIVE_INFINITY
        : (ride.at.getTime() - window.paidAt) / 60_000;
    if (window?.transferLeft === true && elapsedMinutes <= OMNY_FARE.transferWindowMinutes) {
      window.transferLeft = false;
      transfers += 1;
    } else {
      fares += 1;
      window = { paidAt: ride.at.getTime(), transferLeft: true };
    }
    previous = ride;
  }
  return { amount: dollars(fares * OMNY_FARE.fare.amountMinor), note: noteFor(fares, transfers) };
}

function noteFor(fares: number, transfers: number): string {
  const paid = fares === 1 ? 'one fare' : `${String(fares)} fares`;
  const free =
    transfers === 0
      ? ''
      : transfers === 1
        ? ', with one free transfer within two hours'
        : `, with ${String(transfers)} free transfers within two hours of each fare`;
  return `MTA fare with OMNY: ${paid}${free}. ${CAP_NOTE}`;
}

function dollars(amountMinor: number): Money {
  return { amountMinor, currency: 'USD' };
}
