import type { RecordedEvent } from '../../src/modules/recorder/events.js';
import { appendLines, recordingFile } from '../../src/modules/recorder/files.js';

/** A New York weekday morning: 07:00 on Tuesday 10/11/2026, the AM peak. */
export const BUS_DAY = '2026-11-10';
const BASE = Date.parse('2026-11-10T12:00:00.000Z') / 1000;
/** Metres per degree of latitude on the mean Earth radius, as haversine gives them. */
const METERS_PER_DEGREE = 111_195.08;
const START = { lat: 40.75, lon: -73.98 };

/** The point `meters` north of `START`, where every bus of the day runs. */
export const northOf = (meters: number) => ({
  lat: START.lat + meters / METERS_PER_DEGREE,
  lon: START.lon,
});

const round = (value: number) => Math.round(value * 1e5) / 1e5;

/**
 * Written by hand, as the Bus Time extractor writes: 25 buses of the M15 northbound, five
 * minutes apart, each reporting every 30 s for ten minutes at 10 m/s on the same street; and a
 * bus that stands at its terminal, then reports again after six minutes.
 */
export function busDay(): RecordedEvent[] {
  const events: RecordedEvent[] = [];
  for (let bus = 0; bus < 25; bus += 1) {
    const veh = `MTA NYCT_${String(7000 + bus)}`;
    const leave = BASE + bus * 300;
    events.push({
      k: 'assign',
      v: 'v1',
      t: leave,
      veh,
      trip: `M15-${String(bus)}`,
      route: 'M15',
      dir: '0',
    });
    for (let report = 0; report < 20; report += 1) {
      const point = northOf(report * 300);
      const lat = round(point.lat);
      const lon = round(point.lon);
      events.push({
        k: 'gps',
        v: 'v1',
        t: leave + report * 30,
        veh,
        lat,
        lon,
        brg: 29,
        stop: null,
      });
    }
  }
  const veh = 'MTA NYCT_8000';
  const at = { k: 'gps', v: 'v1', veh, lat: 40.7, lon: -74, brg: null, stop: null } as const;
  events.push(
    { k: 'assign', v: 'v1', t: BASE, veh, trip: 'M15-T', route: 'M15', dir: '1' },
    { ...at, t: BASE },
    {
      k: 'held',
      v: 'v1',
      t: BASE + 60,
      veh,
      trip: 'M15-T',
      since: BASE,
      n: 3,
      lat: 40.7,
      lon: -74,
    },
    { ...at, t: BASE + 420, lat: 40.71 },
  );
  return events.sort((a, b) => a.t - b.t);
}

/** Writes `busDay` into the hour 07 of `BUS_DAY`, as the recorder writes Bus Time positions. */
export async function writeBusDay(directory: string): Promise<void> {
  const marker = { k: 'version', v: 'v1', t: BASE, run: 1, at: BASE };
  const lines = [marker, ...busDay()].map((event) => JSON.stringify(event));
  const file = recordingFile(directory, { day: BUS_DAY, hour: '07' }, 'mta-bus-positions');
  await appendLines(file, lines);
}
