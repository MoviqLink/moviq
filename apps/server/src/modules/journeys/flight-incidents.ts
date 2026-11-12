import {
  toInstant,
  type Flight,
  type Incident,
  type Journey,
  type Provenance,
} from '@moviq/contracts';

import type { AeroDataBoxFact, AircraftFact, AirportFact } from './flight-facts.js';
import { plannedDeparture } from './flight-deadline.js';
import type { Triangulation } from './flight-triangulation.js';
import {
  aircraftSays,
  clockText,
  flightName,
  inboundSays,
  programMinutes,
  programSays,
} from './flight-words.js';

const MINUTE_MS = 60_000;
/** A departure that moves less than this is the same departure. */
const MOVED_MS = 5 * MINUTE_MS;

export interface FlightRound {
  readonly journey: Journey;
  readonly planned: Flight;
  readonly triangulation: Triangulation;
  /** AeroDataBox's answer before this round, to see a gate change. */
  readonly earlier: Flight | null;
  readonly aerodatabox: AeroDataBoxFact;
  readonly airport: AirportFact;
  readonly aircraft: AircraftFact;
  /** The deadline the flight sets after this round. */
  readonly arriveBy: string;
  readonly now: Date;
}

/** The flight's incidents of a round, each with what was observed and its source. */
export function flightIncidents(round: FlightRound): Incident[] {
  const legIndex = Math.max(0, round.journey.itinerary.legs.length - 1);
  const at = toInstant(round.now);
  const make = (
    id: string,
    kind: Incident['kind'],
    evidence: string,
    provenance: Provenance,
    impactMinutes: number | null = null,
  ): Incident => ({ id, at, legIndex, kind, evidence, provenance, impactMinutes });
  const { check, discrepancies } = round.triangulation;
  const incidents: Incident[] = [];
  const time = timeChange(round);
  if (time !== undefined)
    incidents.push(make(time.id, 'flight', time.evidence, time.provenance, time.minutes));
  incidents.push(...gateChange(round, make));
  if (check.movement !== null) {
    const moving = movementSays(round);
    incidents.push(
      make(`flight-moving:${check.movement.phase}`, 'flight', moving.evidence, moving.provenance),
    );
  }
  if (round.aircraft.kind === 'inbound') {
    const evidence = inboundSays(round.aircraft, round.planned.airport);
    incidents.push(make('flight-inbound', 'flight', evidence, round.aircraft.provenance));
  }
  for (const discrepancy of discrepancies) {
    incidents.push(
      make(`flight-check:${discrepancy.key}`, 'flight', discrepancy.text, discrepancy.provenance),
    );
  }
  const { airport } = round;
  if (airport.kind === 'read' && check.movement === null) {
    for (const program of airport.programs) {
      const what = program.kind === 'delay' ? `${program.kind}-${program.direction}` : program.kind;
      incidents.push(
        make(
          `airport:${round.planned.airport}:${what}`,
          'airport',
          programSays(program, round.planned.airport),
          airport.provenance,
          programMinutes(program),
        ),
      );
    }
  }
  const name = flightName(round.planned);
  if (round.aerodatabox.kind === 'failed') {
    const { provenance } = round.aerodatabox;
    incidents.push(
      make(
        'source-down:flight:aerodatabox',
        'source-down',
        `${name} is not checked live with AeroDataBox: ${provenance.evidence} ${check.evidence}`,
        provenance,
      ),
    );
  }
  for (const down of [airport, round.aircraft]) {
    if (down.kind !== 'down') continue;
    incidents.push(
      make(
        `source-down:flight:${down.provenance.sourceId}`,
        'source-down',
        `${name} cannot be checked with ${down.provenance.sourceId}: ${down.provenance.evidence}`,
        down.provenance,
      ),
    );
  }
  return incidents;
}

/** The departure AeroDataBox gives now against the one the trip was planned from. */
function timeChange(round: FlightRound) {
  const departure = round.triangulation.check.departure;
  const known = round.triangulation.check.aerodatabox;
  if (departure === null || known === null) return undefined;
  if (departure.basis !== 'revised' && departure.basis !== 'scheduled') return undefined;
  const planned = plannedDeparture(round.planned).getTime();
  const moved = Date.parse(departure.at) - planned;
  if (Math.abs(moved) < MOVED_MS) return undefined;
  const minutes = Math.round(moved / MINUTE_MS);
  const direction = minutes > 0 ? 'later' : 'earlier';
  return {
    id: `flight-time:${departure.at}`,
    minutes,
    provenance: known.provenance,
    evidence:
      `${flightName(round.planned)} now leaves at ${clockText(departure.at)}, ` +
      `${String(Math.abs(minutes))} min ${direction} than the ${clockText(new Date(planned))} planned ` +
      `(AeroDataBox, ${departure.basis}): be at the terminal by ${clockText(round.arriveBy)}.`,
  };
}

/** A new gate is reported while it stays the gate; the first gate known is no change. */
function gateChange(
  round: FlightRound,
  make: (id: string, kind: Incident['kind'], evidence: string, provenance: Provenance) => Incident,
): Incident[] {
  const known = round.triangulation.check.aerodatabox;
  const gate = known?.gate ?? null;
  if (known === null || gate === null) return [];
  const id = `flight-gate:${gate}`;
  const reported = round.journey.incidents.find((incident) => incident.id === id);
  if (reported !== undefined) return [reported];
  const before =
    round.earlier?.gate ??
    (round.planned.provenance.sourceId === 'aerodatabox' ? round.planned.gate : null);
  if (before === null || before === gate) return [];
  return [
    make(
      id,
      'flight',
      `${flightName(round.planned)} changed gate from ${before} to ${gate} (AeroDataBox).`,
      known.provenance,
    ),
  ];
}

function movementSays(round: FlightRound): { evidence: string; provenance: Provenance } {
  const { aircraft, planned } = round;
  const known = round.triangulation.check.aerodatabox;
  const name = flightName(planned);
  if (aircraft.kind === 'seen') {
    const lead = aircraft.onGround ? `${name} is taxiing` : `${name} has taken off`;
    return {
      evidence: `${lead}: ${aircraftSays(aircraft, planned.airport)}`,
      provenance: aircraft.provenance,
    };
  }
  const takeOff = known?.takeOffAt ?? null;
  return {
    evidence:
      takeOff === null
        ? `${name} has left (AeroDataBox).`
        : `${name} took off at ${clockText(takeOff)} (AeroDataBox runway time).`,
    provenance: known?.provenance ?? planned.provenance,
  };
}
