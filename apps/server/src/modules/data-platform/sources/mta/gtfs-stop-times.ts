import { detached, type CsvRecordHandler } from './csv.js';
import type { GtfsStopTimes } from './gtfs-static-schema.js';
import { NO_DROP_OFF, NO_PICKUP } from './stop-times-codec.js';
import { tripRuns, type TripRuns } from './stop-times-runs.js';

const FILE = 'stop_times.txt';
const COLON = 58;

/** The decimal number written from `from` to `to`, or -1 when a character is not a digit. */
function digits(text: string, from: number, to: number): number {
  let value = 0;
  for (let at = from; at < to; at += 1) {
    const digit = text.charCodeAt(at) - 48;
    if (!(digit >= 0 && digit <= 9)) return -1;
    value = value * 10 + digit;
  }
  return value;
}

/**
 * `H:MM:SS` with one to three digits of hours (past 24:00 allowed) as seconds, or -1. Read by
 * character codes: 2.4 M rows hold two times each.
 */
function gtfsSeconds(text: string): number {
  const colon = text.length - 6;
  if (colon < 1 || colon > 3) return -1;
  if (text.charCodeAt(colon) !== COLON || text.charCodeAt(colon + 3) !== COLON) return -1;
  const hours = digits(text, 0, colon);
  const minutes = digits(text, colon + 1, colon + 3);
  const seconds = digits(text, colon + 4, colon + 6);
  if (hours < 0 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return -1;
  return hours * 3600 + minutes * 60 + seconds;
}

/** A `stop_sequence`: a whole number of one to nine digits, or -1. */
function sequenceOf(text: string): number {
  return text.length === 0 || text.length > 9 ? -1 : digits(text, 0, text.length);
}

/** GTFS `pickup_type` and `drop_off_type`: empty or 0 to 3; -1 if not one of them. */
function boardingType(text: string): number {
  if (text === '') return 0;
  const value = text.length === 1 ? digits(text, 0, 1) : -1;
  return value > 3 ? -1 : value;
}

/** Numbers an id by its first appearance, keeping a copy of each new one. */
function numbering(): { readonly ids: string[]; of(id: string): number } {
  const ids: string[] = [];
  const known = new Map<string, number>();
  return {
    ids,
    of(id) {
      const found = known.get(id);
      if (found !== undefined) return found;
      const copy = detached(id);
      known.set(copy, ids.length);
      ids.push(copy);
      return ids.length - 1;
    },
  };
}

interface Rows {
  readonly trips: ReturnType<typeof numbering>;
  readonly stops: ReturnType<typeof numbering>;
  readonly runs: TripRuns;
}

/** Where each column is in a row; -1 for an optional column the file leaves out. */
interface Header {
  readonly trip: number;
  readonly stop: number;
  readonly arrival: number;
  readonly departure: number;
  readonly sequence: number;
  readonly pickup: number;
  readonly dropOff: number;
}

/** The positions of the columns read, or the first required one the header lacks. */
function headerOf(fields: readonly string[]): Header | string {
  const position = (name: string): number => fields.indexOf(name);
  const header: Header = {
    trip: position('trip_id'),
    stop: position('stop_id'),
    arrival: position('arrival_time'),
    departure: position('departure_time'),
    sequence: position('stop_sequence'),
    pickup: position('pickup_type'),
    dropOff: position('drop_off_type'),
  };
  const names = ['trip_id', 'stop_id', 'arrival_time', 'departure_time', 'stop_sequence'];
  const required = [header.trip, header.stop, header.arrival, header.departure, header.sequence];
  const lacking = names[required.indexOf(-1)];
  return lacking === undefined ? header : `${FILE}: no ${lacking} column`;
}

/** Stores one row, or says which field breaks the GTFS format. */
function storeRow(rows: Rows, fields: readonly string[], at: Header): string | undefined {
  const tripId = fields[at.trip] ?? '';
  const stopId = fields[at.stop] ?? '';
  const arrival = gtfsSeconds(fields[at.arrival] ?? '');
  const departure = gtfsSeconds(fields[at.departure] ?? '');
  const sequence = sequenceOf(fields[at.sequence] ?? '');
  const pickup = boardingType(fields[at.pickup] ?? '');
  const dropOff = boardingType(fields[at.dropOff] ?? '');
  if (tripId === '' || stopId === '') return 'trip_id and stop_id are required';
  if (arrival < 0) return 'arrival_time is not H:MM:SS';
  if (departure < 0) return 'departure_time is not H:MM:SS';
  if (sequence < 0) return 'stop_sequence is not a whole number';
  if (pickup < 0 || dropOff < 0) return 'pickup_type and drop_off_type are 0 to 3';
  const flags = (pickup === 1 ? NO_PICKUP : 0) | (dropOff === 1 ? NO_DROP_OFF : 0);
  rows.runs.add(rows.trips.of(tripId), rows.stops.of(stopId), sequence, arrival, departure, flags);
  return undefined;
}

export interface StopTimesReader {
  readonly onRecord: CsvRecordHandler;
  /** After the table: every trip's calls in the compact form, or the first row that is invalid. */
  finish(): { ok: true; stopTimes: GtfsStopTimes } | { ok: false; detail: string };
}

/**
 * Reads `stop_times.txt` as it streams, without an object per row: ids are numbered on first
 * sight, every field is checked against the GTFS reference, and each run of rows of one trip is
 * put in `stop_sequence` order and encoded as soon as it ends (`stop-times-runs.ts`).
 */
export function stopTimesReader(): StopTimesReader {
  const rows: Rows = { trips: numbering(), stops: numbering(), runs: tripRuns() };
  let header: Header | undefined;
  let invalid: string | undefined;
  let line = 0;
  return {
    onRecord(fields) {
      line += 1;
      if (invalid !== undefined) return;
      if (header === undefined) {
        const read = headerOf(fields);
        if (typeof read === 'string') invalid = read;
        else header = read;
        return;
      }
      const problem = storeRow(rows, fields, header);
      if (problem !== undefined) invalid = `${FILE} row ${String(line)}: ${problem}`;
    },
    finish() {
      if (invalid !== undefined) return { ok: false, detail: invalid };
      const calls = rows.runs.finish(rows.trips.ids, rows.stops.ids.length);
      if (!calls.ok) return calls;
      return {
        ok: true,
        stopTimes: { stops: rows.stops.ids, trips: rows.trips.ids, calls: calls.calls },
      };
    },
  };
}
