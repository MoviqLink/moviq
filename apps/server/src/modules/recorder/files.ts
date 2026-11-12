import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip, gzipSync } from 'node:zlib';

import { toNewYorkWallClockText } from '../../infrastructure/clock/new-york.js';

/**
 * The recording on disk: `<RECORDING_DIR>/<YYYY-MM-DD>/<HH>/<source>.ndjson.gz`, by the New York
 * day and hour of the data. Each write appends one complete gzip member, so a file is always
 * readable up to its last write and `gzip -dc` reads it whole. Nothing is rewritten in place.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR = /^\d{2}$/;
const SOURCE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const SUFFIX = '.ndjson.gz';

export interface HourPlace {
  readonly day: string;
  readonly hour: string;
}

/** The New York day and hour of an instant. The repeated hour of autumn shares one file. */
export function placeOf(instant: Date): HourPlace {
  const text = toNewYorkWallClockText(instant);
  return { day: text.slice(0, 10), hour: text.slice(11, 13) };
}

export function recordingFile(directory: string, place: HourPlace, sourceId: string): string {
  if (!DAY.test(place.day) || !HOUR.test(place.hour) || !SOURCE.test(sourceId))
    throw new RangeError(`Not a recording place: ${place.day} ${place.hour} ${sourceId}`);
  return join(directory, place.day, place.hour, `${sourceId}${SUFFIX}`);
}

/** Appends lines as one gzip member and returns the bytes written. */
export async function appendLines(file: string, lines: readonly string[]): Promise<number> {
  const member = gzipSync(`${lines.join('\n')}\n`);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, member);
  return member.byteLength;
}

/** Writes a whole file of lines, compressed as a stream, replacing what was there. */
export async function writeLines(file: string, lines: Iterable<string>): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const text = (function* () {
    for (const line of lines) yield `${line}\n`;
  })();
  await pipeline(Readable.from(text), createGzip(), createWriteStream(file));
}

/** The lines of a recording file, decompressed as a stream so large hours stay out of memory. */
export async function* readLines(file: string): AsyncGenerator<string> {
  const lines = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) if (line !== '') yield line;
}

async function entries(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).sort();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

/** The recorded days, oldest first. */
export async function recordedDays(directory: string): Promise<string[]> {
  return (await entries(directory)).filter((name) => DAY.test(name));
}

/** The files of one source in one day, in the order of their hours. */
export async function sourceFilesOfDay(
  directory: string,
  day: string,
): Promise<ReadonlyMap<string, readonly HourFile[]>> {
  const bySource = new Map<string, HourFile[]>();
  for (const hour of await entries(join(directory, day))) {
    if (!HOUR.test(hour)) continue;
    for (const name of await entries(join(directory, day, hour))) {
      if (!name.endsWith(SUFFIX)) continue;
      const sourceId = name.slice(0, -SUFFIX.length);
      const files = bySource.get(sourceId) ?? [];
      files.push({ hour, path: join(directory, day, hour, name) });
      bySource.set(sourceId, files);
    }
  }
  return bySource;
}

export interface HourFile {
  readonly hour: string;
  readonly path: string;
}

/** Where the nightly process writes the reduced copy of a day. */
export function reducedFile(directory: string, day: string, name: string): string {
  if (!DAY.test(day) || !SOURCE.test(name)) throw new RangeError(`Not a reduced file: ${day}`);
  return join(directory, day, 'reduced', `${name}${SUFFIX}`);
}

/** Deletes a whole recorded day. Only folders named as days are ever touched. */
export async function removeDay(directory: string, day: string): Promise<void> {
  if (!DAY.test(day)) throw new RangeError(`Not a day: ${day}`);
  await rm(join(directory, day), { recursive: true, force: true });
}
