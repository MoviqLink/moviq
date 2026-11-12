import { z } from 'zod';

import { csvRows, type CsvRecordHandler } from './csv.js';
import type {
  GtfsRoute,
  GtfsService,
  GtfsStop,
  GtfsTransfer,
  GtfsTrip,
} from './gtfs-static-schema.js';
import type { ShapePoint } from './polyline.js';

const id = z.string().min(1);
const optionalText = z
  .string()
  .default('')
  .transform((value) => (value === '' ? null : value));
const gtfsDate = z.string().regex(/^\d{8}$/);
const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .transform(Number);
const flag = z.enum(['0', '1']).transform((value) => value === '1');

const routeRow = z.object({
  route_id: id,
  route_short_name: optionalText,
  route_long_name: optionalText,
  route_type: z.string().regex(/^\d+$/).transform(Number),
  route_color: optionalText,
  route_text_color: optionalText,
});

const stopRow = z.object({
  stop_id: id,
  stop_name: id,
  stop_lat: decimal.pipe(z.number().min(-90).max(90)),
  stop_lon: decimal.pipe(z.number().min(-180).max(180)),
  location_type: z.enum(['', '0', '1', '2', '3', '4']).default(''),
  parent_station: optionalText,
  wheelchair_boarding: z.enum(['', '0', '1', '2']).default(''),
});

const tripRow = z.object({
  route_id: id,
  service_id: id,
  trip_id: id,
  trip_headsign: optionalText,
  trip_short_name: optionalText,
  direction_id: z
    .enum(['', '0', '1'])
    .default('')
    .transform((value) => (value === '' ? null : value === '1' ? 1 : 0)),
  shape_id: optionalText,
});

const shapeRow = z.object({
  shape_id: id,
  shape_pt_lat: decimal.pipe(z.number().min(-90).max(90)),
  shape_pt_lon: decimal.pipe(z.number().min(-180).max(180)),
  shape_pt_sequence: z.string().regex(/^\d+$/).transform(Number),
});

/** Types 4 and 5 are about staying on board from one trip to the next, not a change of stop. */
const transferRow = z.object({
  from_stop_id: id,
  to_stop_id: id,
  transfer_type: z.enum(['', '0', '1', '2', '3', '4', '5']).default(''),
  min_transfer_time: z.string().regex(/^\d*$/).default(''),
});

const TRANSFER_TYPES = new Map<string, GtfsTransfer['type']>([
  ['', 0],
  ['0', 0],
  ['1', 1],
  ['2', 2],
  ['3', 3],
]);

const calendarRow = z.object({
  service_id: id,
  monday: flag,
  tuesday: flag,
  wednesday: flag,
  thursday: flag,
  friday: flag,
  saturday: flag,
  sunday: flag,
  start_date: gtfsDate,
  end_date: gtfsDate,
});

const calendarDateRow = z.object({
  service_id: id,
  date: gtfsDate,
  exception_type: z.enum(['1', '2']),
});

const feedInfoRow = z.object({
  feed_publisher_name: optionalText,
  feed_version: optionalText,
  feed_start_date: gtfsDate.or(z.literal('')).default(''),
  feed_end_date: gtfsDate.or(z.literal('')).default(''),
});

interface FeedInfo {
  readonly publisher: string | null;
  readonly version: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
}

/** One row of `shapes.txt`: a point and its place in the shape. */
interface SequencedPoint extends ShapePoint {
  readonly sequence: number;
}

/** Everything read from the tables, before references and calendars are checked. */
export interface GtfsTables {
  readonly routes: Map<string, GtfsRoute>;
  readonly stops: Map<string, GtfsStop>;
  readonly trips: Map<string, GtfsTrip>;
  readonly services: Map<string, GtfsService>;
  /** The points of each shape in the order of the file; empty unless `shapes.txt` is read. */
  readonly shapes: Map<string, SequencedPoint[]>;
  /** Empty unless `transfers.txt` is read. */
  readonly transfers: GtfsTransfer[];
  feedInfo: FeedInfo | undefined;
  /** The first row that did not validate, as `file row n: field message`. */
  invalid: string | undefined;
}

function serviceOf(tables: GtfsTables, serviceId: string): GtfsService {
  const known = tables.services.get(serviceId);
  if (known) return known;
  const created: GtfsService = { days: null, start: null, end: null, added: [], removed: [] };
  tables.services.set(serviceId, created);
  return created;
}

