import { toInstant, type RecorderStatus } from '@moviq/contracts';
import { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { SourceDefinition } from '../data-platform/definition.js';
import type { Extractor } from './extractor.js';
import { jsonColumn } from './json-column.js';

export interface RecorderStatusDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly definitions: readonly SourceDefinition[];
  readonly extractors: readonly Extractor[];
  readonly directory: string | undefined;
  readonly retentionDays: number;
}

/** Without a write for this long while sources are admitted, the recorder counts as stalled. */
const STALLED_AFTER_MS = 5 * 60_000;
const DAYS_SHOWN = 14;
const GAPS_SHOWN = 50;

const instant = z.string().transform((value) => toInstant(new Date(value)));

const cursorRow = z.object({ started_at: instant });
const sourceRow = z.object({
  source_id: z.string(),
  last_version: z.string(),
  last_data_time: instant,
  last_written_at: instant,
});
const dayRow = z.object({
  day: z.string(),
  source_id: z.string(),
  versions: z.number().int(),
  events: z.number().int(),
  bytes: z.number().int(),
  lost_versions: z.number().int(),
});
const gapRow = z.object({
  source_id: z.string(),
  day: z.string(),
  from_run_id: z.number().int(),
  to_run_id: z.number().int(),
  versions: z.number().int(),
  first_data_time: instant,
  last_data_time: instant,
  evidence: z.string(),
  recorded_at: instant,
});
const missingSchema = z.array(
  z.object({ sourceId: z.string(), missingHours: z.array(z.string()), lostVersions: z.number() }),
);
const nightlyRow = z.object({
  day: z.string(),
  outcome: z.enum(['complete', 'incomplete', 'no-recording']),
  started_at: instant,
  finished_at: instant,
  detail: jsonColumn(
    z.object({ completeness: z.object({ sources: missingSchema }).optional() }).loose(),
  ),
});

async function rows<T>(db: Database, schema: z.ZodType<T>, sql: string, context: string) {
  const result = await db.query(sql);
  return result.rows.map((row) => parseRow(schema, row, context));
}

function daysOf(found: readonly z.infer<typeof dayRow>[]): RecorderStatus['days'] {
  const days = new Map<string, RecorderStatus['days'][number]>();
  for (const row of found) {
    const counts = {
      versions: row.versions,
      events: row.events,
      bytes: row.bytes,
      lostVersions: row.lost_versions,
    };
    const day = days.get(row.day) ?? {
      day: row.day,
      versions: 0,
      events: 0,
      bytes: 0,
      lostVersions: 0,
      bySource: [],
    };
    days.set(row.day, {
      ...day,
      versions: day.versions + counts.versions,
      events: day.events + counts.events,
      bytes: day.bytes + counts.bytes,
      lostVersions: day.lostVersions + counts.lostVersions,
      bySource: [...day.bySource, { sourceId: row.source_id, ...counts }],
    });
  }
  return [...days.values()];
}

function stateOf(
  deps: RecorderStatusDependencies,
  lastWriteAt: string | null,
  now: Date,
): Pick<RecorderStatus, 'state' | 'evidence'> {
  if (deps.directory === undefined)
    return {
      state: 'not-configured',
      evidence: 'RECORDING_DIR is not set, so nothing is recorded.',
    };
  if (lastWriteAt === null)
    return {
      state: 'waiting',
      evidence: 'Nothing recorded yet: no source has admitted a new version since the start.',
    };
  const quietMs = now.getTime() - Date.parse(lastWriteAt);
  if (quietMs > STALLED_AFTER_MS)
    return {
      state: 'stalled',
      evidence:
        `Last write ${String(Math.round(quietMs / 60_000))} min ago: ` +
        'the worker may be stopped or every source failing.',
    };
  return {
    state: 'recording',
    evidence: `Last write ${String(Math.round(quietMs / 1000))} s ago.`,
  };
}

/** What the control room sees of the recorder. */
export async function recorderStatus(deps: RecorderStatusDependencies): Promise<RecorderStatus> {
  const now = deps.clock.now();
  const [cursor] = await rows(
    deps.db,
    cursorRow,
    'SELECT started_at FROM recorder_cursor',
    'recorder_cursor',
  );
  const positions = await rows(
    deps.db,
    sourceRow,
    'SELECT * FROM recorder_sources',
    'recorder_sources',
  );
  const byId = new Map(positions.map((row) => [row.source_id, row]));
  const recorded = new Set(deps.extractors.map((extractor) => extractor.sourceId));
  const days = await rows(
    deps.db,
    dayRow,
    `SELECT * FROM recorder_days WHERE day IN (SELECT DISTINCT day FROM recorder_days
       ORDER BY day DESC LIMIT ${String(DAYS_SHOWN)}) ORDER BY day DESC, source_id`,
    'recorder_days',
  );
  const gaps = await rows(
    deps.db,
    gapRow,
    `SELECT * FROM recorder_gaps ORDER BY id DESC LIMIT ${String(GAPS_SHOWN)}`,
    'recorder_gaps',
  );
  const [nightly] = await rows(
    deps.db,
    nightlyRow,
    'SELECT * FROM recorder_nightly ORDER BY day DESC LIMIT 1',
    'recorder_nightly',
  );
  const lastWriteAt =
    positions
      .map((row) => row.last_written_at)
      .sort()
      .at(-1) ?? null;
  return {
    generatedAt: toInstant(now),
    ...stateOf(deps, lastWriteAt, now),
    retentionDays: deps.retentionDays,
    startedAt: cursor?.started_at ?? null,
    lastWriteAt,
    sources: deps.definitions.map((definition) => {
      const position = byId.get(definition.id);
      return {
        sourceId: definition.id,
        recorded: recorded.has(definition.id),
        lastVersion: position?.last_version ?? null,
        lastDataTime: position?.last_data_time ?? null,
        lastWrittenAt: position?.last_written_at ?? null,
      };
    }),
    days: daysOf(days),
    gaps: gaps.map((gap) => ({
      sourceId: gap.source_id,
      day: gap.day,
      fromRunId: gap.from_run_id,
      toRunId: gap.to_run_id,
      versions: gap.versions,
      firstDataTime: gap.first_data_time,
      lastDataTime: gap.last_data_time,
      evidence: gap.evidence,
      recordedAt: gap.recorded_at,
    })),
    lastNightly:
      nightly === undefined
        ? null
        : {
            day: nightly.day,
            outcome: nightly.outcome,
            startedAt: nightly.started_at,
            finishedAt: nightly.finished_at,
            missing: nightly.detail.completeness?.sources ?? [],
          },
  };
}
