import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { DAY, MINUTE, MTA_PROVIDER, count } from '../mta/provider.js';
import { listFailures, readJsonList } from './json-list.js';
import { PORTAL_FAILURES } from './portal.js';

/** The GTFS id of a subway or Staten Island Railway station, as in `stops.txt` (`101`, `R01`). */
const stationIdSchema = z.string().regex(/^[0-9A-Z]{3}$/);

/** One row of the MTA Subway Stations dataset, with the columns asked for. */
const stationRow = z.object({
  gtfs_stop_id: stationIdSchema,
  complex_id: z.string().regex(/^\d+$/),
  stop_name: z.string().min(1),
  ada: z.enum(['0', '1', '2']),
  ada_northbound: z.enum(['0', '1']),
  ada_southbound: z.enum(['0', '1']),
  /** Free text, or `NaN` (as a string) when the station has none; left out by the portal if null. */
  ada_notes: z.string().optional(),
});

const stationSchema = z.object({
  name: z.string().min(1),
  /** The station complex: stations joined inside fare control, as Times Sq-42 St. */
  complex: z.string().min(1),
  /** The dataset's `ada`: fully accessible, accessible in one direction only, or not at all. */
  ada: z.enum(['full', 'partial', 'none']),
  /** Step-free to and from the northbound and southbound platforms (`N` and `S` in GTFS). */
  northbound: z.boolean(),
  southbound: z.boolean(),
  /** The dataset's `ada_notes`, as "Uptown local only", or null without one. */
  note: z.string().min(1).nullable(),
});

const subwayStationsSchema = z.object({
  /** When the list was read: the rows carry no time of their own. */
  readAt: instantSchema,
  /** By GTFS station id. */
  stations: z.record(stationIdSchema, stationSchema),
});

export type SubwayStations = z.infer<typeof subwayStationsSchema>;

const ADA = { '0': 'none', '1': 'full', '2': 'partial' } as const;

function noteOf(text: string | undefined): string | null {
  const note = text?.trim() ?? '';
  return note === '' || note === 'NaN' ? null : note;
}

/** 496 stations on 11/11/2026; a list with far fewer is cut. */
const MINIMUM_STATIONS = 450;

function parseStations(body: Uint8Array, receivedAt: Date): ParseResult<SubwayStations> {
  const read = readJsonList(body, z.array(stationRow));
  if (!read.ok) return read;
  const stations: SubwayStations['stations'] = {};
  for (const row of read.rows) {
    if (stations[row.gtfs_stop_id] !== undefined) {
      return { ok: false, code: 'check-failed', detail: `station ${row.gtfs_stop_id} twice` };
    }
    stations[row.gtfs_stop_id] = {
      name: row.stop_name,
      complex: row.complex_id,
      ada: ADA[row.ada],
      northbound: row.ada_northbound === '1',
      southbound: row.ada_southbound === '1',
      note: noteOf(row.ada_notes),
    };
  }
  const all = Object.values(stations);
  const full = all.filter((station) => station.ada === 'full').length;
  const partial = all.filter((station) => station.ada === 'partial').length;
  return {
    ok: true,
    data: { readAt: toInstant(receivedAt), stations },
    dataTime: receivedAt,
    coverage: `${count(all.length, 'stations')}: ${String(full)} accessible, ${String(partial)} in one direction`,
  };
}

/**
 * Which subway stations are step-free, from the MTA Subway Stations dataset on data.ny.gov
 * (`39hk-dx4f`), joined to the subway timetable by its GTFS stop id: on 11/11/2026 its 496
 * stations and the 496 of `stops.txt` matched one to one.
 */
export const mtaSubwayStations: SourceDefinition<SubwayStations> = {
  id: 'mta-subway-stations',
  title: 'MTA subway stations and their accessibility',
  provider: MTA_PROVIDER,
  licence: {
    name: 'MTA Open Data on data.ny.gov',
    url: 'https://www.mta.info/open-data',
    attribution: 'MTA Subway Stations, Metropolitan Transportation Authority (data.ny.gov)',
  },
  kind: 'static',
  // The rows were last changed on 10/11/2026; stations become accessible a few times a year.
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 3 * DAY, staleAfterMs: 14 * DAY, unavailableAfterMs: 60 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 2,
  dataSchema: subwayStationsSchema,
  request() {
    const select = 'gtfs_stop_id,complex_id,stop_name,ada,ada_northbound,ada_southbound,ada_notes';
    return {
      url: `https://data.ny.gov/resource/39hk-dx4f.json?$select=${select}&$order=gtfs_stop_id&$limit=2000`,
    };
  },
  parse(body, context) {
    return parseStations(body, context.receivedAt);
  },
  check(data) {
    const stations = Object.keys(data.stations).length;
    return stations < MINIMUM_STATIONS
      ? [`${count(stations, 'stations')}, minimum ${String(MINIMUM_STATIONS)}`]
      : [];
  },
  consumers: ['step-free'],
  failures: listFailures(PORTAL_FAILURES, `Fewer than ${String(MINIMUM_STATIONS)} stations`),
};
