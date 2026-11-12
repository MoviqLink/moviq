import type { Flight } from '@moviq/contracts';

import { toNewYorkWallClockText } from '../../infrastructure/clock/new-york.js';
import type { AircraftFact, AirportProgram } from './flight-facts.js';

/** New York wall-clock time, `18:25`. */
export const clockText = (instant: Date | string): string =>
  toNewYorkWallClockText(new Date(instant)).slice(11, 16);

export const flightName = (flight: Pick<Flight, 'carrier' | 'number'>): string =>
  `${flight.carrier} ${flight.number}`;

/** What AeroDataBox says of the flight, in one sentence. */
export function aeroDataBoxSays(flight: Flight): string {
  const parts = [`Scheduled ${clockText(flight.departureAt)}`];
  const revised = flight.revisedDeparture;
  if (revised !== null) parts.push(`${revised.kind} ${clockText(revised.at)}`);
  if (flight.terminal !== null) parts.push(`terminal ${flight.terminal}`);
  if (flight.gate !== null) parts.push(`gate ${flight.gate}`);
  if (flight.status !== null) parts.push(`status ${flight.status}`);
  if (flight.takeOffAt !== null) parts.push(`took off ${clockText(flight.takeOffAt)}`);
  return `${parts.join(', ')}.`;
}

export function boardingPassSays(flight: Flight): string {
  const terminal = flight.terminal === null ? '' : `, terminal ${flight.terminal}`;
  return `Departure ${clockText(flight.departureAt)} on the boarding pass${terminal}.`;
}

const NM_TO_MILES = 1.15078;
const AIRPORT_NAMES: Readonly<Record<Flight['airport'], string>> = {
  JFK: 'JFK',
  LGA: 'LaGuardia',
  EWR: 'Newark',
};

/** The flight's aircraft on its way in, for the traveller: in statute miles, the airport by name. */
export function inboundSays(
  fact: Extract<AircraftFact, { kind: 'inbound' }>,
  airport: Flight['airport'],
): string {
  const miles = Math.round(fact.distanceNm * NM_TO_MILES);
  return `Your plane is in the air, about ${String(miles)} miles from ${AIRPORT_NAMES[airport]}.`;
}

export function aircraftSays(
  fact: Extract<AircraftFact, { kind: 'seen' | 'not-seen' | 'inbound' }>,
  airport: string,
): string {
  if (fact.kind === 'inbound') {
    const which = fact.registration === null ? '' : ` (${fact.registration})`;
    const altitude =
      fact.altitudeFeet === null
        ? ''
        : ` at ${Math.round(fact.altitudeFeet).toLocaleString('en-US')} ft`;
    const distance = `${fact.distanceNm.toFixed(1)} NM from ${airport}`;
    return `The aircraft for this flight${which} is airborne${altitude}, ${distance}.`;
  }
  if (fact.kind === 'not-seen')
    return `${fact.callSign} is not among the aircraft around New York.`;
  const distance = `${fact.distanceNm.toFixed(1)} NM from ${airport}`;
  if (fact.onGround) {
    const speed =
      fact.groundSpeedKnots === null ? '' : ` at ${String(Math.round(fact.groundSpeedKnots))} kt`;
    return `${fact.callSign} is on the ground${speed}, ${distance}.`;
  }
  const altitude =
    fact.altitudeFeet === null
      ? ''
      : ` at ${Math.round(fact.altitudeFeet).toLocaleString('en-US')} ft`;
  return `${fact.callSign} is airborne${altitude}, ${distance}.`;
}

/** Whether an FAA programme at the airport touches departures, directly or through inbound aircraft. */
export function touchesDepartures(program: AirportProgram): boolean {
  return (
    program.kind === 'closure' || (program.kind === 'delay' && program.direction === 'departure')
  );
}

/** What a programme for arrivals means for a departure. */
const INBOUND = ': the aircraft for your flight may arrive late';

/** An FAA programme in one sentence, as the FAA wrote its times and reasons. */
export function programSays(program: AirportProgram, airport: string): string {
  const reason = program.reason === null ? '' : ` (${program.reason})`;
  switch (program.kind) {
    case 'delay': {
      const span = [program.minimum, program.maximum]
        .map((duration) => duration?.text ?? null)
        .filter((text): text is string => text !== null)
        .join(' to ');
      const how = span === '' ? '' : ` of ${span}`;
      const trend = program.trend === null ? '' : `, ${program.trend.toLowerCase()}`;
      const effect = program.direction === 'departure' ? '' : INBOUND;
      return `The FAA reports ${program.direction} delays${how} at ${airport}${trend}${reason}${effect}.`;
    }
    case 'ground-stop': {
      const until = program.until === null ? '' : ` until ${program.until}`;
      return `The FAA holds flights bound for ${airport} at their origin${until}${reason}${INBOUND}.`;
    }
    case 'ground-delay': {
      const average = program.average === null ? '' : `, ${program.average.text} on average`;
      return `The FAA delays flights bound for ${airport}${average}${reason}${INBOUND}.`;
    }
    case 'closure': {
      const reopens = program.reopens === null ? '' : `, reopening ${program.reopens}`;
      return `The FAA reports ${airport} closed${reopens}${reason}.`;
    }
  }
}

/** The longest delay of a programme in minutes, when the FAA gave it in a known form. */
export function programMinutes(program: AirportProgram): number | null {
  if (program.kind === 'delay') return program.maximum?.minutes ?? program.minimum?.minutes ?? null;
  if (program.kind === 'ground-delay')
    return program.maximum?.minutes ?? program.average?.minutes ?? null;
  return null;
}
