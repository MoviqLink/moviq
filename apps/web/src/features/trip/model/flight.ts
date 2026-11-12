import type { Flight, FlightCheck, Journey } from '@moviq/contracts';

import { minutesBetween } from '../../../shared/time/city';

/** One fact of the flight, with the source that gave it and when that source produced it. */
export interface FlightFact<T> {
  readonly value: T;
  readonly sourceId: string;
  readonly dataTime: string | null;
  readonly evidence: string;
}

export interface FlightView {
  readonly code: string;
  readonly airport: Flight['airport'];
  readonly scheduled: FlightFact<string>;
  readonly revised: FlightFact<{
    at: string;
    kind: 'revised' | 'predicted';
    minutes: number;
  }> | null;
  readonly terminal: FlightFact<string> | null;
  /** Null value: the source has not announced it yet. */
  readonly gate: FlightFact<string | null> | null;
  /** AeroDataBox's status word, or the aircraft's movement from ADS-B. */
  readonly status: FlightFact<
    { kind: 'status'; word: string } | { kind: 'movement'; phase: 'taxiing' | 'airborne' }
  > | null;
  readonly departure: FlightCheck['departure'];
  readonly discrepancies: readonly string[];
  /** AeroDataBox's answer shown: its terms ask for attribution wherever its data is. */
  readonly aerodatabox: Flight | null;
}

const fact = <T>(value: T, flight: Flight): FlightFact<T> => ({
  value,
  sourceId: flight.provenance.sourceId,
  dataTime: flight.provenance.dataTime,
  evidence: flight.provenance.evidence,
});

/**
 * The flight as the screen shows it: each fact from the newest source that gives it, AeroDataBox
 * before the boarding pass, and nothing a source did not give.
 */
export function flightView(journey: Journey): FlightView | null {
  const planned = journey.request.flight;
  if (planned === null) return null;
  const check = journey.watch.flight;
  const adb =
    check?.aerodatabox ?? (planned.provenance.sourceId === 'aerodatabox' ? planned : null);
  const main = adb ?? planned;
  const revised = adb?.revisedDeparture ?? null;
  const movement = check?.movement ?? null;
  const status =
    movement !== null
      ? {
          value: { kind: 'movement' as const, phase: movement.phase },
          sourceId: movement.sourceId,
          dataTime: null,
          evidence: check?.evidence ?? main.provenance.evidence,
        }
      : adb !== null && adb.status !== null
        ? fact({ kind: 'status' as const, word: adb.status }, adb)
        : null;
  return {
    code: `${planned.carrier} ${planned.number}`,
    airport: main.airport,
    scheduled: fact(main.departureAt, main),
    revised:
      adb === null || revised === null
        ? null
        : fact({ ...revised, minutes: minutesBetween(adb.departureAt, revised.at) }, adb),
    terminal: terminalFact(adb, planned),
    gate: adb === null ? null : fact(adb.gate, adb),
    status,
    departure: check?.departure ?? null,
    discrepancies: check?.discrepancies ?? [],
    aerodatabox: adb,
  };
}

/** The terminal AeroDataBox gives, or the one on the boarding pass. */
function terminalFact(adb: Flight | null, planned: Flight): FlightFact<string> | null {
  if (adb !== null && adb.terminal !== null) return fact(adb.terminal, adb);
  return planned.terminal === null ? null : fact(planned.terminal, planned);
}
