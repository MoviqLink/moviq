import { describe, expect, it } from 'vitest';

import type { RecordedEvent } from '../../src/modules/recorder/events.js';
import { segmentRuns } from '../../src/modules/recorder/nightly/segments.js';
import { createTrajectories } from '../../src/modules/recorder/nightly/trajectories.js';

const T0 = Date.parse('2026-11-10T12:00:00.000Z') / 1000;
const trip = { trip: '111500_B..N66R', route: 'B', dir: '0' };

const train = (
  stop: string,
  status: 'stopped' | 'in-transit' | null,
  t: number,
): RecordedEvent => ({
  k: 'train',
  v: 'v1',
  t,
  ...trip,
  stop,
  status,
});

const passage = (
  ev: 'arr' | 'dep',
  stop: string,
  next: string | null,
  t: number,
  window: { lo: number; hi: number; exact: boolean },
): RecordedEvent => ({ k: 'stn', v: 'v1', t, ev, ...trip, veh: null, stop, next, ...window });

const arrival = (stop: string, next: string | null, t: number) =>
  passage('arr', stop, next, t, { lo: t, hi: t, exact: true });

function runsOf(events: readonly RecordedEvent[]) {
  const trajectories = createTrajectories();
  for (const event of events) trajectories.add('subway', event);
  return trajectories.all().flatMap(segmentRuns);
}

describe('subway segments, timed as the estimator counts them', () => {
  it('runs from the departure the train reported to the arrival at the next stop', () => {
    const runs = runsOf([
      train('D26N', 'stopped', T0),
      arrival('D26N', 'D25N', T0),
      train('D25N', 'in-transit', T0 + 30),
      train('D25N', 'stopped', T0 + 130),
      arrival('D25N', 'D24N', T0 + 130),
      // The B Division drops D26N only 13 s after the train reached D25N: never exact.
      passage('dep', 'D26N', 'D25N', T0 + 143, { lo: T0 + 140, hi: T0 + 143, exact: false }),
    ]);
    // Not 130 s from arrival to arrival (the stop at D26N) nor 143 s to the late drop.
    expect(runs.map((run) => [run.from.stop, run.to.stop, run.seconds])).toEqual([
      ['D26N', 'D25N', 100],
    ]);
  });

  it('takes the departure time the feed gave inside its window when the train said nothing', () => {
    const runs = runsOf([
      arrival('101N', '103N', T0),
      passage('dep', '101N', '103N', T0 + 25, { lo: T0 + 20, hi: T0 + 30, exact: true }),
      arrival('103N', null, T0 + 120),
    ]);
    expect(runs.map((run) => run.seconds)).toEqual([95]);
  });

  it('measures no run when the departure is known only by a late window', () => {
    const runs = runsOf([
      arrival('D26N', 'D25N', T0),
      passage('dep', 'D26N', 'D25N', T0 + 143, { lo: T0 + 140, hi: T0 + 143, exact: false }),
      arrival('D25N', null, T0 + 130),
    ]);
    expect(runs).toEqual([]);
  });
});
