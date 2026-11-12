import type { Flight, FlightCheck, Provenance } from '@moviq/contracts';

import type { AeroDataBoxFact, AircraftFact, AirportFact } from './flight-facts.js';
import {
  aeroDataBoxSays,
  aircraftSays,
  boardingPassSays,
  clockText,
  flightName,
  programSays,
  touchesDepartures,
} from './flight-words.js';

/** The source id of a departure time the traveller read from the boarding pass. */
export const BOARDING_PASS = 'boarding-pass';

/** Times this close are the same departure, written by two sources. */
const SAME_TIME_MS = 5 * 60_000;
/** On the ground and rolling faster than a pushback: the aircraft is taxiing. */
const TAXI_KNOTS = 5;
const BEFORE_DEPARTURE: ReadonlySet<string> = new Set([
  'Expected',
  'CheckIn',
  'Boarding',
  'GateClosed',
  'Delayed',
]);

export interface FlightFacts {
  /** The flight as the traveller read it from the boarding pass, when the plan came from it. */
  readonly boardingPass: Flight | null;
  /** AeroDataBox this round. */
  readonly aerodatabox: AeroDataBoxFact;
  /** AeroDataBox's last good answer before this round, used while it cannot answer. */
  readonly earlier: Flight | null;
  readonly airport: AirportFact;
  readonly aircraft: AircraftFact;
}

/** A disagreement with a stable key, so the watch reports it once while it lasts. */
interface Discrepancy {
  readonly key: 'time' | 'terminal' | 'faa-delay' | 'airborne' | 'on-ground';
  readonly text: string;
  /** The source that contradicts AeroDataBox. */
  readonly provenance: Provenance;
}

export interface Triangulation {
  readonly check: FlightCheck;
  readonly discrepancies: readonly Discrepancy[];
}

/**
 * Combines AeroDataBox, the boarding pass, the FAA's airport status and ADS-B into the departure
 * the deadline is planned from, saying where it comes from and where the sources disagree. With
 * no source of a departure time, there is none, and the evidence says why.
 */
export function triangulate(facts: FlightFacts): Triangulation {
  const current = facts.aerodatabox.kind === 'found' ? facts.aerodatabox.flight : null;
  const known = current ?? facts.earlier;
  const departure = departureOf(known, facts.boardingPass);
  const discrepancies = disagreements(known, facts, departure);
  return {
    check: {
      aerodatabox: known,
      departure,
      movement: movementOf(known, facts.aircraft),
      evidence: evidenceOf(departure, known, current, facts),
      discrepancies: discrepancies.map((discrepancy) => discrepancy.text),
      readings: readingsOf(facts),
    },
    discrepancies,
  };
}

function departureOf(known: Flight | null, pass: Flight | null): FlightCheck['departure'] {
  if (known !== null) {
    if (known.takeOffAt !== null) {
      return { at: known.takeOffAt, basis: 'take-off', sourceId: 'aerodatabox' };
    }
    if (known.revisedDeparture?.kind === 'revised') {
      return { at: known.revisedDeparture.at, basis: 'revised', sourceId: 'aerodatabox' };
    }
    return { at: known.departureAt, basis: 'scheduled', sourceId: 'aerodatabox' };
  }
  if (pass !== null)
    return { at: pass.departureAt, basis: 'boarding-pass', sourceId: BOARDING_PASS };
  return null;
}

function movementOf(known: Flight | null, aircraft: AircraftFact): FlightCheck['movement'] {
  if (aircraft.kind === 'seen') {
    const sourceId = aircraft.provenance.sourceId;
    if (!aircraft.onGround) return { phase: 'airborne', sourceId };
    if ((aircraft.groundSpeedKnots ?? 0) >= TAXI_KNOTS) return { phase: 'taxiing', sourceId };
  }
  return known !== null && known.takeOffAt !== null
    ? { phase: 'airborne', sourceId: 'aerodatabox' }
    : null;
}

function evidenceOf(
  departure: FlightCheck['departure'],
  known: Flight | null,
  current: Flight | null,
  facts: FlightFacts,
): string {
  const name = flightName(known ?? facts.boardingPass ?? { carrier: '', number: '' });
  const why = facts.aerodatabox.kind === 'found' ? '' : ` ${facts.aerodatabox.provenance.evidence}`;
  if (departure === null) {
    return `No source gives the departure: there is no boarding pass time, and AeroDataBox has no answer.${why}`;
  }
  const at = clockText(departure.at);
  switch (departure.basis) {
    case 'take-off':
      return `${name} took off at ${at} (AeroDataBox runway time).`;
    case 'boarding-pass':
      return `Planned from the ${at} departure on your boarding pass.${why}`;
    case 'revised':
    case 'scheduled': {
      const answeredAt = current === null ? known?.provenance.dataTime : undefined;
      const earlier =
        answeredAt === undefined || answeredAt === null
          ? '.'
          : ` in its answer of ${clockText(answeredAt)}.${why}`;
      return `Planned from ${name}'s ${departure.basis} departure, ${at} (AeroDataBox)${earlier}`;
    }
  }
}

