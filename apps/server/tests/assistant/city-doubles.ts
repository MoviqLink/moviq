import type { LiveMode, LiveSource, LiveVehicle, ModeSummary, SourceState } from '@moviq/contracts';

import type { SourceDefinition } from '../../src/modules/data-platform/definition.js';
import type { SourceReader, SourceReading } from '../../src/modules/data-platform/reader.js';
import type { CitySnapshot } from '../../src/modules/live/city.js';

/** 07:00 in New York on 11/11/2026, the clock of the city tests. */
export const CITY_NOW = '2026-11-11T12:00:00.000Z';
const minutesBefore = (minutes: number) =>
  new Date(Date.parse(CITY_NOW) - minutes * 60_000).toISOString();
export const minutesAfter = (minutes: number) =>
  new Date(Date.parse(CITY_NOW) + minutes * 60_000).toISOString();

/** A source served by the test: its data, validated by the definition read, and its state. */
export interface Served {
  readonly data: unknown;
  readonly state?: SourceState;
  /** Minutes before `CITY_NOW` the data was produced; 1 by default. */
  readonly ageMinutes?: number;
}

/**
 * A reader serving data written by hand, by source id. Each copy is validated by the schema of
 * the definition that reads it, as the platform does; a source not listed has nothing usable.
 */
export function fakeReader(served: Readonly<Record<string, Served>>): SourceReader & {
  readonly reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    read<T>(definition: SourceDefinition<T>): Promise<SourceReading<T>> {
      reads.push(definition.id);
      const entry = served[definition.id];
      if (entry === undefined || entry.state === 'unavailable') {
        return Promise.resolve({
          data: undefined,
          provenance: {
            sourceId: definition.id,
            dataTime: null,
            receivedAt: null,
            ageSeconds: null,
            state: entry?.state ?? 'unavailable',
            evidence: 'The test serves nothing for this source.',
          },
        });
      }
      const age = entry.ageMinutes ?? 1;
      return Promise.resolve({
        data: definition.dataSchema.parse(entry.data),
        version: 'v1',
        provenance: {
          sourceId: definition.id,
          dataTime: minutesBefore(age),
          receivedAt: minutesBefore(age),
          ageSeconds: age * 60,
          state: entry.state ?? 'healthy',
          evidence: 'Served by the test.',
        },
      });
    },
  };
}

export function liveSource(
  sourceId: string,
  title: string,
  state: SourceState = 'healthy',
): LiveSource {
  return {
    title,
    attribution: 'Test data',
    kind: 'realtime',
    publishedAt: null,
    provenance: {
      sourceId,
      dataTime: state === 'unavailable' ? null : minutesBefore(1),
      receivedAt: minutesBefore(1),
      ageSeconds: 60,
      state,
      evidence: 'Served by the test.',
    },
  };
}

export function modeSummary(
  mode: LiveMode,
  status: ModeSummary['status'],
  sourceIds: string[],
): ModeSummary {
  return { mode, status, shown: 0, excluded: [], sourceIds };
}

/** The city Explore shows, written by hand. */
export function fakeCity(parts: Partial<CitySnapshot> = {}): { snapshot(): Promise<CitySnapshot> } {
  const snapshot: CitySnapshot = {
    generatedAt: CITY_NOW,
    modes: parts.modes ?? [],
    vehicles: parts.vehicles ?? [],
    stations: parts.stations ?? [],
    sources: parts.sources ?? [],
  };
  return { snapshot: () => Promise.resolve(snapshot) };
}

const NO_DETAILS = {
  bearing: null,
  speed: null,
  altitudeMeters: null,
  onGround: null,
  usualRoute: null,
  shipType: null,
  occupancy: null,
} as const;

/** An A train placed by station, heading to 50 St, due there in 2 minutes. */
export function subwayTrain(overrides: Partial<LiveVehicle> = {}): LiveVehicle {
  return {
    id: 'subway:A-1',
    mode: 'subway',
    sourceId: 'mta-subway-ace',
    name: null,
    operator: null,
    line: { id: 'A', name: 'A', longName: '8 Avenue Express' },
    destination: { name: 'Far Rockaway-Mott Av', basis: 'last-stop' },
    position: {
      lat: 40.768,
      lon: -73.982,
      basis: 'predicted',
      marginMeters: null,
      dataTime: minutesBefore(0.5),
      station: { id: 'A24', name: '59 St-Columbus Circle', status: 'arriving' },
      stall: null,
    },
    ...NO_DETAILS,
    stops: [{ id: 'A25', name: '50 St', arrival: minutesAfter(2), departure: null }],
    delaySeconds: null,
    ...overrides,
  };
}

/** M15 bus 7652 by GPS, 8 minutes behind its timetable by Bus Time. */
export function m15Bus(overrides: Partial<LiveVehicle> = {}): LiveVehicle {
  return {
    id: 'bus:MTA NYCT_7652',
    mode: 'bus',
    sourceId: 'mta-bus-positions',
    name: '7652',
    operator: null,
    line: { id: 'M15', name: 'M15', longName: 'East Side Local' },
    destination: { name: 'South Ferry', basis: 'timetable' },
    position: {
      lat: 40.739,
      lon: -73.979,
      basis: 'gps',
      marginMeters: 25,
      dataTime: minutesBefore(0.5),
      station: null,
      stall: null,
    },
    ...NO_DETAILS,
    stops: [{ id: '401', name: '1 Av/E 23 St', arrival: minutesAfter(3), departure: null }],
    delaySeconds: 480,
    ...overrides,
  };
}
