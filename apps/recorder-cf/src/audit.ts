import type { ExtractedEvent } from '../../server/src/modules/recorder/events.js';
import { metresBetween } from '../../server/src/modules/recorder/extractors/bus.js';

/**
 * The fastest a vehicle of a source can really go, in metres a second: Acela trains reach 67
 * (150 mph) on the Northeast Corridor; aircraft near the airports stay under 300. A faster jump
 * between two reports of one vehicle is an error of the provider and is noted with its proof.
 */
export const GROUND_LIMIT = 70;
export const AIR_LIMIT = 300;

interface LastFix {
  readonly t: number;
  readonly lat: number;
  readonly lon: number;
}

export interface Fixes {
  readonly limit: number;
  readonly last: Map<string, LastFix>;
}

export const createFixes = (limit: number): Fixes => ({ limit, last: new Map() });

/** Audit lines for jumps no vehicle can make, each with both reports as its proof. */
export function auditFixes(fixes: Fixes, events: readonly ExtractedEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    if (event.k !== 'gps') continue;
    const before = fixes.last.get(event.veh);
    fixes.last.set(event.veh, { t: event.t, lat: event.lat, lon: event.lon });
    if (before === undefined || event.t <= before.t) continue;
    const metres = metresBetween(before.lat, before.lon, event.lat, event.lon);
    const speed = metres / (event.t - before.t);
    if (speed <= fixes.limit) continue;
    lines.push(
      `impossible-jump: ${event.veh} moved ${String(Math.round(metres))} m in ` +
        `${String(event.t - before.t)} s (${String(before.lat)},${String(before.lon)} at ` +
        `${String(before.t)} → ${String(event.lat)},${String(event.lon)} at ${String(event.t)})`,
    );
  }
  return lines;
}
