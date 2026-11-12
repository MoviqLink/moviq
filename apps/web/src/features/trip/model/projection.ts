import type { Incident, Journey } from '@moviq/contracts';

import { minutesBetween } from '../../../shared/time/city';

export interface Projection {
  /** When the traveller should arrive: the server's projection, or the plan without one. */
  readonly arriveAt: string;
  /**
   * `live`: the worker projected it from live data; `plan`: no projection yet (or a missed
   * transfer, or a leg without data), so the plan's own arrival is shown, from the timetable.
   */
  readonly source: 'live' | 'plan';
  /** Whole minutes after the planned arrival; negative when ahead of it. */
  readonly shiftMinutes: number;
  /** Minutes to spare before the deadline; negative when the arrival is after it. */
  readonly spareMinutes: number;
}

/** Where the journey is expected to arrive, as the server says, with the margin it leaves. */
export function project(journey: Journey): Projection {
  const planned = journey.itinerary.arriveAt;
  const projected = journey.watch.projectedArriveAt;
  const arriveAt = projected ?? planned;
  return {
    arriveAt,
    source: projected === null ? 'plan' : 'live',
    shiftMinutes: projected === null ? 0 : minutesBetween(planned, projected),
    spareMinutes: minutesBetween(arriveAt, journey.request.arriveBy),
  };
}

/** Legs with at least one incident, drawn in the risk colour. */
export function riskyLegs(incidents: readonly Incident[]): Set<number> {
  return new Set(incidents.map((incident) => incident.legIndex));
}