/** A stop; `wheelchair_boarding` is kept only when it says something (1 or 2). */
function stopOf(row: z.output<typeof stopRow>): GtfsStop {
  const access = row.wheelchair_boarding;
  return {
    name: row.stop_name,
    lat: row.stop_lat,
    lon: row.stop_lon,
    parent: row.parent_station,
    station: row.location_type === '1',
    ...(access === '1' || access === '2' ? { wheelchairBoarding: access === '1' ? 1 : 2 } : {}),
  };
}

function collector<S extends z.ZodType>(
  tables: GtfsTables,
  file: string,
  schema: S,
  store: (row: z.output<S>) => void,
): CsvRecordHandler {
  let line = 1;
  return csvRows((row) => {
    line += 1;
    if (tables.invalid !== undefined) return;
    const parsed = schema.safeParse(row);
    if (parsed.success) {
      store(parsed.data);
      return;
    }
    const issue = parsed.error.issues[0];
    tables.invalid = `${file} row ${String(line)}: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`;
  });
}

/** The row handlers for each table MovIQ reads, all writing into `tables`. */
export function tableCollectors(tables: GtfsTables): ReadonlyMap<string, CsvRecordHandler> {
  return new Map([
    [
      'routes.txt',
      collector(tables, 'routes.txt', routeRow, (row) => {
        tables.routes.set(row.route_id, {
          shortName: row.route_short_name,
          longName: row.route_long_name,
          type: row.route_type,
          color: row.route_color,
          textColor: row.route_text_color,
        });
      }),
    ],
    [
      'stops.txt',
      collector(tables, 'stops.txt', stopRow, (row) => {
        tables.stops.set(row.stop_id, stopOf(row));
      }),
    ],
    [
      'trips.txt',
      collector(tables, 'trips.txt', tripRow, (row) => {
        tables.trips.set(row.trip_id, {
          route: row.route_id,
          service: row.service_id,
          headsign: row.trip_headsign,
          ...(row.trip_short_name === null ? {} : { shortName: row.trip_short_name }),
          direction: row.direction_id,
          shape: row.shape_id,
        });
      }),
    ],
    [
      'calendar.txt',
      collector(tables, 'calendar.txt', calendarRow, (row) => {
        const service = serviceOf(tables, row.service_id);
        tables.services.set(row.service_id, {
          ...service,
          days: [
            row.monday,
            row.tuesday,
            row.wednesday,
            row.thursday,
            row.friday,
            row.saturday,
            row.sunday,
          ],
          start: row.start_date,
          end: row.end_date,
        });
      }),
    ],
    [
      'calendar_dates.txt',
      collector(tables, 'calendar_dates.txt', calendarDateRow, (row) => {
        const service = serviceOf(tables, row.service_id);
        (row.exception_type === '1' ? service.added : service.removed).push(row.date);
      }),
    ],
    [
      'feed_info.txt',
      collector(tables, 'feed_info.txt', feedInfoRow, (row) => {
        tables.feedInfo ??= {
          publisher: row.feed_publisher_name,
          version: row.feed_version,
          startDate: row.feed_start_date === '' ? null : row.feed_start_date,
          endDate: row.feed_end_date === '' ? null : row.feed_end_date,
        };
      }),
    ],
  ]);
}

/** The row handler for `shapes.txt`, for a parser that indexes shapes as well. */
export function shapeCollector(tables: GtfsTables): CsvRecordHandler {
  return collector(tables, 'shapes.txt', shapeRow, (row) => {
    const point = { lat: row.shape_pt_lat, lon: row.shape_pt_lon, sequence: row.shape_pt_sequence };
    const points = tables.shapes.get(row.shape_id);
    if (points === undefined) tables.shapes.set(row.shape_id, [point]);
    else points.push(point);
  });
}

/** The row handler for `transfers.txt`, for a parser that reads what routing needs. */
export function transferCollector(tables: GtfsTables): CsvRecordHandler {
  return collector(tables, 'transfers.txt', transferRow, (row) => {
    const type = TRANSFER_TYPES.get(row.transfer_type);
    if (type === undefined) return;
    tables.transfers.push({
      from: row.from_stop_id,
      to: row.to_stop_id,
      type,
      minSeconds: row.min_transfer_time === '' ? null : Number(row.min_transfer_time),
    });
  });
}

export function emptyTables(): GtfsTables {
  return {
    routes: new Map(),
    stops: new Map(),
    trips: new Map(),
    services: new Map(),
    shapes: new Map(),
    transfers: [],
    feedInfo: undefined,
    invalid: undefined,
  };
}
