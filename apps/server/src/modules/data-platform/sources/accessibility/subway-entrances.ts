import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, refuse } from '../city/parsing.js';
import { DAY, MINUTE, MTA_PROVIDER, count } from '../mta/provider.js';
import { socrataFailures } from '../street/socrata.js';

/** The GTFS id of a subway or Staten Island Railway station, as in `stops.txt` (`101`, `R01`). */
const stationIdSchema = z.string().regex(/^[0-9A-Z]{3}$/);

const yesNo = z.enum(['YES', 'NO']).transform((value) => value === 'YES');
const degrees = z.string().transform(Number).pipe(z.number().min(-180).max(180));

/** One row of "MTA Subway Entrances and Exits: 2024" (`i9wp-a4ja`), with the columns asked. */
const entranceRow = z.object({
  station_id: z.string().min(1),
  /** One GTFS station, or several for an entrance shared by two (`A12; D13`). */
  gtfs_stop_id: z.string().min(1),
  complex_id: z.string().min(1),
  stop_name: z.string().min(1),
  entrance_type: z.string().min(1),
  entry_allowed: yesNo,
  exit_allowed: yesNo,
  entrance_latitude: degrees,
  entrance_longitude: degrees,
});

const subwayEntranceSchema = z.object({
  /** The GTFS stations the entrance leads to: one, or two for a shared entrance. */
  stations: z.array(stationIdSchema).min(1),
  /** The MTA station complex, which groups the stations of one transfer. */
  complex: z.string().min(1),
  name: z.string().min(1),
  /**
   * As the dataset names it: `Stair`, `Elevator`, `Escalator`, `Ramp`, `Station House`,
   * `Easement - Street`, `Stair/Escalator` and a few more. Only `Elevator` and `Ramp` are step-free.
   */
  type: z.string().min(1),
  /** Whether the entrance lets people in and out; 48 are exit only and 7 entry only. */
  entry: z.boolean(),
  exit: z.boolean(),
  point: z.tuple([z.number(), z.number()]),
});

const subwayEntrancesSchema = z.object({
  /** When the list was read: it is a 2024 survey, not the state of an entrance now. */
  readAt: instantSchema,
  entrances: z.array(subwayEntranceSchema),
});

type SubwayEntrance = z.infer<typeof subwayEntranceSchema>;
export type SubwayEntrances = z.infer<typeof subwayEntrancesSchema>;

const DATASET = 'https://data.ny.gov/resource/i9wp-a4ja.json';

/** 2,120 entrances on 11/11/2026. */
const MINIMUM_ENTRANCES = 1_800;

function toEntrance(row: z.infer<typeof entranceRow>): SubwayEntrance | undefined {
  const stations = stationIdSchema
    .array()
    .safeParse(row.gtfs_stop_id.split(';').map((id) => id.trim()));
  if (!stations.success) return undefined;
  return {
    stations: stations.data,
    complex: row.complex_id,
    name: row.stop_name,
    type: row.entrance_type,
    entry: row.entry_allowed,
    exit: row.exit_allowed,
    point: [row.entrance_longitude, row.entrance_latitude],
  };
}

function parseEntrances(body: Uint8Array, receivedAt: Date): ParseResult<SubwayEntrances> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const rows = z.array(entranceRow).safeParse(decoded.value);
  if (!rows.success) return refuse('unexpected-shape', describeIssue(rows.error));
  const entrances: SubwayEntrance[] = [];
  for (const row of rows.data) {
    const entrance = toEntrance(row);
    if (entrance === undefined) {
      return refuse('unexpected-shape', `station ${row.station_id}: GTFS id "${row.gtfs_stop_id}"`);
    }
    entrances.push(entrance);
  }
  const elevators = entrances.filter((entrance) => entrance.type === 'Elevator').length;
  return {
    ok: true,
    data: { readAt: toInstant(receivedAt), entrances },
    dataTime: receivedAt,
    coverage: `${count(entrances.length, 'entrances')}, ${count(elevators, 'elevators')}`,
  };
}

/**
 * Every subway entrance and exit with the GTFS stations it leads to, its type and whether it
 * lets people in or out, from "MTA Subway Entrances and Exits: 2024" on data.ny.gov
 * (`i9wp-a4ja`). It is a survey: it does not say whether an entrance is open now. Joined by
 * `gtfs_stop_id`: on 11/11/2026 every one of its ids named a station of `stops.txt`, while three
 * `station_id`s (12, 28 and 517) each stood for two GTFS stations. Read daily.
 */
export const mtaSubwayEntrances: SourceDefinition<SubwayEntrances> = {
  id: 'mta-subway-entrances',
  title: 'MTA subway entrances and exits',
  provider: MTA_PROVIDER,
  licence: {
    name: 'MTA Open Data on data.ny.gov',
    url: 'https://www.mta.info/open-data',
    attribution: 'MTA Subway Entrances and Exits: 2024, Metropolitan Transportation Authority',
  },
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 3 * DAY, staleAfterMs: 14 * DAY, unavailableAfterMs: 60 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 4 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 2,
  dataSchema: subwayEntrancesSchema,
  request() {
    const select = [
      'station_id',
      'gtfs_stop_id',
      'complex_id',
      'stop_name',
      'entrance_type',
      'entry_allowed',
      'exit_allowed',
      'entrance_latitude',
      'entrance_longitude',
    ].join(',');
    return {
      url: `${DATASET}?$select=${select}&$order=station_id,entrance_latitude&$limit=5000`,
    };
  },
  parse(body, { receivedAt }) {
    return parseEntrances(body, receivedAt);
  },
  check(data) {
    return data.entrances.length < MINIMUM_ENTRANCES
      ? [`${count(data.entrances.length, 'entrances')}, minimum ${String(MINIMUM_ENTRANCES)}`]
      : [];
  },
  consumers: ['step-free', 'live-map', 'trip-planning'],
  failures: socrataFailures('data.ny.gov', `Fewer than ${String(MINIMUM_ENTRANCES)} entrances`),
};
