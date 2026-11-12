import {
  toInstant,
  type Incident,
  type Journey,
  type Leg,
  type Provenance,
} from '@moviq/contracts';

import { toNewYorkWallClockText } from '../../infrastructure/clock/new-york.js';
import { alertApplies, findTrip } from './watch-match.js';

/** A trip with its predicted stops, as both subway and bus feeds give them. */
export interface PredictedTrip {
  readonly tripId: string;
  readonly routeId: string;
  readonly stops: readonly {
    readonly stopId: string;
    readonly arrival: string | null;
    readonly departure: string | null;
  }[];
}

export interface LiveReading<T> {
  readonly data: T | undefined;
  readonly provenance: Provenance;
}

export interface ServiceAlert {
  readonly id: string;
  readonly header: string;
  /** `agencyId` as GTFS-rt gives it (`MTASBWY`, `MTA NYCT`, `MNR`…), so route 4 of Metro-North is not the 4 train. */
  readonly affected: readonly {
    readonly agencyId: string | null;
    readonly routeId: string | null;
  }[];
  readonly activePeriods: readonly { readonly start: string | null; readonly end: string | null }[];
}

/** What the watch reads each round: every prediction feed, and the service alerts. */
export interface LiveData {
  readonly predictions: readonly LiveReading<{ readonly trips: readonly PredictedTrip[] }>[];
  readonly alerts: LiveReading<{ readonly alerts: readonly ServiceAlert[] }>;
}

export interface Assessment {
  readonly status: Journey['watch']['status'];
  readonly evidence: string;
  /** The arrival live data points to; null when a connection is lost or a ride has no data. */
  readonly projectedArriveAt: Date | null;
  readonly incidents: readonly Incident[];
  /** True when the plan no longer holds and alternatives should be looked for. */
  readonly needsAlternatives: boolean;
}

const MINUTE = 60_000;
const TIGHT_CONNECTION_MS = 2 * MINUTE;
/** Rides further ahead than this are followed by their timetable: live predictions start later. */
const LIVE_HORIZON_MS = 45 * MINUTE;

interface LegCheck {
  readonly delayMs: number | undefined;
  readonly provenance: Provenance | undefined;
}

/**
 * Compares a journey with live data. Every warning carries its evidence; a source that cannot be
 * read makes the status `unknown`, never `on-track`.
 */
export function assessJourney(journey: Journey, live: LiveData, now: Date): Assessment {
  const legs = journey.itinerary.legs;
  const incidents: Incident[] = [];
  const checks = legs.map((leg, index): LegCheck => {
    if (!isTransit(leg) || Date.parse(leg.arriveAt) < now.getTime())
      return { delayMs: 0, provenance: undefined };
    return checkLeg(leg, index, live, now, incidents);
  });
  addAlerts(legs, live, now, incidents);
  // A connection already lost is certain whatever later rides do: report it first.
  const missed = missedConnection(legs, checks);
  if (missed !== undefined) {
    return {
      status: 'late',
      evidence: `The connection at ${missed} will be missed; looking for another way.`,
      projectedArriveAt: null,
      incidents,
      needsAlternatives: true,
    };
  }
  const unknownLeg = checks.findIndex(
    (check, index) => check.delayMs === undefined && isUpcoming(legs[index], now),
  );
  if (unknownLeg >= 0) {
    return {
      status: 'unknown',
      evidence:
        `No live prediction yet for ${describe(legs[unknownLeg])} from ` +
        `${legs[unknownLeg]?.from.label ?? 'its stop'}; the plan is followed by its timetable.`,
      projectedArriveAt: null,
      incidents,
      needsAlternatives: false,
    };
  }
  const lastTransit = legs.findLastIndex((leg) => isTransit(leg));
  const lastDelay = lastTransit < 0 ? 0 : (checks[lastTransit]?.delayMs ?? 0);
  const estimated = Date.parse(journey.itinerary.arriveAt) + lastDelay;
  const deadline = Date.parse(journey.request.arriveBy);
  const spareMinutes = Math.floor((deadline - estimated) / MINUTE);
  const at = clock(estimated);
  const projectedArriveAt = new Date(estimated);
  if (spareMinutes < 0) {
    return {
      status: 'late',
      evidence: `Arriving about ${at}, ${String(-spareMinutes)} min after ${clock(deadline)}.`,
      projectedArriveAt,
      incidents,
      needsAlternatives: true,
    };
  }
  if (spareMinutes < journey.request.preferences.spareMinutes) {
    return {
      status: 'at-risk',
      evidence: `Arriving about ${at}, only ${String(spareMinutes)} min to spare.`,
      projectedArriveAt,
      incidents,
      needsAlternatives: true,
    };
  }
  return {
    status: 'on-track',
    evidence: `On track: arriving about ${at}, ${String(spareMinutes)} min to spare.`,
    projectedArriveAt,
    incidents,
    needsAlternatives: false,
  };
}

