import type { TravelMode } from '@moviq/contracts';

import type { RoutedItinerary, RoutedLeg, RouteQuery } from '../ports.js';
import { listsEntrances } from './entrances.js';
import type { Network } from './network.js';

/** One change between two stops of an itinerary, by their GTFS stop ids, at its walk. */
interface StopChange {
  readonly from: string;
  readonly to: string;
  readonly legIndex: number;
}

/** What finding the changes reads of an itinerary: as routed, or as served. */
interface ChangeLegs {
  readonly legs: readonly {
    readonly mode: TravelMode;
    readonly from: { readonly stopId: string | null };
    readonly to: { readonly stopId: string | null };
  }[];
}

function ridden(mode: TravelMode): boolean {
  return mode !== 'walk';
}

/**
 * The changes between two different stops in an itinerary: a walk between two rides. On a
 * step-free trip each follows a `transfers.txt` rule inside one complex, and none is verified
 * step-free inside the station, as the MTA files have no `pathways.txt`.
 */
export function stopChanges(itinerary: ChangeLegs): readonly StopChange[] {
  const changes: StopChange[] = [];
  const { legs } = itinerary;
  for (let at = 1; at < legs.length - 1; at += 1) {
    const [before, leg, after] = [legs[at - 1], legs[at], legs[at + 1]];
    if (before === undefined || leg === undefined || after === undefined) continue;
    if (leg.mode !== 'walk' || !ridden(before.mode) || !ridden(after.mode)) continue;
    const { stopId: from } = leg.from;
    const { stopId: to } = leg.to;
    if (from !== null && to !== null && from !== to) changes.push({ from, to, legIndex: at });
  }
  return changes;
}

/** The modes asked for that cannot be ridden step-free, as no stop of theirs is marked. */
function modesWithoutStepFree(network: Network, query: RouteQuery): readonly TravelMode[] {
  return query.modes.filter((mode) => ridden(mode) && !network.stepFreeModes.includes(mode));
}

/**
 * Why a step-free query cannot be planned, or undefined when it can: no stop of the timetables
 * is marked, or none of the modes asked for has a marked stop (buses, whose files say nothing).
 */
export function stepFreeRefusal(network: Network, query: RouteQuery): string | undefined {
  if (network.stepFreeModes.length === 0) {
    return 'The timetables served do not say which stops are step-free, so no step-free route can be planned.';
  }
  const rides = query.modes.filter(ridden);
  const missing = modesWithoutStepFree(network, query);
  if (rides.length === 0 || missing.length < rides.length) return undefined;
  return (
    `The timetables served say which stops are step-free only for ${network.stepFreeModes.join(', ')}, ` +
    `not for ${missing.join(', ')}, so no step-free route can be planned.`
  );
}

/**
 * The stops of the walks to the first ride and from the last whose station has no step-free
 * entrance in the survey, so the walk was measured to the station's own point.
 */
function walksToStationPoint(
  network: Network,
  itineraries: readonly RoutedItinerary[],
): readonly string[] {
  const without = new Set<string>();
  const check = (leg: RoutedLeg | undefined, end: RoutedLeg['from'] | undefined): void => {
    const id = end?.stopId ?? null;
    if (leg?.mode !== 'walk' || id === null) return;
    const stop = network.stops.ids.findIndex(
      (candidate, at) => candidate === id && network.stops.accessible[at] === 1,
    );
    if (stop >= 0 && !listsEntrances(network.entrances, stop)) without.add(id);
  };
  for (const { legs } of itineraries) {
    if (legs.length < 2) continue;
    check(legs[0], legs[0]?.to);
    check(legs.at(-1), legs.at(-1)?.from);
  }
  return [...without].sort();
}

/** What a step-free answer leaves out and does not verify, for its evidence. */
export function stepFreeEvidence(
  network: Network,
  query: RouteQuery,
  itineraries: readonly RoutedItinerary[],
): string {
  if (!query.stepFree) return '';
  const missing = modesWithoutStepFree(network, query);
  const left =
    missing.length === 0
      ? ''
      : `; step-free: ${missing.join(', ')} left out, as their timetables do not say which stops are step-free`;
  const changes = [
    ...new Set(
      itineraries.flatMap((itinerary) => stopChanges(itinerary)).map((c) => `${c.from} > ${c.to}`),
    ),
  ];
  const noun = changes.length === 1 ? 'change' : 'changes';
  const unverified =
    changes.length === 0
      ? ''
      : `; ${String(changes.length)} ${noun} not verified step-free: ${changes.join(', ')}`;
  const points = walksToStationPoint(network, itineraries);
  const measured =
    points.length === 0
      ? ''
      : `; walks at ${points.join(', ')} measured to the station's point: the entrance survey ` +
        'lists no step-free entrance there';
  return `${left}${unverified}${measured}`;
}
