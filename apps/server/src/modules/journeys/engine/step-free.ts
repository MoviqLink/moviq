import type { ElevatorEquipment } from '../../data-platform/sources/accessibility/elevator-equipment.js';
import type { ElevatorInventory } from '../../data-platform/sources/accessibility/elevator-inventory.js';
import type { SubwayEntrances } from '../../data-platform/sources/accessibility/subway-entrances.js';
import type { SubwayStations } from '../../data-platform/sources/accessibility/subway-stations.js';
import type { GtfsIndex } from '../../data-platform/sources/mta/gtfs-static-schema.js';
import type { ElevatorOutages } from '../../data-platform/sources/mta/elevators.js';
import { brokenPaths, type ElevatorCause } from './elevator-paths.js';
import type { EntrancePoint, PlanWindow, WheelchairBoarding } from './inputs.js';

export interface StepFreeSources {
  readonly stations: SubwayStations;
  readonly equipment: ElevatorEquipment;
  readonly inventory: ElevatorInventory;
  readonly outages: ElevatorOutages;
  readonly entrances: SubwayEntrances;
}

/** Why an accessible station is not step-free for this trip. */
export interface StationFinding {
  readonly station: string;
  /**
   * `closed`: an elevator of its step-free path is out during the trip. `unknown`: the lists
   * cannot tell, as for an elevator the inventory has removed or a note the engine cannot read.
   */
  readonly state: 'closed' | 'unknown';
  readonly cause: ElevatorCause | 'note';
  /** The elevator behind it; null for a note of the station list. */
  readonly equipmentId: string | null;
}

export interface StepFree {
  /** GTFS `wheelchair_boarding` for each station of the timetable and its platforms. */
  readonly stops: Readonly<Record<string, WheelchairBoarding>>;
  /** Accessible stations with an elevator of their step-free path out during the trip. */
  readonly closed: readonly string[];
  /** Accessible stations whose step-free path cannot be told, and not closed. */
  readonly unknown: readonly string[];
  /** Every reason behind `closed` and `unknown`, by station then elevator. */
  readonly findings: readonly StationFinding[];
  /** Step-free elevators out or not working that cannot be placed on a station of the list. */
  readonly unmatched: readonly string[];
  /** The station complex of each station, so transfers are followed only inside one. */
  readonly complexes: Readonly<Record<string, string>>;
  /** The step-free entrances of each station in the survey, where step-free walks start. */
  readonly entrances: Readonly<Record<string, readonly EntrancePoint[]>>;
}

/** The survey's entrance types without steps; `Stair/Ramp` and the rest have some. */
const STEP_FREE_ENTRANCES: ReadonlySet<string> = new Set(['Elevator', 'Ramp']);

export function entrancesByStation(survey: SubwayEntrances): Record<string, EntrancePoint[]> {
  const byStation: Record<string, EntrancePoint[]> = {};
  for (const entrance of survey.entrances) {
    if (!STEP_FREE_ENTRANCES.has(entrance.type)) continue;
    const [lon, lat] = entrance.point;
    for (const station of entrance.stations) {
      (byStation[station] ??= []).push({ lat, lon, entry: entrance.entry, exit: entrance.exit });
    }
  }
  return byStation;
}

/**
 * The notes of the station list that say which one direction is step-free, already in its
 * `ada_northbound` and `ada_southbound` (11/11/2026). Any other note, as "Uptown local only" at
 * 86 St (626), where the 4 and 5 stop on a platform without an elevator, leaves it unknown.
 */
const ONE_WAY_NOTES: ReadonlySet<string> = new Set([
  'Downtown only',
  'Uptown only',
  'Manhattan-bound only',
  'Outbound only',
]);

type Station = SubwayStations['stations'][string];

function noteFinding(id: string, station: Station): StationFinding | undefined {
  if (station.note === null) return undefined;
  if (station.ada === 'partial' && ONE_WAY_NOTES.has(station.note)) return undefined;
  return { station: id, state: 'unknown', cause: 'note', equipmentId: null };
}

export function stationFindings(
  sources: StepFreeSources,
  window: PlanWindow,
): { readonly findings: StationFinding[]; readonly unmatched: readonly string[] } {
  const { stations } = sources.stations;
  const accessible = (id: string): boolean => (stations[id]?.ada ?? 'none') !== 'none';
  const { broken, unmatched } = brokenPaths(sources, window, (id) => stations[id] !== undefined);
  const findings: StationFinding[] = [];
  for (const [id, station] of Object.entries(stations)) {
    const note = accessible(id) ? noteFinding(id, station) : undefined;
    if (note !== undefined) findings.push(note);
  }
  for (const path of broken) {
    const state = path.cause === 'outage' ? 'closed' : 'unknown';
    for (const station of path.stations.filter(accessible)) {
      findings.push({ station, state, cause: path.cause, equipmentId: path.equipmentId });
    }
  }
  const order = (finding: StationFinding): string =>
    `${finding.station} ${finding.equipmentId ?? ''}`;
  findings.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  return { findings, unmatched };
}

function platformValue(station: Station, suffix: string): WheelchairBoarding {
  if (station.ada === 'full') return 1;
  if (station.ada === 'none') return 2;
  if (suffix === 'N') return station.northbound ? 1 : 2;
  if (suffix === 'S') return station.southbound ? 1 : 2;
  return 2;
}

/**
 * Step-free boarding on the subway timetable for one trip, from the MTA station list, the
 * elevator list, the inventory and the outages that may overlap the trip: a station fully
 * accessible is so on both platforms (`N`, `S`), one accessible in one direction only on that
 * platform, and none while a needed elevator is out or the lists cannot tell. Which platform an
 * elevator serves is written in words only, so the whole station is taken as not step-free.
 */
export function stepFreeStops(
  subway: GtfsIndex,
  sources: StepFreeSources,
  window: PlanWindow,
): StepFree {
  const { findings, unmatched } = stationFindings(sources, window);
  const closed = new Set(findings.filter((f) => f.state === 'closed').map((f) => f.station));
  const unknown = new Set(findings.map((f) => f.station).filter((id) => !closed.has(id)));
  const stops: Record<string, WheelchairBoarding> = {};
  for (const [id, stop] of Object.entries(subway.stops)) {
    const stationId = stop.station ? id : stop.parent;
    const station = stationId === null ? undefined : sources.stations.stations[stationId];
    if (stationId === null || station === undefined) continue;
    if (closed.has(stationId) || unknown.has(stationId)) stops[id] = 2;
    else if (stop.station) stops[id] = station.ada === 'full' ? 1 : 2;
    else stops[id] = platformValue(station, id.slice(stationId.length));
  }
  const complexes = Object.fromEntries(
    Object.entries(sources.stations.stations).map(([id, station]) => [id, station.complex]),
  );
  return {
    stops,
    closed: [...closed].sort(),
    unknown: [...unknown].sort(),
    findings,
    unmatched,
    complexes,
    entrances: entrancesByStation(sources.entrances),
  };
}