function checkLeg(
  leg: Leg,
  index: number,
  live: LiveData,
  now: Date,
  incidents: Incident[],
): LegCheck {
  if (Date.parse(leg.departAt) - now.getTime() > LIVE_HORIZON_MS)
    return { delayMs: 0, provenance: undefined };
  const usable = live.predictions.filter((reading) => reading.data !== undefined);
  const match = findTrip(leg, usable, now);
  if (match === undefined) {
    const down = live.predictions.find((reading) => reading.data === undefined);
    if (down !== undefined && isUpcoming(leg, now)) {
      incidents.push({
        id: `source-down:${String(index)}:${down.provenance.sourceId}`,
        at: toInstant(now),
        legIndex: index,
        kind: 'source-down',
        evidence: `Live data for ${describe(leg)} is not available: ${down.provenance.evidence}`,
        provenance: down.provenance,
        impactMinutes: null,
      });
    }
    return { delayMs: undefined, provenance: undefined };
  }
  const delayMs = match.arrival - Date.parse(leg.arriveAt);
  if (delayMs >= 3 * MINUTE) {
    incidents.push({
      id: `delay:${String(index)}`,
      at: toInstant(now),
      legIndex: index,
      kind: 'delay',
      evidence:
        `${describe(leg)} is predicted at ${leg.to.label} at ${clock(match.arrival)}, ` +
        `${String(Math.round(delayMs / MINUTE))} min later than planned.`,
      provenance: match.provenance,
      impactMinutes: Math.round(delayMs / MINUTE),
    });
  }
  return { delayMs, provenance: match.provenance };
}

function addAlerts(legs: readonly Leg[], live: LiveData, now: Date, incidents: Incident[]): void {
  const alerts = live.alerts.data?.alerts ?? [];
  legs.forEach((leg, index) => {
    if (!isTransit(leg) || !isUpcoming(leg, now)) return;
    for (const alert of alerts) {
      if (!alertApplies(alert, leg)) continue;
      if (!isActive(alert, now)) continue;
      incidents.push({
        id: `alert:${String(index)}:${alert.id}`,
        at: toInstant(now),
        legIndex: index,
        kind: 'alert',
        evidence: alert.header,
        provenance: live.alerts.provenance,
        impactMinutes: null,
      });
    }
  });
}

/** The transfer stop where a late arrival leaves no time for the next ride, if any. */
function missedConnection(legs: readonly Leg[], checks: readonly LegCheck[]): string | undefined {
  const transit = legs.map((leg, index) => ({ leg, index })).filter(({ leg }) => isTransit(leg));
  for (let position = 1; position < transit.length; position += 1) {
    const previous = transit[position - 1];
    const next = transit[position];
    if (previous === undefined || next === undefined) continue;
    const walking = legs
      .slice(previous.index + 1, next.index)
      .reduce((total, leg) => total + Date.parse(leg.arriveAt) - Date.parse(leg.departAt), 0);
    const arrival = Date.parse(previous.leg.arriveAt) + (checks[previous.index]?.delayMs ?? 0);
    const departure = Date.parse(next.leg.departAt) + (checks[next.index]?.delayMs ?? 0);
    if (arrival + walking + TIGHT_CONNECTION_MS > departure) return previous.leg.to.label;
  }
  return undefined;
}

function isActive(alert: ServiceAlert, now: Date): boolean {
  if (alert.activePeriods.length === 0) return true;
  return alert.activePeriods.some(
    (period) =>
      (period.start === null || Date.parse(period.start) <= now.getTime()) &&
      (period.end === null || Date.parse(period.end) > now.getTime()),
  );
}

const isTransit = (leg: Leg | undefined): leg is Leg =>
  leg !== undefined &&
  (leg.mode === 'subway' || leg.mode === 'bus' || leg.mode === 'rail' || leg.mode === 'ferry');
const isUpcoming = (leg: Leg | undefined, now: Date) =>
  leg !== undefined && isTransit(leg) && Date.parse(leg.arriveAt) >= now.getTime();
const describe = (leg: Leg | undefined) =>
  leg?.route === null || leg === undefined ? 'this ride' : `the ${leg.route.shortName}`;
const clock = (ms: number) => toNewYorkWallClockText(new Date(ms)).slice(11, 16);
