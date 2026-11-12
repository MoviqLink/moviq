import type { Itinerary, Leg, TravelMode } from '@moviq/contracts';

import type { PlanWindow } from './engine/inputs.js';
import { stopChanges } from './engine/step-free-changes.js';
import { entrancesByStation, stationFindings, type StationFinding } from './engine/step-free.js';
import type { StepFreeReading } from './step-free-lists.js';

type Accessibility = NonNullable<Itinerary['accessibility']>;
export type PlatformAccess = Accessibility['platforms'][number];
type AccessElevator = PlatformAccess['elevators'][number];
type AccessWarning = Accessibility['warnings'][number];
type Lists = Extract<StepFreeReading, { readonly ok: true }>['lists'];

/** The modes ridden on a timetable; walks and taxis have no platform. */
const RIDDEN: ReadonlySet<TravelMode> = new Set(['subway', 'bus', 'rail', 'ferry']);

/**
 * The only mode the step-free lists cover: the MTA station list is the subway's, so the engine
 * leaves the others out of a step-free plan (their timetables do not say which stops are).
 */
const CHECKED_MODE: TravelMode = 'subway';

const PLATFORM = /^([0-9A-Z]{3})([NS]?)$/;

/** A subway stop id as the station of the list and the platform's direction, if it is one. */
function stationOf(
  stopId: string | null,
): { readonly station: string; readonly direction: 'N' | 'S' | null } | undefined {
  // Feed prefixes (`MTA_`, `mta:`) are dropped: the operator's own id is the last part.
  const id = stopId?.split(/[_:]/).at(-1);
  const match = id === undefined ? null : PLATFORM.exec(id);
  const station = match?.[1];
  if (station === undefined) return undefined;
  const direction = match?.[2] === 'N' || match?.[2] === 'S' ? match[2] : null;
  return { station, direction };
}

interface PlatformUse {
  readonly legIndex: number;
  readonly at: 'board' | 'alight';
  readonly leg: Leg;
}

function platformUses(legs: readonly Leg[]): PlatformUse[] {
  return legs.flatMap((leg, legIndex): PlatformUse[] =>
    RIDDEN.has(leg.mode)
      ? [
          { legIndex, at: 'board', leg },
          { legIndex, at: 'alight', leg },
        ]
      : [],
  );
}

function elevatorOf(id: string, lists: Lists): AccessElevator {
  const rows = lists.outages.outages.filter((outage) => outage.equipmentId === id);
  const outage = rows.find((row) => !row.upcoming) ?? rows[0];
  return {
    id,
    serving: outage?.serving === undefined || outage.serving === '' ? null : outage.serving,
    since: outage?.since ?? null,
    estimatedReturn: outage?.estimatedReturn ?? null,
    upcoming: outage?.upcoming ?? false,
  };
}

/** The state of a platform of a listed station, from its findings and the station list. */
function listedState(
  station: Lists['stations']['stations'][string],
  direction: 'N' | 'S' | null,
  found: readonly StationFinding[],
  lists: Lists,
): Pick<PlatformAccess, 'state' | 'cause' | 'elevators'> {
  const elevators = (findings: readonly StationFinding[]): AccessElevator[] =>
    findings.flatMap((finding) =>
      finding.equipmentId === null ? [] : [elevatorOf(finding.equipmentId, lists)],
    );
  const closed = found.filter((finding) => finding.state === 'closed');
  if (closed.length > 0)
    return { state: 'elevator-out', cause: 'outage', elevators: elevators(closed) };
  const first = found[0];
  if (first !== undefined)
    return { state: 'unknown', cause: first.cause, elevators: elevators(found) };
  const open = { cause: null, elevators: [] };
  if (station.ada === 'full') return { state: 'accessible', ...open };
  const oneWay =
    station.ada === 'partial' &&
    ((direction === 'N' && station.northbound) || (direction === 'S' && station.southbound));
  return oneWay
    ? { state: 'one-direction', ...open }
    : { state: 'not-step-free', cause: 'not-step-free', elevators: [] };
}

function platformAccess(
  use: PlatformUse,
  reading: StepFreeReading,
  findings: readonly StationFinding[],
): PlatformAccess {
  const place = use.at === 'board' ? use.leg.from : use.leg.to;
  const ref = use.leg.mode === CHECKED_MODE ? stationOf(place.stopId) : undefined;
  const base = { legIndex: use.legIndex, at: use.at, stopId: place.stopId };
  if (!reading.ok) {
    return {
      ...base,
      station: place.label,
      state: 'unknown',
      cause: 'lists-unavailable',
      elevators: [],
    };
  }
  const station = ref === undefined ? undefined : reading.lists.stations.stations[ref.station];
  if (ref === undefined || station === undefined) {
    return { ...base, station: place.label, state: 'unknown', cause: 'not-listed', elevators: [] };
  }
  const found = findings.filter((finding) => finding.station === ref.station);
  return {
    ...base,
    station: station.name,
    ...listedState(station, ref.direction, found, reading.lists),
  };
}

