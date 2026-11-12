import { appendLines, recordingFile } from '../../src/modules/recorder/files.js';

/** A New York weekday whose 07:00–07:59 hour is written by hand below. */
export const DAY = '2026-11-10';
const BASE = Date.parse('2026-11-10T12:00:00.000Z') / 1000;

type Line = Record<string, unknown>;

const marker = (run: number, t: number): Line => ({
  k: 'version',
  v: `v${String(run)}`,
  t,
  run,
  at: t,
});

const departure = (
  trip: string,
  route: string,
  stop: string,
  next: string | null,
  t: number,
  exact = true,
): Line => ({
  v: 'v1',
  k: 'stn',
  t,
  ev: 'dep',
  trip,
  route,
  dir: '0',
  veh: null,
  stop,
  next,
  lo: exact ? t : t - 30,
  hi: t,
  exact,
});

/** 25 bus trips over X1 → X2 (100 to 124 s), the last one bunched; 5 of them go on to X3. */
function segmentTrips(): Line[] {
  return Array.from({ length: 25 }, (_, i) => {
    const leave = BASE + (i === 24 ? 23 * 300 + 30 : i * 300) - 3000;
    const lines = [
      departure(`S${String(i)}`, 'M15', 'X1', 'X2', leave),
      departure(`S${String(i)}`, 'M15', 'X2', 'X3', leave + 100 + i),
    ];
    if (i < 5) lines.push(departure(`S${String(i)}`, 'M15', 'X3', null, leave + 160 + i));
    return lines;
  }).flat();
}

/** A bus stopped 6 minutes between two stops of its trip, and another waiting at its terminal. */
function holds(): Line[] {
  const held = (veh: string, trip: string, since: number, t: number, n: number): Line => ({
    v: 'v1',
    k: 'held',
    t,
    veh,
    trip,
    since,
    n,
    lat: 40.75,
    lon: -73.98,
  });
  return [
    { v: 'v1', k: 'assign', t: BASE, veh: 'V1', trip: 'TRIP-1', route: 'M15', dir: '0' },
    departure('TRIP-1', 'M15', '401', '402', BASE + 30, false),
    held('V1', 'TRIP-1', BASE + 60, BASE + 120, 3),
    held('V1', 'TRIP-1', BASE + 60, BASE + 420, 13),
    departure('TRIP-1', 'M15', '402', '403', BASE + 480, false),
    { v: 'v1', k: 'assign', t: BASE, veh: 'V2', trip: 'TRIP-2', route: 'M15', dir: '0' },
    held('V2', 'TRIP-2', BASE, BASE + 600, 21),
    departure('TRIP-2', 'M15', '501', '502', BASE + 630, false),
  ];
}

/** A train reporting itself stopped at a stop, at the time it gave. */
const arrival = (trip: string, stop: string, next: string | null, t: number): Line => ({
  ...departure(trip, 'A', stop, next, t),
  ev: 'arr',
});

/** A train reporting itself at a stop: stopped there, or heading to it. */
const train = (trip: string, stop: string, status: 'stopped' | 'in-transit', t: number): Line => ({
  v: 'v1',
  k: 'train',
  t,
  trip,
  route: 'A',
  dir: '0',
  stop,
  status,
});

/**
 * 20 subway arrivals predicted 3 minutes ahead, off by −10 to +9 s, and a segment with a slow
 * run. The subway is timed from the train reporting it left a stop to its arrival at the next:
 * each train stands 20 s at A06N, then runs 100 s, the last one 580 s.
 */
function subway(): Line[] {
  const predictions = Array.from({ length: 20 }, (_, i) => {
    const actual = BASE + 300 + i * 60;
    return [
      {
        v: 'v1',
        k: 'pred',
        t: actual - 180,
        trip: `P${String(i)}`,
        route: 'A',
        stop: 'A05N',
        p: actual + i - 10,
      },
      arrival(`P${String(i)}`, 'A05N', null, actual),
    ];
  }).flat();
  const segment = Array.from({ length: 7 }, (_, i) => {
    const leave = BASE + i * 400;
    return [
      train(`R${String(i)}`, 'A06N', 'stopped', leave),
      arrival(`R${String(i)}`, 'A06N', 'A05N', leave),
      train(`R${String(i)}`, 'A05N', 'in-transit', leave + 20),
      train(`R${String(i)}`, 'A05N', 'stopped', leave + (i === 6 ? 600 : 120)),
      arrival(`R${String(i)}`, 'A05N', null, leave + (i === 6 ? 600 : 120)),
    ];
  }).flat();
  return [...predictions, ...segment];
}

const text = (lines: readonly Line[]) => lines.map((line) => JSON.stringify(line));

/**
 * The hour 07 of `DAY` for Bus Time positions and the ACE subway feed, as the writes of the
 * recorder: each inner list is one write (one gzip member). The ACE version is written twice,
 * as after a commit that failed, and must be read once.
 */
export function dayRecording(): { readonly sourceId: string; readonly writes: string[][] }[] {
  const subwayLines = text([marker(2, BASE), ...subway()]);
  return [
    {
      sourceId: 'mta-bus-positions',
      writes: [text([marker(1, BASE), ...segmentTrips(), ...holds()])],
    },
    { sourceId: 'mta-subway-ace', writes: [subwayLines, subwayLines] },
  ];
}

/** Writes `dayRecording` into the hour 07 of `DAY`. */
export async function writeDay(directory: string): Promise<void> {
  const place = { day: DAY, hour: '07' };
  for (const { sourceId, writes } of dayRecording())
    for (const lines of writes) await appendLines(recordingFile(directory, place, sourceId), lines);
}