function disagreements(
  known: Flight | null,
  facts: FlightFacts,
  departure: FlightCheck['departure'],
): Discrepancy[] {
  const found: Discrepancy[] = [];
  const pass = facts.boardingPass;
  if (pass !== null && known !== null && departure !== null && departure.basis !== 'take-off') {
    if (Math.abs(Date.parse(pass.departureAt) - Date.parse(departure.at)) >= SAME_TIME_MS) {
      found.push({
        key: 'time',
        provenance: pass.provenance,
        text:
          `Your boarding pass says ${clockText(pass.departureAt)}; AeroDataBox says ` +
          `${clockText(departure.at)} (${departure.basis}).`,
      });
    }
    if (
      pass.terminal !== null &&
      known.terminal !== null &&
      pass.terminal.toUpperCase() !== known.terminal.toUpperCase()
    ) {
      found.push({
        key: 'terminal',
        provenance: pass.provenance,
        text: `Your boarding pass says terminal ${pass.terminal}; AeroDataBox says terminal ${known.terminal}.`,
      });
    }
  }
  const faaDelay = faaDisagreement(known, facts, departure);
  if (faaDelay !== undefined) found.push(faaDelay);
  const aircraft = facts.aircraft;
  if (aircraft.kind === 'seen' && known !== null) {
    if (
      !aircraft.onGround &&
      known.takeOffAt === null &&
      BEFORE_DEPARTURE.has(known.status ?? '')
    ) {
      found.push({
        key: 'airborne',
        provenance: aircraft.provenance,
        text: `ADS-B shows ${aircraft.callSign} airborne; AeroDataBox still says ${known.status ?? ''}.`,
      });
    }
    if (aircraft.onGround && known.takeOffAt !== null && aircraft.distanceNm < 3) {
      found.push({
        key: 'on-ground',
        provenance: aircraft.provenance,
        text:
          `AeroDataBox says ${flightName(known)} took off at ${clockText(known.takeOffAt)}; ADS-B ` +
          `still sees ${aircraft.callSign} on the ground at ${known.airport}.`,
      });
    }
  }
  return found;
}

/** The FAA reports departures held up while AeroDataBox shows no delay. */
function faaDisagreement(
  known: Flight | null,
  facts: FlightFacts,
  departure: FlightCheck['departure'],
): Discrepancy | undefined {
  if (facts.airport.kind !== 'read' || known === null || departure === null) return undefined;
  if (departure.basis === 'take-off') return undefined;
  const delayed = Date.parse(departure.at) - Date.parse(known.departureAt) >= SAME_TIME_MS;
  const program = facts.airport.programs.find(touchesDepartures);
  if (program === undefined || delayed) return undefined;
  return {
    key: 'faa-delay',
    provenance: facts.airport.provenance,
    text:
      `${programSays(program, known.airport)} AeroDataBox still has ${flightName(known)} at ` +
      `${clockText(departure.at)}.`,
  };
}

function readingsOf(facts: FlightFacts): FlightCheck['readings'] {
  const readings: FlightCheck['readings'] = [];
  const adb = facts.aerodatabox;
  readings.push(
    adb.kind === 'found'
      ? {
          sourceId: 'aerodatabox',
          says: aeroDataBoxSays(adb.flight),
          provenance: adb.flight.provenance,
        }
      : { sourceId: 'aerodatabox', says: adb.provenance.evidence, provenance: adb.provenance },
  );
  const pass = facts.boardingPass;
  if (pass !== null) {
    readings.push({
      sourceId: BOARDING_PASS,
      says: boardingPassSays(pass),
      provenance: pass.provenance,
    });
  }
  const airport = facts.airport;
  const code = (adb.kind === 'found' ? adb.flight : (facts.earlier ?? pass))?.airport ?? '';
  readings.push({
    sourceId: airport.provenance.sourceId,
    says:
      airport.kind === 'down'
        ? airport.provenance.evidence
        : airport.programs.length === 0
          ? `No FAA delay programme at ${code}.`
          : airport.programs.map((program) => programSays(program, code)).join(' '),
    provenance: airport.provenance,
  });
  const aircraft = facts.aircraft;
  if (aircraft.kind !== 'not-looked') {
    readings.push({
      sourceId: aircraft.provenance.sourceId,
      says: aircraft.kind === 'down' ? aircraft.provenance.evidence : aircraftSays(aircraft, code),
      provenance: aircraft.provenance,
    });
  }
  return readings;
}
