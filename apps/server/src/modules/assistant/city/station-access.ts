import type { CitySource } from '@moviq/contracts';

import type { SourceReader } from '../../data-platform/reader.js';
import {
  mtaElevatorEquipment,
  type ElevatorEquipment,
} from '../../data-platform/sources/accessibility/elevator-equipment.js';
import { mtaSubwayStations } from '../../data-platform/sources/accessibility/subway-stations.js';
import { mtaElevators, type ElevatorOutages } from '../../data-platform/sources/mta/elevators.js';
import type { Finding, OutageFact, StationFact, Unanswered } from './findings.js';
import { current, sourceOf, type CityPorts } from './ports.js';
import {
  MAX_STATIONS,
  linesAtStations,
  simplifyName,
  stationsNamed,
  type NamedStation,
} from './stations.js';

type Outage = ElevatorOutages['outages'][number];
type Equipment = ElevatorEquipment['equipment'] | undefined;

async function readEquipment(reader: SourceReader) {
  const reading = await reader.read(mtaElevatorEquipment);
  return { equipment: reading.data?.equipment, source: sourceOf(mtaElevatorEquipment, reading) };
}

/** The stations named, with their access and outages, and the sources read for them. */
interface StationsRead {
  readonly named: readonly NamedStation[];
  readonly facts: readonly StationFact[];
  readonly sources: readonly CitySource[];
}

/**
 * Elevators and escalators of the subway stations named: out of service now and announced, by
 * the MTA outages feed joined to the equipment list, and step-free access by direction from the
 * MTA stations list. An outages feed that cannot be read is said, never taken for "all working".
 */
export async function readStations(
  ports: CityPorts,
  said: string,
): Promise<StationsRead | Unanswered> {
  const { reader } = ports;
  const [stationsReading, outagesReading, equipment, linesAt] = await Promise.all([
    reader.read(mtaSubwayStations),
    reader.read(mtaElevators),
    readEquipment(reader),
    linesAtStations(reader),
  ]);
  const stations = stationsReading.data;
  if (stations === undefined) return { kind: 'stations-unavailable', said };
  const named = stationsNamed(stations, said, linesAt).slice(0, MAX_STATIONS);
  if (named.length === 0) return { kind: 'unknown-station', said };
  // A copy too old to rely on cannot say an elevator works: it is read as not known.
  const outages = current(outagesReading) ? outagesReading.data?.outages : undefined;
  return {
    named,
    facts: named.map((station) =>
      stationFact(station, linesAt.get(station.id) ?? [], outages, equipment.equipment),
    ),
    sources: [
      sourceOf(mtaSubwayStations, stationsReading),
      sourceOf(mtaElevators, outagesReading),
      equipment.source,
    ],
  };
}

export async function stationAccess(ports: CityPorts, said: string): Promise<Finding | Unanswered> {
  const read = await readStations(ports, said);
  if (!('named' in read)) return read;
  const [only] = read.named;
  return {
    kind: 'station-access',
    subject: read.named.length === 1 && only !== undefined ? only.station.name : said,
    stations: read.facts,
    sources: read.sources,
  };
}

function stationFact(
  named: NamedStation,
  lines: readonly string[],
  outages: readonly Outage[] | undefined,
  equipment: Equipment,
): StationFact {
  const { station } = named;
  const here =
    outages
      ?.filter((outage) => servesStation(outage, named, equipment))
      .map((outage) => ({
        outage,
        fact: outageFact(outage, equipment),
      })) ?? null;
  return {
    name: station.name,
    lines,
    ada: station.ada,
    northbound: station.northbound,
    southbound: station.southbound,
    note: station.note,
    outagesNow: here?.filter(({ outage }) => !outage.upcoming).map(({ fact }) => fact) ?? null,
    announced: here?.filter(({ outage }) => outage.upcoming).map(({ fact }) => fact) ?? null,
  };
}

/** By the equipment list when it can be read; by the station's name otherwise. */
function servesStation(outage: Outage, named: NamedStation, equipment: Equipment): boolean {
  const listed = equipment?.[outage.equipmentId];
  if (listed !== undefined) return listed.stations.includes(named.id);
  return simplifyName(outage.station) === simplifyName(named.station.name);
}

function outageFact(outage: Outage, equipment: Equipment): OutageFact {
  const listed = equipment?.[outage.equipmentId];
  return {
    kind: outage.kind,
    serving: outage.serving,
    ada: outage.ada,
    redundant: listed === undefined ? null : listed.redundant,
    since: outage.since,
    estimatedReturn: outage.estimatedReturn,
  };
}
