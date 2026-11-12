import { WIRE, WireReader } from './wire.js';

const HEADER_FIELD = 1;
const ENTITY_FIELD = 2;
const ENTITY_ID_FIELD = 1;

/** FNV-1a over the id, so an entity falls in the same part in every version of the feed. */
export function partOf(id: string, parts: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % parts;
}

/** One part of a feed, and its number of entities; unknown when the feed was not split. */
export interface FeedPart {
  readonly body: Uint8Array;
  readonly entities: number | undefined;
}

/** How entities are kept together: by their own id, or by the trip they describe. */
export type SplitBy = 'entity' | 'trip';

/** `FeedEntity.trip_update` (3) and `.vehicle` (4) hold `trip` (1), whose `trip_id` is 1. */
const TRIP_HOLDERS = new Set([3, 4]);
const TRIP_FIELD = 1;
const TRIP_ID_FIELD = 1;

/** The string of a field, read by its path of field numbers through nested messages. */
function stringAt(reader: WireReader, path: readonly ReadonlySet<number>[]): string | undefined {
  const [first, ...rest] = path;
  if (first === undefined) return undefined;
  while (!reader.done()) {
    const { field, wire } = reader.key();
    if (wire === WIRE.bytes && first.has(field)) {
      if (rest.length === 0) return reader.string();
      const found = stringAt(reader.nested(), rest);
      if (found !== undefined) return found;
      continue;
    }
    reader.skip(wire);
  }
  return undefined;
}

const ID_PATH = [new Set([ENTITY_ID_FIELD])];
const TRIP_PATH = [TRIP_HOLDERS, new Set([TRIP_FIELD]), new Set([TRIP_ID_FIELD])];

function keyOf(bytes: Uint8Array, start: number, end: number, by: SplitBy): string | undefined {
  const trip = by === 'trip' ? stringAt(new WireReader(bytes, start, end), TRIP_PATH) : undefined;
  return trip ?? stringAt(new WireReader(bytes, start, end), ID_PATH);
}

/**
 * Splits a GTFS Realtime feed into `parts` feeds by entity id, or by trip id where a trip's
 * update and its vehicle come as two entities that the source joins (the subway, LIRR and
 * Metro-North). Each part keeps the header and its entities byte for byte: a protobuf message
 * is the concatenation of its fields, so every part is a valid feed that the source decodes as
 * usual. An entity without a key goes to the first part. Throws on input that is not protobuf.
 */
export function splitFeed(body: Uint8Array, parts: number, by: SplitBy = 'entity'): FeedPart[] {
  if (parts === 1) return [{ body, entities: undefined }];
  const reader = new WireReader(body);
  const header: Uint8Array[] = [];
  const groups: Uint8Array[][] = Array.from({ length: parts }, () => []);
  while (!reader.done()) {
    const fieldStart = reader.offset;
    const { field, wire } = reader.key();
    if (wire !== WIRE.bytes) {
      reader.skip(wire);
      header.push(body.subarray(fieldStart, reader.offset));
      continue;
    }
    const { start, end } = reader.span();
    const bytes = body.subarray(fieldStart, end);
    if (field === ENTITY_FIELD) {
      const key = keyOf(body, start, end, by);
      groups[key === undefined ? 0 : partOf(key, parts)]?.push(bytes);
    } else if (field === HEADER_FIELD) header.unshift(bytes);
    else header.push(bytes);
  }
  return groups.map((entities) => ({
    body: concat([...header, ...entities]),
    entities: entities.length,
  }));
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
