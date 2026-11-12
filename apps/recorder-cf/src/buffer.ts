import type { Sql } from './ports.js';

/**
 * The buffer in the Durable Object's SQLite. Each alarm compresses the lines of each source it
 * recorded as one gzip member; members wait in memory and are written as one row every 30 s,
 * so a day costs a few thousand rows written, not one per download. `upload.ts` turns the rows
 * of each hour that ended into objects in R2.
 */
const WRITE_EVERY_MS = 30_000;

type Index = { s: string; o: number; n: number }[];

export const BUFFER_TABLE = `CREATE TABLE IF NOT EXISTS buffer (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, hour TEXT NOT NULL, idx TEXT NOT NULL,
  data BLOB NOT NULL, audit TEXT NOT NULL)`;

/** Compresses lines as one gzip member. */
export async function gzipLines(lines: readonly string[]): Promise<Uint8Array> {
  const stream = new Blob([`${lines.join('\n')}\n`])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Pending {
  readonly hour: string;
  readonly members: { readonly source: string; readonly bytes: Uint8Array }[];
  readonly audit: string[];
}

export function createBuffer(sql: Sql) {
  let pending: Pending | undefined;
  let since = 0;
  const write = () => {
    if (pending === undefined) return;
    const index: Index = [];
    let offset = 0;
    for (const member of pending.members) {
      index.push({ s: member.source, o: offset, n: member.bytes.byteLength });
      offset += member.bytes.byteLength;
    }
    const data = new Uint8Array(offset);
    for (const [position, member] of pending.members.entries())
      data.set(member.bytes, index[position]?.o ?? 0);
    sql.exec(
      'INSERT INTO buffer (hour, idx, data, audit) VALUES (?, ?, ?, ?)',
      pending.hour,
      JSON.stringify(index),
      data.buffer,
      pending.audit.map((line) => `${line}\n`).join(''),
    );
    pending = undefined;
  };
  return {
    add(
      hour: string,
      source: string | undefined,
      bytes: Uint8Array | undefined,
      audit: readonly string[],
      nowMs: number,
    ) {
      if (pending !== undefined && pending.hour !== hour) write();
      pending ??= { hour, members: [], audit: [] };
      if (since === 0) since = nowMs;
      if (source !== undefined && bytes !== undefined) pending.members.push({ source, bytes });
      pending.audit.push(...audit);
    },
    /** Writes what waits once 30 s have passed, or at once when `force`. True if it wrote. */
    persist(nowMs: number, force: boolean): boolean {
      if (pending === undefined || (!force && nowMs - since < WRITE_EVERY_MS)) return false;
      write();
      since = 0;
      return true;
    },
    waiting: () => pending !== undefined,
  };
}

export type Buffer = ReturnType<typeof createBuffer>;
