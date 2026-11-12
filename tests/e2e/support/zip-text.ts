import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/** One entry of a ZIP archive, its bytes as stored and the fields its headers repeat. */
interface ZipEntry {
  readonly name: string;
  /** 0 is stored, 8 is deflated: the only two methods GTFS archives use. */
  readonly method: number;
  readonly crc: number;
  readonly size: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly stored: Uint8Array;
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const DEFLATED = 8;
const STORED = 0;
const VERSION = 20;
/** Names are written as UTF-8, and sizes in the headers, never in a trailing descriptor. */
const UTF8_NAMES = 0x0800;

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function endOfDirectory(data: DataView): number {
  const last = data.byteLength - 22;
  for (let at = last; at >= Math.max(0, last - 0xffff); at -= 1) {
    if (data.getUint32(at, true) === END_OF_DIRECTORY) return at;
  }
  throw new Error('The capture is not a ZIP archive.');
}

/**
 * The entry the directory describes at `at`, and where the next one starts. Offsets are those of
 * the central directory and local headers in PKWARE's APPNOTE (4.3.7 and 4.3.12).
 */
function directoryEntry(zip: Uint8Array, at: number): { entry: ZipEntry; next: number } {
  const data = view(zip);
  if (data.getUint32(at, true) !== DIRECTORY_ENTRY) throw new Error('A broken ZIP directory.');
  const nameLength = data.getUint16(at + 28, true);
  const local = data.getUint32(at + 42, true);
  const start = local + 30 + data.getUint16(local + 26, true) + data.getUint16(local + 28, true);
  const entry: ZipEntry = {
    name: new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)),
    method: data.getUint16(at + 10, true),
    dosTime: data.getUint16(at + 12, true),
    dosDate: data.getUint16(at + 14, true),
    crc: data.getUint32(at + 16, true),
    size: data.getUint32(at + 24, true),
    stored: zip.subarray(start, start + data.getUint32(at + 20, true)),
  };
  const next = at + 46 + nameLength + data.getUint16(at + 30, true) + data.getUint16(at + 32, true);
  return { entry, next };
}

function readEntries(zip: Uint8Array): ZipEntry[] {
  const data = view(zip);
  const end = endOfDirectory(data);
  const entries: ZipEntry[] = [];
  let at = data.getUint32(end + 16, true);
  for (let index = 0; index < data.getUint16(end + 10, true); index += 1) {
    const { entry, next } = directoryEntry(zip, at);
    entries.push(entry);
    at = next;
  }
  return entries;
}

function textOf(entry: ZipEntry): string {
  if (entry.method !== STORED && entry.method !== DEFLATED) {
    throw new Error(`${entry.name} uses ZIP method ${String(entry.method)}.`);
  }
  const bytes = entry.method === DEFLATED ? inflateRawSync(entry.stored) : entry.stored;
  return new TextDecoder().decode(bytes);
}

function withText(entry: ZipEntry, text: string): ZipEntry {
  const bytes = new TextEncoder().encode(text);
  return {
    ...entry,
    method: DEFLATED,
    crc: crc32(bytes),
    size: bytes.byteLength,
    stored: deflateRawSync(bytes),
  };
}

/** The fields the local header and the directory entry share, from "version needed" on. */
function commonFields(entry: ZipEntry, name: Uint8Array): Buffer {
  const fields = Buffer.alloc(26);
  fields.writeUInt16LE(VERSION, 0);
  fields.writeUInt16LE(UTF8_NAMES, 2);
  fields.writeUInt16LE(entry.method, 4);
  fields.writeUInt16LE(entry.dosTime, 6);
  fields.writeUInt16LE(entry.dosDate, 8);
  fields.writeUInt32LE(entry.crc, 10);
  fields.writeUInt32LE(entry.stored.byteLength, 14);
  fields.writeUInt32LE(entry.size, 18);
  fields.writeUInt16LE(name.byteLength, 22);
  return fields;
}

function signature(value: number, length: number): Buffer {
  const bytes = Buffer.alloc(length);
  bytes.writeUInt32LE(value, 0);
  return bytes;
}

function writeEntries(entries: readonly ZipEntry[]): Uint8Array {
  const body: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const fields = commonFields(entry, name);
    const local = Buffer.concat([signature(LOCAL_HEADER, 4), fields, name]);
    // Comment, disk, attributes and where the local header starts.
    const listed = Buffer.alloc(14);
    listed.writeUInt32LE(offset, 10);
    directory.push(signature(DIRECTORY_ENTRY, 6), fields, listed, name);
    body.push(local, Buffer.from(entry.stored));
    offset += local.byteLength + entry.stored.byteLength;
  }
  const size = directory.reduce((total, part) => total + part.byteLength, 0);
  const end = signature(END_OF_DIRECTORY, 22);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, ...directory, end]);
}

/**
 * The archive with the text of the entries named in `rewrite` (by file name, in any folder)
 * replaced by what each function returns; every other entry is copied as it was stored.
 */
export function rewriteZipText(
  zip: Uint8Array,
  rewrite: Readonly<Record<string, (text: string) => string>>,
): Uint8Array {
  const entries = readEntries(zip).map((entry) => {
    const change = rewrite[entry.name.slice(entry.name.lastIndexOf('/') + 1)];
    return change === undefined ? entry : withText(entry, change(textOf(entry)));
  });
  return writeEntries(entries);
}
