import {
  toInstant,
  type AirportCode,
  type BoardStatus,
  type Provenance,
  type ScheduledFlight,
} from '@moviq/contracts';

import type { AirportBoards } from '../data-platform/on-demand/airport-boards.js';
import { AIRPORT_CODES } from './airports.js';

/** The flight delayed or missed, and from when another may be taken. */
interface MissedFlight {
  /** The destination's IATA code, such as `LAX`. */
  readonly destination: string;
  /** Departures from this instant on: the missed flight's new time, or when the traveller is free. */
  readonly after: Date;
  /** The flight missed, as AeroDataBox writes it (`AA 100`), so it is not offered again. */
  readonly number: string | null;
}

interface NextDeparture {
  readonly airport: AirportCode;
  /** The revised departure, or the timetable one without it. */
  readonly departsAt: string;
  readonly flight: ScheduledFlight;
  /** The same departure listed again under another airline of its group (`XL 1453`). */
  readonly alsoListedAs: readonly string[];
}

/** What each board covers, so nothing is said about the hours it does not list. */
interface BoardCoverage {
  readonly airport: AirportCode;
  readonly state: 'current' | 'kept' | 'none';
  /** The board lists departures up to this instant; null without a board. */
  readonly coveredUntil: string | null;
  readonly provenance: Provenance;
}

interface NextDepartures {
  /** Soonest first. */
  readonly departures: readonly NextDeparture[];
  readonly coverage: readonly BoardCoverage[];
}

/** A flight in these states will not take anyone: cancelled, or already gone. */
const NOT_OFFERED: ReadonlySet<BoardStatus> = new Set([
  'Canceled',
  'CanceledUncertain',
  'Departed',
  'EnRoute',
  'Approaching',
  'Arrived',
  'Diverted',
]);

/**
 * AeroDataBox lists some departures twice, under the airline and under the group's operator, both
 * `IsOperator`: at JFK on 11/11/2026, LA 1453 (terminal 4) and XL 1453 (its aircraft) at 06:16.
 * Same digits from the same airport within this time are one departure.
 */
const TWIN_MS = 15 * 60_000;

const digitsOf = (number: string): string => /(\d{1,4})[A-Z]?$/.exec(number)?.[1] ?? number;

/**
 * The real departures to the same destination from JFK, LaGuardia and Newark after a flight is
 * delayed or missed, from the boards as they stand. Nothing is sold: whoever shows them as
 * tickets marks them as a simulation.
 */
export async function nextDepartures(
  boards: AirportBoards,
  missed: MissedFlight,
  now: Date,
): Promise<NextDepartures> {
  const from = Math.max(missed.after.getTime(), now.getTime());
  const destination = missed.destination.toUpperCase();
  const readings = await Promise.all(
    AIRPORT_CODES.map(async (airport) => ({ airport, reading: await boards.read(airport) })),
  );
  const missedDigits = missed.number === null ? null : digitsOf(missed.number);
  const departures: Omit<NextDeparture, 'alsoListedAs'>[] = [];
  const coverage: BoardCoverage[] = [];
  for (const { airport, reading } of readings) {
    const snapshot = reading.snapshot;
    coverage.push({
      airport,
      state: reading.state,
      coveredUntil: snapshot === null ? null : toInstant(snapshot.window.to),
      provenance: reading.provenance,
    });
    for (const flight of snapshot?.departures ?? []) {
      const departsAt = flight.revisedAt ?? flight.scheduledAt;
      if (flight.airport.iata !== destination || digitsOf(flight.number) === missedDigits) continue;
      if (flight.status !== null && NOT_OFFERED.has(flight.status)) continue;
      if (Date.parse(departsAt) < from) continue;
      departures.push({ airport, departsAt, flight });
    }
  }
  departures.sort((a, b) => Date.parse(a.departsAt) - Date.parse(b.departsAt));
  return { departures: withoutTwins(departures), coverage };
}

/** One entry per departure: the one with a terminal leads, the others are named in it. */
function withoutTwins(departures: readonly Omit<NextDeparture, 'alsoListedAs'>[]): NextDeparture[] {
  const merged: { lead: Omit<NextDeparture, 'alsoListedAs'>; others: string[] }[] = [];
  for (const departure of departures) {
    const twin = merged.find(
      ({ lead }) =>
        lead.airport === departure.airport &&
        digitsOf(lead.flight.number) === digitsOf(departure.flight.number) &&
        Math.abs(Date.parse(lead.departsAt) - Date.parse(departure.departsAt)) <= TWIN_MS,
    );
    if (twin === undefined) merged.push({ lead: departure, others: [] });
    else if (twin.lead.flight.terminal === null && departure.flight.terminal !== null) {
      twin.others.push(twin.lead.flight.number);
      twin.lead = departure;
    } else twin.others.push(departure.flight.number);
  }
  return merged
    .map(({ lead, others }) => ({ ...lead, alsoListedAs: others }))
    .sort((a, b) => Date.parse(a.departsAt) - Date.parse(b.departsAt));
}
