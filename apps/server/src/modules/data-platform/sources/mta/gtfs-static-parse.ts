import { toInstant } from '@moviq/contracts';

import type { ParseContext, ParseResult } from '../../definition.js';
import { fromGtfsDate, newYorkGtfsDate } from '../../../../infrastructure/clock/new-york.js';
import type { CsvRecordHandler } from './csv.js';
import { brokenReference, notValidToday } from './gtfs-static-checks.js';
import { describeIndex, encodedShapes, toIndex } from './gtfs-static-index.js';
import {
  emptyTables,
  shapeCollector,
  tableCollectors,
  transferCollector,
  type GtfsTables,
} from './gtfs-static-rows.js';
import type { GtfsIndex, GtfsStopTimes } from './gtfs-static-schema.js';
import { stopTimesReader } from './gtfs-stop-times.js';
import { readZipTables, zipEnvelope } from './zip.js';

/**
 * Where the publication time of a timetable is read from:
 * - `feed-version`: the date that starts `feed_version` (the MTA writes `20261028-…`);
 * - `archive`: the latest modification time of the entries, written in New York time (bus
 *   archives date every entry 1980-01-01, which means no date at all);
 * - `receipt`: the file carries no trustworthy time, so the time of receipt stands in.
 */
export type PublicationTime = 'feed-version' | 'archive' | 'receipt';

export interface GtfsArchiveOptions {
  /** The rules that date the file, tried in order until one gives a time. */
  readonly dating: readonly PublicationTime[];
  /** Read `shapes.txt` into one encoded polyline per shape. */
  readonly shapes: boolean;
  /** Read `stop_times.txt` and `transfers.txt`, the tables only routing needs. */
  readonly routing: boolean;
}

type Refusal = Extract<ParseResult<GtfsIndex>, { ok: false }>;

/** The files every GTFS feed must carry; a group is met by any one of its files. */
const REQUIRED_FILES = [
  ['agency.txt'],
  ['stops.txt'],
  ['routes.txt'],
  ['trips.txt'],
  ['stop_times.txt'],
  ['calendar.txt', 'calendar_dates.txt'],
] as const;

function refuse(code: string, detail: string): Refusal {
  return { ok: false, code, detail };
}

/**
 * The folder every entry sits in (`siferry-gtfs_2026.1/`), or `''` when the tables are at the
 * root. Only one common folder is accepted: a deeper or mixed layout is not a GTFS file.
 */
function commonFolder(names: Iterable<string>): string {
  const files = [...names].filter((name) => !name.endsWith('/'));
  const [first = ''] = files;
  const slash = first.indexOf('/');
  if (slash <= 0) return '';
  const folder = first.slice(0, slash + 1);
  const nested = files.every(
    (name) => name.startsWith(folder) && !name.slice(folder.length).includes('/'),
  );
  return nested ? folder : '';
}

/**
 * The required files that the directory lacks or lists without data, read from the sizes alone,
 * so `stop_times.txt` is checked without decompressing it.
 */
function missingFiles(sizes: ReadonlyMap<string, number>, folder: string): string | undefined {
  const lacking = REQUIRED_FILES.filter((group) =>
    group.every((file) => (sizes.get(folder + file) ?? 0) === 0),
  ).map((group) =>
    group
      .map((file) => `${file} is ${sizes.has(folder + file) ? 'empty' : 'missing'}`)
      .join(' and '),
  );
  return lacking.length === 0 ? undefined : lacking.join(', ');
}

interface Dated {
  readonly at: Date;
  readonly rule: PublicationTime;
}

function dateBy(
  rule: PublicationTime,
  tables: GtfsTables,
  modifiedAt: Date | undefined,
  receivedAt: Date,
): Date | undefined {
  if (rule === 'receipt') return receivedAt;
  if (rule === 'archive') return modifiedAt;
  const versionDate = /^(\d{8})/.exec(tables.feedInfo?.version ?? '')?.[1];
  return versionDate === undefined ? undefined : fromGtfsDate(versionDate);
}

function publicationTime(
  rules: readonly PublicationTime[],
  tables: GtfsTables,
  modifiedAt: Date | undefined,
  receivedAt: Date,
): Dated | undefined {
  for (const rule of rules) {
    const at = dateBy(rule, tables, modifiedAt, receivedAt);
    if (at !== undefined) return { at, rule };
  }
  return undefined;
}

interface Read {
  readonly tables: GtfsTables;
  readonly stopTimes: GtfsStopTimes | undefined;
}

