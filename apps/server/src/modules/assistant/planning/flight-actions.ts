import { toInstant, type Flight, type Place } from '@moviq/contracts';

import { deadlineFor, plannedDeparture } from '../../journeys/flight-deadline.js';
import { BOARDING_PASS } from '../../journeys/flight-triangulation.js';
import { flightLabel } from '../understanding/flight-number.js';
import type { Airport } from '../understanding/reader.js';
import {
  addDays,
  arrivalFrom,
  newYorkDate,
  type ClockReading,
} from '../understanding/time-words.js';
import { airportQuery, localTime, type ActionAnswer, type PlanningPorts } from './actions.js';
import type { Turn } from './state.js';

/** What the model is told to do when AeroDataBox cannot give the flight. */
const ASK_BOARDING_PASS =
  'Ask for the departure time on the boarding pass and its airport, and the terminal if the ' +
  'traveller knows it; then call set_boarding_pass.';

interface FlightRequest {
  readonly carrier: string;
  readonly number: string;
  readonly date: string | null;
  readonly airport?: Airport | undefined;
}

/**
 * Looks a flight up; without a date, today's, or tomorrow's once today's has left. When
 * AeroDataBox cannot answer, has no units left or does not know the flight, Sara asks for the
 * departure time on the boarding pass instead.
 */
export async function findFlight(
  ports: PlanningPorts,
  turn: Turn,
  request: FlightRequest,
): Promise<ActionAnswer> {
  const label = flightLabel(request.carrier, request.number);
  const today = newYorkDate(turn.now);
  const dates = request.date === null ? [today, addDays(today, 1)] : [request.date];
  for (const date of dates) {
    const query = { carrier: request.carrier, number: request.number, date };
    const outcome = await ports.flights.find(query, turn.signal);
    if (!outcome.ok) {
      const why = outcome.code === 'monthly-units' ? 'allowance' : 'down';
      turn.notes.push({ kind: 'flights-unavailable', flight: label, why });
      awaitBoardingPass(turn, request);
      return {
        error:
          why === 'allowance'
            ? "Flight lookups are paused until this month's free allowance renews."
            : 'Flight search is not available right now.',
        next: ASK_BOARDING_PASS,
      };
    }
    const flight = outcome.value;
    const ahead =
      flight !== null &&
      flight.takeOffAt === null &&
      plannedDeparture(flight).getTime() > turn.now.getTime();
    if (flight !== null && ahead) return setFlight(ports, turn, flight, request.airport);
    if (flight !== null && request.date !== null) {
      turn.notes.push({ kind: 'flight-departed', flight: label });
      return { error: `Flight ${label} has already left.` };
    }
  }
  turn.notes.push({ kind: 'flight-not-found', flight: label, date: request.date ?? today });
  awaitBoardingPass(turn, request);
  return { found: false, flight: label, next: ASK_BOARDING_PASS };
}

function awaitBoardingPass(turn: Turn, request: FlightRequest): void {
  turn.state.boardingPass = {
    carrier: request.carrier,
    number: request.number,
    date: request.date,
    airport: request.airport ?? null,
    departureAt: null,
    terminal: null,
  };
}

/**
 * Fills the flight waiting for its boarding pass with what the traveller read on it. Once the
 * departure time and the airport are known, the flight sets the deadline as AeroDataBox's would,
 * marked as coming from the boarding pass.
 */
