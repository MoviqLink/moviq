import type { Alternative, Journey, Leg, Money, Place, Provenance } from '@moviq/contracts';

import { walksNotStepFreeChecked } from '../../journeys/accessibility.js';
import type { Lang } from '../planning/state.js';
import { time } from '../planning/words.js';

/** A source behind Sara's words on a trip, with the time of its data. */
interface FactSource {
  readonly sourceId: string;
  readonly dataTime: string | null;
}

export interface JourneyFacts {
  /** The trip as the model reads it: stops, lines, times and figures, never coordinates. */
  readonly context: string;
  /** Every source the facts come from, with its newest data, for the line under Sara's words. */
  readonly sources: readonly FactSource[];
}

const MAX_SOURCES = 8;

/** "$34.50" in English, "34,50 US$" in Spanish: the form Sara repeats as it is. */
export function moneyText(money: Money, lang: Lang): string {
  const amount = (money.amountMinor / 100).toFixed(2);
  return lang === 'es' ? `${amount.replace('.', ',')} US$` : `$${amount}`;
}

/** Public stops and stations by name; an address or a device position is never sent. */
function placeName(place: Place, role: 'start' | 'destination'): string {
  if (place.kind === 'stop' || place.kind === 'station' || place.kind === 'airport') {
    return place.label;
  }
  return role === 'start' ? 'your start' : 'your destination';
}

/** The rides of an itinerary in words, as "A, then M15" or "taxi". */
export function ridesOf(legs: readonly Leg[]): string {
  const rides = legs.filter((leg) => leg.mode !== 'walk');
  if (rides.length === 0) return 'walk';
  return rides.map((leg) => leg.route?.shortName ?? leg.mode).join(', then ');
}

function legFacts(legs: readonly Leg[], lang: Lang) {
  return legs.map((leg, index) => ({
    step: index + 1,
    mode: leg.mode,
    line: leg.route?.shortName ?? null,
    from: placeName(leg.from, 'start'),
    to: placeName(leg.to, 'destination'),
    leaves: time(new Date(leg.departAt), lang),
    arrives: time(new Date(leg.arriveAt), lang),
    timing: leg.timing,
    walk: leg.mode === 'walk' ? WALK_SAYS[leg.walk?.basis ?? 'estimated'] : null,
  }));
}

/** How a walk is known, for the model: an estimated one never makes a change sure. */
const WALK_SAYS = {
  street: 'walked on the streets',
  'station-rule': 'the station sets the time of this change',
  estimated: 'estimated, not checked on the streets: the change is not checked',
} as const;

/** What the itinerary cannot claim because of its walks, as the server says it. */
function walksSay(itinerary: Journey['itinerary'], stepFree: boolean): string[] {
  const says: string[] = [];
  if (itinerary.walking !== 'checked') {
    says.push(
      'Some walks are estimated: changes are not confirmed, the time to spare is approximate.',
    );
  }
  if (stepFree) {
    for (const index of walksNotStepFreeChecked(itinerary)) {
      says.push(`Step ${String(index + 1)}: step-free access is not checked on this walk.`);
    }
  }
  return says;
}

function optionFacts(alternatives: readonly Alternative[], lang: Lang) {
  return alternatives.map((alternative, index) => ({
    option: index + 1,
    recommended: alternative.recommended,
    rides: ridesOf(alternative.itinerary.legs),
    leaves: time(new Date(alternative.itinerary.departAt), lang),
    arrives: time(new Date(alternative.itinerary.arriveAt), lang),
    spareMinutes: alternative.itinerary.spareMinutes,
    price: alternative.price === null ? null : moneyText(alternative.price, lang),
    serverSays: alternative.why,
  }));
}

function flightFacts(journey: Journey, lang: Lang) {
  const check = journey.watch.flight;
  const flight = journey.request.flight;
  if (flight === null) return null;
  return {
    flight: `${flight.carrier} ${flight.number}`,
    airport: flight.airport,
    departure:
      check?.departure === null || check === null
        ? null
        : { at: time(new Date(check.departure.at), lang), basis: check.departure.basis },
    watchSays: check?.evidence ?? null,
  };
}

/** The journey's own facts for the model, each time in the traveller's form, and their sources. */
export function journeyFacts(journey: Journey, lang: Lang, now: Date): JourneyFacts {
  const { watch, itinerary, request } = journey;
  const facts = {
    now: time(now, lang),
    status: watch.status,
    watchSays: watch.evidence,
    arriveBy: time(new Date(request.arriveBy), lang),
    plannedArrival: time(new Date(itinerary.arriveAt), lang),
    expectedArrival:
      watch.projectedArriveAt === null ? null : time(new Date(watch.projectedArriveAt), lang),
    spareMinutesWanted: request.preferences.spareMinutes,
    stepFree: request.preferences.stepFree,
    steps: legFacts(itinerary.legs, lang),
    incidents: journey.incidents.map((incident) => ({
      kind: incident.kind,
      step: incident.legIndex + 1,
      says: incident.evidence,
      impactMinutes: incident.impactMinutes,
    })),
    flight: flightFacts(journey, lang),
    options: optionFacts(journey.alternatives, lang),
    noStepFreeOptionBecause: watch.stepFreeRefusal?.detail ?? null,
    walksSay: walksSay(itinerary, request.preferences.stepFree),
  };
  return { context: JSON.stringify(facts), sources: sourcesOf(journey) };
}

/** The incidents' sources first, then the live rides and the options' routing. */
function sourcesOf(journey: Journey): FactSource[] {
  const provenances: Provenance[] = [
    ...journey.incidents.map((incident) => incident.provenance),
    ...journey.itinerary.legs
      .filter((leg) => leg.timing === 'realtime')
      .map((leg) => leg.provenance),
    ...journey.alternatives.flatMap((alternative) =>
      alternative.itinerary.legs.slice(0, 1).map((leg) => leg.provenance),
    ),
  ];
  const newest = new Map<string, string | null>();
  for (const { sourceId, dataTime } of provenances) {
    const known = newest.get(sourceId);
    if (known === undefined || (dataTime !== null && (known === null || dataTime > known))) {
      newest.set(sourceId, dataTime);
    }
  }
  return [...newest].map(([sourceId, dataTime]) => ({ sourceId, dataTime })).slice(0, MAX_SOURCES);
}
