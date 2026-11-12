import type { Database } from '../../src/infrastructure/database/database.js';
import type { SourceDefinition } from '../../src/modules/data-platform/definition.js';
import { healthStore } from '../../src/modules/data-platform/health-store.js';
import { NO_FACTS } from '../../src/modules/data-platform/health.js';
import { encodeSnapshot, snapshotStore } from '../../src/modules/data-platform/snapshots.js';
import type { EventList } from '../../src/modules/data-platform/sources/events/index.js';
import { admitted, capture } from '../sources/events/fixtures.js';

/** Admits a parse of a capture as the collector does: the copy and the facts, in one write. */
export async function serveCapture(
  db: Database,
  definition: SourceDefinition<EventList>,
  file: string,
  receivedAt: Date,
): Promise<EventList> {
  const result = definition.parse(capture(file), { receivedAt, previous: undefined });
  const data = admitted(result);
  if (!result.ok) throw new Error('Refused');
  const snapshot = encodeSnapshot(data);
  await db.transaction(async (tx) => {
    await snapshotStore.put(tx, definition.id, snapshot, result.dataTime, receivedAt, 1);
    await healthStore.write(
      tx,
      {
        ...NO_FACTS,
        sourceId: definition.id,
        servedVersion: snapshot.version,
        dataTime: result.dataTime,
        receivedAt,
        lastAttemptAt: receivedAt,
        lastOutcome: 'admitted',
        coverage: result.coverage,
        etag: undefined,
        lastGoodAt: receivedAt,
        lastErrorAt: undefined,
        latencyMs: 1,
        state: 'healthy',
        stateSince: receivedAt,
        evidence: 'Admitted.',
      },
      receivedAt,
    );
  });
  return data;
}
