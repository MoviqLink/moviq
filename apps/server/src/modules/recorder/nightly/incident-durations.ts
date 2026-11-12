import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/database/database.js';
import { parseRow } from '../../../infrastructure/database/rows.js';
import { jsonColumn } from '../json-column.js';
import { shiftDay, startOfDay } from './calendar.js';
import { kaplanMeier, type Duration, type SurvivalCurve } from './survival.js';

/** Incidents that started in the last four weeks up to the day reduced. */
export const INCIDENT_WINDOW_DAYS = 28;
/** The group of all lines together. */
export const ALL_ROUTES = '*';

export interface IncidentDurationRow {
  readonly kind: string;
  readonly type: string;
  readonly route: string;
  readonly curve: SurvivalCurve;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

const incidentRow = z.object({
  kind: z.string(),
  type: z.string(),
  routes: jsonColumn(z.array(z.string())),
  first_seen: z.string(),
  last_seen: z.string().nullable(),
  closed_at: z.string().nullable(),
  recorded_until: z.string().nullable(),
});

type Incident = z.infer<typeof incidentRow>;

/**
 * How long an incident lasted as of the end of the day: from first to last seen once it closed,
 * or, while still open, up to the last version of its source recorded that day. The times
 * between versions are not guessed, so durations are the shortest that the evidence shows.
 */
function durationOf(incident: Incident, end: number): Duration {
  const start = Date.parse(incident.first_seen);
  const closedAt = incident.closed_at === null ? undefined : Date.parse(incident.closed_at);
  if (incident.last_seen !== null && closedAt !== undefined && closedAt < end)
    return { seconds: (Date.parse(incident.last_seen) - start) / 1000, closed: true };
  const until = Math.min(end, Date.parse(incident.recorded_until ?? incident.first_seen));
  return { seconds: Math.max(0, until - start) / 1000, closed: false };
}

/** Survival curves of incident durations by kind, type and line, and for all lines together. */
export async function incidentDurations(db: Database, day: string): Promise<IncidentDurationRow[]> {
  const end = startOfDay(shiftDay(day, 1)).getTime();
  const result = await db.query({
    sql: `SELECT i.kind, i.type, i.routes, i.first_seen, i.last_seen, i.closed_at,
            s.last_data_time AS recorded_until
          FROM recorder_incidents i LEFT JOIN recorder_sources s ON s.source_id = i.source_id
          WHERE i.first_seen >= ? AND i.first_seen < ?`,
    args: [
      toInstant(startOfDay(shiftDay(day, 1 - INCIDENT_WINDOW_DAYS))),
      toInstant(new Date(end)),
    ],
  });
  const groups = new Map<
    string,
    { kind: string; type: string; route: string; items: Incident[] }
  >();
  for (const row of result.rows) {
    const incident = parseRow(incidentRow, row, 'recorder_incidents');
    for (const route of [ALL_ROUTES, ...incident.routes]) {
      const key = JSON.stringify([incident.kind, incident.type, route]);
      const group = groups.get(key) ?? {
        kind: incident.kind,
        type: incident.type,
        route,
        items: [],
      };
      group.items.push(incident);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(({ kind, type, route, items }) => {
    const seen = items.map((item) => item.first_seen).sort();
    return {
      kind,
      type,
      route,
      curve: kaplanMeier(items.map((item) => durationOf(item, end))),
      firstSeen: seen[0] ?? '',
      lastSeen: seen.at(-1) ?? '',
    };
  });
}
