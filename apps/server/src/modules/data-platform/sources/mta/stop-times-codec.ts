/**
 * Stop times as text in the characters of encoded polylines (`polyline.ts`): signed numbers in
 * zigzag form, five bits per character from ASCII 63. Each trip is the number of its calls, then
 * for each call the change of stop index, the change of departure time and the time spent at the
 * stop times four plus the flags. Trips of a route repeat the same small numbers, so the stored
 * JSON compresses well (Brooklyn buses: 2.4 M calls in 12.0 MB, 1.0 MB with gzip).
 */

/** Flags of a call: GTFS `pickup_type` 1 and `drop_off_type` 1. */
export const NO_PICKUP = 1;
export const NO_DROP_OFF = 2;

/** The calls of one trip in `stop_sequence` order: stop indexes and seconds of the service day. */
export interface TripCalls {
  readonly stop: ArrayLike<number>;
  readonly arrival: ArrayLike<number>;
  readonly departure: ArrayLike<number>;
  readonly flags: ArrayLike<number>;
}

/** Where decoded calls are written. */
export interface CallColumns {
  readonly stop: Int32Array;
  readonly arrival: Int32Array;
  readonly departure: Int32Array;
  readonly flags: Uint8Array;
}

/** Encoded text as character codes, read from a string or from bytes. */
export interface Codes {
  readonly length: number;
  codeAt(at: number): number;
}

export function codesOf(text: string): Codes {
  return { length: text.length, codeAt: (at) => text.charCodeAt(at) };
}

/** Bytes that grow as trips are written; every character of the format is ASCII. */
export interface CodeBuffer {
  readonly length: number;
  push(code: number): void;
  codes(from: number, to: number): Codes;
  text(): string;
}

export function codeBuffer(): CodeBuffer {
  let bytes = new Uint8Array(1 << 16);
  let length = 0;
  return {
    get length() {
      return length;
    },
    push(code) {
      if (length === bytes.length) {
        const grown = new Uint8Array(bytes.length * 2);
        grown.set(bytes);
        bytes = grown;
      }
      bytes[length] = code;
      length += 1;
    },
    codes(from, to) {
      const view = bytes.subarray(from, to);
      return { length: view.length, codeAt: (at) => view[at] ?? 0 };
    },
    text: () => new TextDecoder().decode(bytes.subarray(0, length)),
  };
}

function pushNumber(buffer: CodeBuffer, value: number): void {
  let rest = value < 0 ? ~(value << 1) : value << 1;
  while (rest >= 0x20) {
    buffer.push((0x20 | (rest & 0x1f)) + 63);
    rest >>= 5;
  }
  buffer.push(rest + 63);
}

/** Appends one trip with at least one call. */
export function writeTrip(buffer: CodeBuffer, calls: TripCalls): void {
  pushNumber(buffer, calls.stop.length);
  let stop = 0;
  let departure = 0;
  for (let at = 0; at < calls.stop.length; at += 1) {
    const nextStop = calls.stop[at] ?? 0;
    const nextDeparture = calls.departure[at] ?? 0;
    const dwell = nextDeparture - (calls.arrival[at] ?? 0);
    pushNumber(buffer, nextStop - stop);
    pushNumber(buffer, nextDeparture - departure);
    pushNumber(buffer, dwell * 4 + ((calls.flags[at] ?? 0) & 3));
    stop = nextStop;
    departure = nextDeparture;
  }
}

/** Seven characters of five bits hold any 32-bit number. */
const MAX_BITS = 35;

/** A reading position in encoded text; `at` is -1 once the text breaks the format. */
interface Cursor {
  at: number;
}

function readNumber(codes: Codes, cursor: Cursor): number {
  let result = 0;
  for (let shift = 0; shift < MAX_BITS && cursor.at >= 0; shift += 5) {
    const chunk = cursor.at < codes.length ? codes.codeAt(cursor.at) - 63 : -1;
    if (chunk < 0 || chunk > 63) break;
    cursor.at += 1;
    result |= (chunk & 0x1f) << shift;
    if (chunk < 0x20) return result & 1 ? ~(result >> 1) : result >> 1;
  }
  cursor.at = -1;
  return 0;
}

/** The number of trips and calls in encoded text, or undefined when it breaks the format. */
export function countCalls(
  codes: Codes,
): { readonly trips: number; readonly calls: number } | undefined {
  const cursor = { at: 0 };
  let trips = 0;
  let calls = 0;
  while (cursor.at >= 0 && cursor.at < codes.length) {
    const count = readNumber(codes, cursor);
    if (count < 1) return undefined;
    for (let number = 0; number < count * 3 && cursor.at >= 0; number += 1)
      readNumber(codes, cursor);
    trips += 1;
    calls += count;
  }
  return cursor.at < 0 ? undefined : { trips, calls };
}

/**
 * Writes the next trip at `cursor` into `into` from `offset` and gives its number of calls, or
 * -1 when the text is not a trip over `stopCount` stops with times of zero or more.
 */
export function readTrip(
  codes: Codes,
  cursor: Cursor,
  stopCount: number,
  into: CallColumns,
  offset: number,
): number {
  const count = readNumber(codes, cursor);
  if (cursor.at < 0 || count < 1 || offset + count > into.stop.length) return -1;
  let stop = 0;
  let departure = 0;
  for (let at = offset; at < offset + count; at += 1) {
    stop += readNumber(codes, cursor);
    departure += readNumber(codes, cursor);
    const dwellAndFlags = readNumber(codes, cursor);
    const arrival = departure - (dwellAndFlags >> 2);
    if (cursor.at < 0 || stop < 0 || stop >= stopCount || arrival < 0 || departure < 0) return -1;
    into.stop[at] = stop;
    into.arrival[at] = arrival;
    into.departure[at] = departure;
    into.flags[at] = dwellAndFlags & 3;
  }
  return count;
}