/** Decompresses the tables the options ask for, by streaming, and collects them. */
function readTables(
  body: Uint8Array,
  sizes: ReadonlyMap<string, number>,
  folder: string,
  options: GtfsArchiveOptions,
): Read | Refusal {
  const tables = emptyTables();
  const stopTimes = options.routing ? stopTimesReader() : undefined;
  const handlers = new Map<string, CsvRecordHandler>(tableCollectors(tables));
  if (options.shapes) handlers.set('shapes.txt', shapeCollector(tables));
  if (stopTimes !== undefined) {
    handlers.set('stop_times.txt', stopTimes.onRecord);
    handlers.set('transfers.txt', transferCollector(tables));
  }
  const inFolder = new Map([...handlers].map(([name, handler]) => [folder + name, handler]));
  const read = readZipTables(body, sizes, inFolder);
  if (!read.ok) return read;
  if (tables.invalid !== undefined) return refuse('invalid-row', tables.invalid);
  const calls = stopTimes?.finish();
  if (calls?.ok === false) return refuse('invalid-row', calls.detail);
  return { tables, stopTimes: calls?.stopTimes };
}

/** The publication checks: dated, not after receipt and not older than the version served. */
function dated(
  rules: readonly PublicationTime[],
  tables: GtfsTables,
  modifiedAt: Date | undefined,
  context: ParseContext<GtfsIndex>,
): Date | Refusal {
  const published = publicationTime(rules, tables, modifiedAt, context.receivedAt);
  if (published === undefined) {
    return refuse('no-publication-time', `no ${rules.join(' or ')} time in the archive`);
  }
  const { at, rule } = published;
  if (at > context.receivedAt) {
    return refuse('future-publication', `published ${toInstant(at)}, after receipt`);
  }
  const served = context.previous?.feed.publishedAt;
  if (rule !== 'receipt' && served !== undefined && toInstant(at) < served) {
    return refuse('older-than-served', `published ${toInstant(at)}; served ${served}`);
  }
  return at;
}

/**
 * Reads a static GTFS archive, with its tables at the root or in one folder, into the compact
 * index of `gtfs-static-schema.ts`. Every required file must be listed with data; then the
 * tables asked for are decompressed by streaming, references and today's calendar are checked,
 * and the index is built. Tables not asked for are skipped unread.
 */
export function parseGtfsArchive(
  body: Uint8Array,
  context: ParseContext<GtfsIndex>,
  options: GtfsArchiveOptions,
): ParseResult<GtfsIndex> {
  const envelope = zipEnvelope(body);
  if (!envelope.ok) return envelope;
  const folder = commonFolder(envelope.sizes.keys());
  const missing = missingFiles(envelope.sizes, folder);
  if (missing !== undefined) return refuse('missing-file', missing);
  const read = readTables(body, envelope.sizes, folder, options);
  if ('ok' in read) return read;
  const { tables, stopTimes } = read;
  const publishedAt = dated(options.dating, tables, envelope.modifiedAt, context);
  if (!(publishedAt instanceof Date)) return publishedAt;
  const broken = brokenReference(tables, stopTimes);
  if (broken !== undefined) return refuse('broken-reference', broken);
  const invalidToday = notValidToday(tables, newYorkGtfsDate(context.receivedAt));
  if (invalidToday) return invalidToday;
  const shapes = options.shapes ? encodedShapes(tables) : undefined;
  if (shapes?.ok === false) return shapes;
  const index = toIndex(tables, publishedAt, {
    shapes: shapes?.shapes,
    routing: stopTimes === undefined ? undefined : { stopTimes, transfers: tables.transfers },
  });
  const omitted = [...tables.shapes.values()].filter((points) => points.length === 1).length;
  const coverage = [
    describeIndex(index),
    ...(omitted === 0
      ? []
      : [`${String(omitted)} single-point shape${omitted === 1 ? '' : 's'} omitted`]),
  ].join(', ');
  return { ok: true, data: index, dataTime: publishedAt, coverage };
}

/**
 * An MTA timetable: dated by `feed_version`, else by the archive, with shapes for the map and
 * stop times and transfers for routing.
 */
export function parseGtfsStatic(
  body: Uint8Array,
  context: ParseContext<GtfsIndex>,
): ParseResult<GtfsIndex> {
  return parseGtfsArchive(body, context, {
    dating: ['feed-version', 'archive'],
    shapes: true,
    routing: true,
  });
}
