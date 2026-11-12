import type { ProductFeature, SourceRow, SourceState } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { mtaElevatorEquipment } from '../src/modules/data-platform/sources/accessibility/elevator-equipment.js';
import { mtaElevatorInventory } from '../src/modules/data-platform/sources/accessibility/elevator-inventory.js';
import { mtaSubwayStations } from '../src/modules/data-platform/sources/accessibility/subway-stations.js';
import { mtaElevators } from '../src/modules/data-platform/sources/mta/elevators.js';
import { featureStates } from '../src/modules/data-platform/view.js';

function row(id: string, state: SourceState, consumers: readonly ProductFeature[]): SourceRow {
  return {
    id,
    title: id,
    provider: 'MTA',
    kind: 'static',
    rhythm: 'cold',
    state,
    stateSince: null,
    evidence: `${id} as written for the test.`,
    dataTime: null,
    ageSeconds: null,
    freshness: { degradedAfterSeconds: 1, staleAfterSeconds: 2, unavailableAfterSeconds: 3 },
    coverage: null,
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastError: null,
    latencyMs: null,
    consecutiveFailures: 0,
    intervalSeconds: 60,
    nextRunAt: null,
    nextRunReason: 'interval',
    interested: false,
    servedVersion: null,
    consumers: [...consumers],
  };
}

const STEP_FREE = [mtaSubwayStations, mtaElevatorEquipment, mtaElevatorInventory, mtaElevators];

function stepFree(states: readonly SourceState[]) {
  const rows = STEP_FREE.map((definition, at) =>
    row(definition.id, states[at] ?? 'healthy', definition.consumers),
  );
  return featureStates(rows).find((feature) => feature.id === 'step-free');
}

describe('product features in the control room', () => {
  it('lists the step-free sources under step-free, and the outages under trip-watch too', () => {
    expect(STEP_FREE.map((definition) => [definition.id, definition.consumers])).toEqual([
      ['mta-subway-stations', ['step-free']],
      ['mta-elevator-equipment', ['step-free']],
      ['mta-elevator-inventory', ['step-free']],
      ['mta-elevators', ['step-free', 'trip-watch']],
    ]);
    expect(stepFree(['healthy', 'healthy', 'healthy', 'healthy'])).toMatchObject({
      state: 'available',
    });
  });

  it('says step-free is unavailable when one of its sources cannot be used, as the engine does', () => {
    expect(stepFree(['healthy', 'healthy', 'healthy', 'stale'])).toEqual({
      id: 'step-free',
      state: 'unavailable',
      sources: [
        'mta-subway-stations',
        'mta-elevator-equipment',
        'mta-elevator-inventory',
        'mta-elevators',
      ],
      evidence: 'step-free needs all 4 of its sources: not usable now mta-elevators (stale).',
    });
    expect(stepFree(['healthy', 'degraded', 'healthy', 'healthy'])).toMatchObject({
      state: 'degraded',
    });
  });

  it('keeps other features available while one of several sources works', () => {
    const rows = [row('feed-a', 'healthy', ['live-map']), row('feed-b', 'stale', ['live-map'])];
    expect(featureStates(rows)).toEqual([
      {
        id: 'live-map',
        state: 'degraded',
        sources: ['feed-a', 'feed-b'],
        evidence: '1 of 2 sources need attention: feed-b (stale).',
      },
    ]);
  });
});