/** The name of a stop for a sentence: its station in the list, else the place's own label. */
function nameOf(stopId: string, label: string, reading: StepFreeReading): string {
  const ref = stationOf(stopId);
  const listed =
    !reading.ok || ref === undefined ? undefined : reading.lists.stations.stations[ref.station];
  return listed?.name ?? label;
}

function entranceWarnings(legs: readonly Leg[], lists: Lists): AccessWarning[] {
  if (legs.length < 2) return [];
  const surveyed = entrancesByStation(lists.entrances);
  const ends: { readonly legIndex: number; readonly stopId: string | null }[] = [];
  const first = legs[0];
  const last = legs.at(-1);
  if (first?.mode === 'walk') ends.push({ legIndex: 0, stopId: first.to.stopId });
  if (last?.mode === 'walk') ends.push({ legIndex: legs.length - 1, stopId: last.from.stopId });
  return ends.flatMap(({ legIndex, stopId }): AccessWarning[] => {
    const ref = stationOf(stopId);
    const station = ref === undefined ? undefined : lists.stations.stations[ref.station];
    if (ref === undefined || station === undefined || station.ada === 'none') return [];
    if ((surveyed[ref.station]?.length ?? 0) > 0) return [];
    return [{ kind: 'entrance-not-surveyed', legIndex, station: station.name }];
  });
}

/**
 * The walks of a step-free itinerary not walked on the streets with the wheelchair profile, by
 * leg: estimated ones, and any kept before walks were labelled. Changes between two platforms
 * are not among them: `change-unverified` says those.
 */
export function walksNotStepFreeChecked(itinerary: Pick<Itinerary, 'legs'>): number[] {
  const changes = new Set(stopChanges(itinerary).map((change) => change.legIndex));
  return itinerary.legs.flatMap((leg, legIndex) => {
    if (leg.mode !== 'walk' || changes.has(legIndex)) return [];
    const checked = leg.walk?.basis === 'street' && leg.walk.profile === 'wheelchair';
    return checked ? [] : [legIndex];
  });
}

function warnings(
  itinerary: Pick<Itinerary, 'legs'>,
  modes: readonly TravelMode[],
  reading: StepFreeReading,
): AccessWarning[] {
  const { legs } = itinerary;
  const leftOut = modes.filter(
    (mode) => RIDDEN.has(mode) && mode !== CHECKED_MODE && !legs.some((leg) => leg.mode === mode),
  );
  const modesLeftOut: AccessWarning[] =
    leftOut.length === 0 ? [] : [{ kind: 'modes-left-out', modes: leftOut }];
  const changes = stopChanges(itinerary).map((change): AccessWarning => {
    const walk = legs[change.legIndex];
    return {
      kind: 'change-unverified',
      legIndex: change.legIndex,
      from: nameOf(change.from, walk?.from.label ?? change.from, reading),
      to: nameOf(change.to, walk?.to.label ?? change.to, reading),
    };
  });
  const entrances = reading.ok ? entranceWarnings(legs, reading.lists) : [];
  const walks = walksNotStepFreeChecked(itinerary).map((legIndex): AccessWarning => ({
    kind: 'walk-unverified',
    legIndex,
  }));
  return [...modesLeftOut, ...changes, ...entrances, ...walks];
}

/**
 * The step-free check of an itinerary for the trip's window: each platform where a ride is
 * boarded or left, by the MTA station list and the elevators out or not working (outages in
 * force, or announced inside the window), and what the plan does not verify. Without the lists
 * every platform is `unknown`, never `accessible`.
 */
export function itineraryAccessibility(
  itinerary: Pick<Itinerary, 'legs'>,
  modes: readonly TravelMode[],
  reading: StepFreeReading,
  window: PlanWindow,
): Accessibility {
  const { findings, unmatched } = reading.ok
    ? stationFindings(reading.lists, window)
    : { findings: [], unmatched: [] };
  const platforms = platformUses(itinerary.legs).map((use): PlatformAccess => {
    const access = platformAccess(use, reading, findings);
    // An elevator out that cannot be placed could be on any path: no open platform is confirmed.
    const open = access.state === 'accessible' || access.state === 'one-direction';
    return unmatched.length > 0 && open
      ? { ...access, state: 'unknown', cause: 'outage-unplaced' }
      : access;
  });
  return {
    checkedAt: reading.ok ? reading.lists.outages.readAt : null,
    provenance: reading.provenance.outages,
    platforms,
    warnings: warnings(itinerary, modes, reading),
  };
}