export async function fillBoardingPass(
  ports: PlanningPorts,
  turn: Turn,
  read: {
    readonly clock: Pick<ClockReading, 'hour' | 'minute' | 'half'> | undefined;
    readonly day: string | null;
    readonly airport: Airport | undefined;
    readonly terminal: string | undefined;
  },
): Promise<ActionAnswer> {
  const { state } = turn;
  const pass = state.boardingPass;
  if (pass === null) {
    turn.notes.push({ kind: 'no-boarding-pass-flight' });
    return { error: 'No flight is waiting for a boarding pass time. Ask for the flight number.' };
  }
  if (read.airport !== undefined) pass.airport = read.airport;
  if (read.terminal !== undefined) pass.terminal = read.terminal;
  if (read.clock !== undefined) {
    const day = read.day ?? pass.date;
    let time = arrivalFrom(read.clock, day, turn.now);
    // Without a date, a time already gone today is tomorrow's flight.
    if (time.kind === 'passed' && day === null) {
      time = arrivalFrom(read.clock, addDays(newYorkDate(turn.now), 1), turn.now);
    }
    switch (time.kind) {
      case 'at':
        pass.departureAt = toInstant(time.at);
        state.pendingClock = null;
        break;
      case 'ambiguous':
        state.pendingClock = time.pending;
        return { ask: 'Ask whether the departure is in the morning or in the evening.' };
      case 'passed':
        turn.notes.push({ kind: 'time-passed', at: toInstant(time.at) });
        return { error: 'That departure time has already passed in New York.' };
      case 'too-far':
        turn.notes.push({ kind: 'time-too-far' });
        return { error: 'Sara plans up to a week ahead.' };
    }
  }
  if (pass.departureAt === null || pass.airport === null) {
    return { waiting: pass.departureAt === null ? 'the departure time' : 'the airport' };
  }
  const flight: Flight = {
    carrier: pass.carrier,
    number: pass.number,
    departureAt: pass.departureAt,
    revisedDeparture: null,
    takeOffAt: null,
    airport: pass.airport,
    terminal: pass.terminal,
    gate: null,
    status: null,
    callSign: null,
    aircraftHex: null,
    provenance: {
      sourceId: BOARDING_PASS,
      dataTime: null,
      receivedAt: toInstant(turn.now),
      ageSeconds: null,
      state: 'healthy',
      evidence:
        `The traveller read the ${localTime(new Date(pass.departureAt)).slice(11)} departure ` +
        'on the boarding pass.',
    },
  };
  state.boardingPass = null;
  return setFlight(ports, turn, flight, undefined);
}

async function setFlight(
  ports: PlanningPorts,
  turn: Turn,
  flight: Flight,
  said: Airport | undefined,
): Promise<ActionAnswer> {
  const { state } = turn;
  const departure = plannedDeparture(flight);
  const deadline = deadlineFor(departure);
  state.draft.flight = flight;
  state.draft.arriveBy = toInstant(deadline);
  state.boardingPass = null;
  state.pendingClock = null;
  state.plan = null;
  if (said !== undefined && said !== flight.airport) {
    turn.notes.push({ kind: 'airport-differs', said, actual: flight.airport });
  }
  const fromPass = flight.provenance.sourceId === BOARDING_PASS;
  turn.notes.push({ kind: fromPass ? 'boarding-pass-used' : 'flight-found', flight });
  const airport = await airportPlace(ports, turn, flight.airport);
  state.draft.destination = airport ?? null;
  return {
    flight: flightLabel(flight.carrier, flight.number),
    from: fromPass ? 'the boarding pass' : 'AeroDataBox',
    airport: flight.airport,
    terminal: flight.terminal,
    gate: flight.gate,
    departs: localTime(departure),
    scheduled: localTime(new Date(flight.departureAt)),
    status: flight.status,
    beAtAirportBy: localTime(deadline),
    airportPlace: airport?.label ?? null,
  };
}

/** The airport as the geocoder knows it: a place of kind airport, or one named as an airport. */
async function airportPlace(
  ports: PlanningPorts,
  turn: Turn,
  airport: Airport,
): Promise<Place | undefined> {
  const outcome = await ports.geocoder.search(airportQuery(airport), turn.signal);
  const places = outcome.ok ? outcome.value : [];
  const place =
    places.find((candidate) => candidate.kind === 'airport') ??
    places.find((candidate) => /\b(?:airport|aeropuerto)\b/i.test(candidate.label));
  if (place === undefined) turn.notes.push({ kind: 'airport-not-found', airport });
  return place;
}
