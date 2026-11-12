import type { TicketAutopayService } from '../../tickets/autopay.js';
import { toInstant, type Place, type PlanResponse } from '@moviq/contracts';

import { toNewYorkWallClockText } from '../../../infrastructure/clock/new-york.js';
import type { Logger } from '../../../infrastructure/telemetry/logger.js';
import type { RewardToolContext } from '../../commerce/sara-tools.js';
import type { FlightFinder, Geocoder, JourneyPlanner } from '../../journeys/ports.js';
import type { CityPorts } from '../city/ports.js';
import type { Airport } from '../understanding/reader.js';
import type { ArrivalReading } from '../understanding/time-words.js';
import { MAX_CANDIDATES, missingSlots, type PlaceSlot, type Turn } from './state.js';
import { planThroughStop } from './stopover.js';

/**
 * What Sara can do, the same whether a model or the basic reader understood the sentence. Every
 * place, flight and plan comes from the injected ports; when one cannot answer, a note says so
 * and nothing is filled in its place. Answers for the model carry names and New York times only,
 * never coordinates.
 */
export interface PlanningPorts {
  readonly geocoder: Geocoder;
  readonly flights: FlightFinder;
  readonly planner: JourneyPlanner;
  /** What Sara reads to answer about lines, incidents, vehicles and stations. */
  readonly city: CityPorts;
  readonly logger: Logger;
  /** The demo merchants on the trip under watch; undefined without a trip or without tastes. */
  readonly rewards?: RewardToolContext;
  /** How Sara buys tickets with the PayPal the traveller connected; undefined without PayPal. */
  readonly tickets?: Pick<TicketAutopayService, 'buy'>;
  /** How Sara starts a line watch for the traveller; undefined when watches are not wired. */
  readonly watches?: LineWatches;
}

/** Starting a watch of a line for a traveller, as the Agent screen does by hand. */
export interface LineWatches {
  watchLine(travellerId: string, line: string): Promise<'created' | 'exists' | 'limit'>;
}

export type { RewardToolContext };

export type ActionAnswer = Readonly<Record<string, unknown>>;

/** Until travellers can set their own: the public modes, a short walk and a little spare time. */
const PREFERENCES = {
  maxWalkMinutes: 15,
  stepFree: false,
  modes: ['walk', 'subway', 'bus', 'rail', 'ferry'],
  spareMinutes: 5,
} as const;

const AIRPORT_NAMES: Readonly<Record<Airport, string>> = {
  JFK: 'John F. Kennedy International Airport',
  LGA: 'LaGuardia Airport',
  EWR: 'Newark Liberty International Airport',
};

/** How the geocoder is asked for an airport. */
export const airportQuery = (airport: Airport): string => AIRPORT_NAMES[airport];

/** New York wall-clock time without seconds, the form the model reads and writes. */
export const localTime = (instant: Date): string => toNewYorkWallClockText(instant).slice(0, 16);

export async function findPlace(
  ports: PlanningPorts,
  turn: Turn,
  slot: PlaceSlot,
  query: string,
): Promise<ActionAnswer> {
  const clean = query
    .trim()
    .replace(/[.!?¿¡]+$/g, '')
    .trim();
  if (/^(?:(?:the|el|la)\s+)?(?:airport|aeropuerto)$/i.test(clean)) {
    turn.notes.push({ kind: 'airport-which' });
    return { ask: 'Ask which airport: JFK, LaGuardia or Newark.' };
  }
  if (/^jfkl$/i.test(clean)) {
    turn.state.pendingAirport = { airport: 'JFK', slot };
    turn.notes.push({ kind: 'airport-confirm', airport: 'JFK' });
    return { ask: 'Ask whether they mean JFK. Do not select it without confirmation.' };
  }
  const exact = /^(?:jfk|lga|ewr)$/i.test(clean) ? (clean.toUpperCase() as Airport) : undefined;
  const outcome = await ports.geocoder.search(
    exact === undefined ? query : airportQuery(exact),
    turn.signal,
  );
  if (!outcome.ok) {
    if (outcome.code === 'no-match') {
      turn.notes.push({ kind: 'place-not-found', slot, query });
      return { found: 'nothing', query };
    }
    turn.notes.push({ kind: 'places-unavailable', query });
    return { error: 'Address search is not available right now.' };
  }
  const places = outcome.value;
  const [first] = places;
  if (first === undefined) {
    turn.notes.push({ kind: 'place-not-found', slot, query });
    return { found: 'nothing', query };
  }
  // The best match named exactly as asked is that place, unless another match has the same
  // name (one street in two boroughs): then they are offered, never chosen for the traveller.
  const named = places.filter((place) => sameName(query, place.label));
  if (places.length === 1 || (sameName(query, first.label) && named.length === 1)) {
    setPlace(turn, slot, first);
    return { chosen: first.label };
  }
  const offered = (named.length > 1 ? named : places).slice(0, MAX_CANDIDATES);
  turn.state.candidates = { slot, query, places: offered };
  return {
    candidates: offered.map((place, index) => `${String(index + 1)}. ${place.label}`),
    note: 'Several places match. Ask which one, by number.',
  };
}

