import { Unzip, UnzipInflate } from 'fflate';

import { csvRecords, type CsvRecordHandler } from './csv.js';
import { fromNewYorkWallClock } from '../../../../infrastructure/clock/new-york.js';

export interface ZipRefusal {
  readonly ok: false;
  readonly code: 'not-zip' | 'truncated-zip' | 'corrupt-zip';
  readonly detail: string;
}

/** What the central directory says about the entries, read without decompressing any. */
interface ZipDirectory {
  /** Uncompressed size in bytes of each entry, by name. */
  readonly sizes: ReadonlyMap<string, number>;
  /** The latest modification time recorded, read as New York time. */
  readonly modifiedAt: Date | undefined;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT = 0xffff;
/** DOS date 1980-01-01, which archivers write when a file has no date. */
const DOS_NO_DATE = 0x21;
/**
 * The archive is fed to the inflater in pieces of this size, so each table arrives in chunks of
 * a few hundred kilobytes: given whole, fflate inflates a table in one piece (155 MB for the
 * Brooklyn `stop_times.txt` of 09/10/2026).
 */
const PUSH_BYTES = 64 * 1024;
/**
 * Inflated text is decoded in pieces of this size: V8 keeps larger strings apart from the young
 * generation, where they wait for a full collection instead of going at the next scavenge.
 */
const DECODE_BYTES = 32 * 1024;

function u16(body: Uint8Array, at: number): number {
  return (body[at] ?? 0) | ((body[at + 1] ?? 0) << 8);
}

function u32(body: Uint8Array, at: number): number {
  return (u16(body, at) | (u16(body, at + 2) << 16)) >>> 0;
}

function findEndRecord(body: Uint8Array): number | undefined {
  const lowest = Math.max(0, body.length - END_RECORD_SIZE - MAX_COMMENT);
  for (let at = body.length - END_RECORD_SIZE; at >= lowest; at -= 1) {
    if (u32(body, at) === END_OF_DIRECTORY) return at;
  }
  return undefined;
}

function dosTime(date: number, time: number): Date | undefined {
  if (date <= DOS_NO_DATE) return undefined;
  return fromNewYorkWallClock({
    year: 1980 + (date >> 9),
    month: (date >> 5) & 0x0f,
    day: date & 0x1f,
    hour: time >> 11,
    minute: (time >> 5) & 0x3f,
    second: (time & 0x1f) * 2,
  });
}

type EnvelopeRead = ({ readonly ok: true } & ZipDirectory) | ZipRefusal;

/** Reads every entry the central directory announces; a directory missing some is corrupt. */
function readDirectory(body: Uint8Array, endRecord: number): EnvelopeRead {
  const announced = u16(body, endRecord + 10);
  const names = new TextDecoder();
  const sizes = new Map<string, number>();
  let modifiedAt: Date | undefined;
  let at = u32(body, endRecord + 16);
  for (let held = 0; held < announced; held += 1) {
    if (u32(body, at) !== CENTRAL_HEADER) {
      const detail = `the central directory holds ${String(held)} of ${String(announced)} entries`;
      return { ok: false, code: 'corrupt-zip', detail };
    }
    const nameEnd = at + 46 + u16(body, at + 28);
    sizes.set(names.decode(body.subarray(at + 46, nameEnd)), u32(body, at + 24));
    const modified = dosTime(u16(body, at + 14), u16(body, at + 12));
    if (modified && (!modifiedAt || modified > modifiedAt)) modifiedAt = modified;
    at = nameEnd + u16(body, at + 30) + u16(body, at + 32);
  }
  return { ok: true, sizes, modifiedAt };
}

/**
 * Checks the archive envelope before anything is decompressed: it must start like a ZIP (an error
 * page does not), end with its directory (a cut download does not) and hold every entry that
 * directory announces.
 */
export function zipEnvelope(body: Uint8Array): EnvelopeRead {
  if (body.length < END_RECORD_SIZE || u32(body, 0) !== LOCAL_HEADER) {
    const start = new TextDecoder().decode(body.subarray(0, 60)).replace(/\s+/g, ' ');
    return { ok: false, code: 'not-zip', detail: `body starts with "${start}"` };
  }
  const endRecord = findEndRecord(body);
  if (endRecord === undefined) {
    return {
      ok: false,
      code: 'truncated-zip',
      detail: `no end of central directory in ${String(body.length)} bytes`,
    };
  }
  return readDirectory(body, endRecord);
}

/** Feeds the archive to the inflater piece by piece; the last piece ends it. */
function pushInPieces(unzip: Unzip, body: Uint8Array): void {
  for (let at = 0; at < body.length; at += PUSH_BYTES) {
    unzip.push(body.subarray(at, at + PUSH_BYTES), at + PUSH_BYTES >= body.length);
  }
}

/**
 * Streams the named tables out of a ZIP, record by record, and skips every other entry without
 * decompressing it. Each table the directory lists with data must be read to its end.
 */
export function readZipTables(
  body: Uint8Array,
  sizes: ZipDirectory['sizes'],
  tables: ReadonlyMap<string, CsvRecordHandler>,
): { readonly ok: true } | ZipRefusal {
  const complete = new Set<string>();
  let failure: string | undefined;
  const unzip = new Unzip((file) => {
    const onRecord = tables.get(file.name);
    if (!onRecord) return;
    const decoder = new TextDecoder();
    const reader = csvRecords(onRecord);
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure ??= `${file.name}: ${error.message}`;
        return;
      }
      for (let at = 0; at < chunk.length; at += DECODE_BYTES) {
        const piece = chunk.subarray(at, at + DECODE_BYTES);
        reader.write(decoder.decode(piece, { stream: !final || at + DECODE_BYTES < chunk.length }));
      }
      if (!final) return;
      reader.end();
      complete.add(file.name);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    pushInPieces(unzip, body);
  } catch (error) {
    failure ??= error instanceof Error ? error.message : String(error);
  }
  if (failure !== undefined) return { ok: false, code: 'corrupt-zip', detail: failure };
  const unread = [...tables.keys()].find(
    (name) => (sizes.get(name) ?? 0) > 0 && !complete.has(name),
  );
  if (unread !== undefined) {
    return { ok: false, code: 'corrupt-zip', detail: `${unread} is listed but not in the entries` };
  }
  return { ok: true };
}
