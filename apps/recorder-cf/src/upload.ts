import type { Bucket, Sql } from './ports.js';

/**
 * The upload of each hour that ended, in steps that each fit in one alarm: about 128 KiB of gzip
 * members per step, which SQLite cuts out of the rows itself. A source's hour becomes objects of
 * at most 128 KiB, `raw/<day>/<HH>/<source>.<n>.ndjson.gz` (gzip members concatenate into a file
 * that `gzip -dc` reads whole) with the length of each member in its metadata, so the nightly
 * reduction reads it in one go and decompresses member by member. Once
 * every source is stored, the audit lines of the hour go to `audit/<day>/<HH>.txt` and its rows
 * are deleted:
 * a failed upload is tried again, and after a restart the hour starts over with the same objects.
 */
export const UPLOAD_BYTES_PER_STEP = 131_072;
const OBJECT_BYTES = 131_072;
/**
 * Members per object at most: their lengths go in its metadata (`members`, base 36, by commas),
 * which R2 keeps up to 2,048 bytes; 300 lengths of at most 128 KiB take 1,500.
 */
const OBJECT_MEMBERS = 300;

/** The lengths of the gzip members of an object, as its metadata keeps them. */
export const membersMetadata = (lengths: readonly number[]): Record<string, string> => ({
  members: lengths.map((length) => length.toString(36)).join(','),
});

const SIZES_OF = `SELECT json_extract(e.value, '$.s') AS s, json_extract(e.value, '$.n') AS n
  FROM buffer b, json_each(b.idx) e WHERE b.hour = ? ORDER BY s, b.seq, e.key`;

const MEMBERS_OF = `SELECT substr(b.data, json_extract(e.value, '$.o') + 1,
    json_extract(e.value, '$.n')) AS part
  FROM buffer b, json_each(b.idx) e
  WHERE b.hour = ? AND json_extract(e.value, '$.s') = ? ORDER BY b.seq, e.key LIMIT ? OFFSET ?`;

interface Next {
  readonly member: number;
  readonly object: number;
}

/** Each hour being uploaded: the lengths of its members by source, and where each source stands. */
interface HourProgress {
  readonly sizes: ReadonlyMap<string, readonly number[]>;
  next: Map<string, Next>;
}

export type UploadProgress = Map<string, HourProgress>;

export interface UploadStep {
  readonly hour: string;
  readonly objects: number;
  readonly bytes: number;
  /** True once every object of the hour is stored and its rows are deleted. */
  readonly done: boolean;
}

function sizesOf(sql: Sql, hour: string): Map<string, number[]> {
  const sizes = new Map<string, number[]>();
  for (const row of sql.exec(SIZES_OF, hour).toArray()) {
    const { s, n } = row;
    if (typeof s !== 'string' || typeof n !== 'number') throw new Error('A buffer row is damaged.');
    const list = sizes.get(s) ?? [];
    list.push(n);
    sizes.set(s, list);
  }
  return sizes;
}

/** The members of the next object of a source: up to 128 KiB, at least one. */
function nextCount(lengths: readonly number[], from: number): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  while (from + count < lengths.length) {
    const length = lengths[from + count] ?? 0;
    if (count > 0 && (bytes + length > OBJECT_BYTES || count === OBJECT_MEMBERS)) break;
    bytes += length;
    count += 1;
  }
  return { count, bytes };
}

function membersOf(sql: Sql, hour: string, source: string, from: number, count: number) {
  return sql
    .exec(MEMBERS_OF, hour, source, count, from)
    .toArray()
    .map((row) => {
      const part = row['part'];
      if (!(part instanceof ArrayBuffer)) throw new Error('A buffer row is damaged.');
      return new Uint8Array(part);
    });
}

export async function uploadStep(
  sql: Sql,
  bucket: Bucket,
  currentHour: string,
  progress: UploadProgress,
): Promise<UploadStep | undefined> {
  const oldest = sql
    .exec('SELECT MIN(hour) AS value FROM buffer WHERE hour < ?', currentHour)
    .toArray()[0]?.['value'];
  if (typeof oldest !== 'string') return undefined;
  const known = progress.get(oldest);
  if (known === undefined) {
    // A first step reads the lengths only: an hour that ended takes no more rows.
    progress.set(oldest, { sizes: sizesOf(sql, oldest), next: new Map() });
    return { hour: oldest, objects: 0, bytes: 0, done: false };
  }
  const { sizes } = known;
  const planned = new Map(known.next);
  const uploads: Promise<unknown>[] = [];
  let bytes = 0;
  for (const [source, lengths] of [...sizes].sort(([a], [b]) => a.localeCompare(b))) {
    let next = planned.get(source) ?? { member: 0, object: 0 };
    while (next.member < lengths.length) {
      const chunk = nextCount(lengths, next.member);
      if (uploads.length > 0 && bytes + chunk.bytes > UPLOAD_BYTES_PER_STEP) break;
      const members = membersOf(sql, oldest, source, next.member, chunk.count);
      const key = `raw/${oldest}/${source}.${String(next.object)}.ndjson.gz`;
      const metadata = membersMetadata(members.map((member) => member.byteLength));
      uploads.push(bucket.put(key, new Blob(members), { customMetadata: metadata }));
      bytes += chunk.bytes;
      next = { member: next.member + chunk.count, object: next.object + 1 };
    }
    planned.set(source, next);
    if (next.member < lengths.length) break;
  }
  await Promise.all(uploads);
  known.next = planned;
  const objects = uploads.length;
  const finished = [...sizes].every(
    ([source, lengths]) => planned.get(source)?.member === lengths.length,
  );
  if (!finished) return { hour: oldest, objects, bytes, done: false };
  const audit = sql
    .exec("SELECT audit FROM buffer WHERE hour = ? AND audit != '' ORDER BY seq", oldest)
    .toArray()
    .map((row) => (typeof row['audit'] === 'string' ? row['audit'] : ''));
  if (audit.length > 0) await bucket.put(`audit/${oldest}.txt`, audit.join(''));
  sql.exec('DELETE FROM buffer WHERE hour = ?', oldest);
  progress.delete(oldest);
  return { hour: oldest, objects, bytes, done: true };
}