export function choosePlace(turn: Turn, slot: PlaceSlot, option: number): ActionAnswer {
  const candidates = turn.state.candidates;
  if (candidates?.slot !== slot) return { error: 'There are no places to choose from for that.' };
  const place = candidates.places[option - 1];
  if (place === undefined) return { error: `There is no option ${String(option)}.` };
  setPlace(turn, slot, place);
  return { chosen: place.label };
}

function setPlace(turn: Turn, slot: PlaceSlot, place: Place): void {
  turn.state.draft[slot] = place;
  turn.state.pendingAirport = null;
  // Options offered for the other slot are still waiting for the traveller's choice.
  if (turn.state.candidates?.slot === slot) turn.state.candidates = null;
  turn.state.plan = null;
  turn.notes.push({ kind: 'place-found', slot, place });
}

export function setArrival(turn: Turn, reading: ArrivalReading): ActionAnswer {
  const { state } = turn;
  if (state.draft.flight !== null) {
    turn.notes.push({ kind: 'flight-sets-time' });
    return { error: 'The flight sets the time to be at the airport.' };
  }
  switch (reading.kind) {
    case 'at':
      state.draft.arriveBy = toInstant(reading.at);
      state.pendingClock = null;
      state.plan = null;
      return { arriveBy: localTime(reading.at) };
    case 'ambiguous':
      state.pendingClock = reading.pending;
      return { ask: 'Ask whether it is in the morning or in the evening.' };
    case 'passed':
      turn.notes.push({ kind: 'time-passed', at: toInstant(reading.at) });
      return { error: 'That time has already passed in New York.' };
    case 'too-far':
      turn.notes.push({ kind: 'time-too-far' });
      return { error: 'Sara plans up to a week ahead.' };
  }
}

/** Plans the trip once the draft is complete and has no plan yet. */
export async function settlePlan(ports: PlanningPorts, turn: Turn): Promise<PlanResponse | null> {
  const { draft } = turn.state;
  const { origin, destination, arriveBy } = draft;
  if (turn.state.plan !== null || origin === null || destination === null || arriveBy === null) {
    return null;
  }
  if (missingSlots(draft).length > 0) return null;
  const request = { origin, destination, arriveBy, flight: draft.flight };
  try {
    const asked = { ...request, preferences: { ...PREFERENCES, modes: [...PREFERENCES.modes] } };
    const stop = turn.state.stop ?? null;
    const plan =
      stop === null
        ? await ports.planner.plan(asked, turn.travellerId, turn.signal)
        : await planThroughStop(ports, turn, asked, stop);
    turn.state.plan = plan;
    turn.notes.push({ kind: 'planned', plan });
    return plan;
  } catch (error) {
    if (turn.signal?.aborted === true) throw error;
    ports.logger.error('assistant plan failed', { error });
    turn.notes.push({ kind: 'plan-failed' });
    return null;
  }
}

/** The recommended itinerary in words the model can repeat, with New York times. */
export function planSummary(plan: PlanResponse): ActionAnswer {
  const best = plan.itineraries.find((itinerary) => itinerary.id === plan.recommendedId);
  if (best === undefined) return { planned: true, itineraries: 0, notices: plan.notices };
  return {
    planned: true,
    leaveAt: localTime(new Date(best.departAt)),
    arriveAt: localTime(new Date(best.arriveAt)),
    spareMinutes: best.spareMinutes,
    transfers: best.transfers,
    legs: best.legs.map((leg) => (leg.route === null ? leg.mode : leg.route.shortName)),
    notices: plan.notices,
  };
}

/** "Bryant Park" names "Bryant Park, Manhattan, NY" exactly; "125th Street" names no one stop. */
function sameName(query: string, label: string): boolean {
  return simplify(query) === simplify(label.split(',')[0] ?? label);
}

function simplify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/(\d+)(?:st|nd|rd|th)\b/g, '$1')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'av')
    .replace(/[^\p{L}\d]+/gu, ' ')
    .trim();
}
