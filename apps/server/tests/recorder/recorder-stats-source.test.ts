import { RECORDER_STATS_VERSION, type RecorderStats } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { recorderStatsSource } from '../../src/modules/data-platform/sources/recorder/moviq-recorder-stats.js';

const stats: RecorderStats = {
  version: RECORDER_STATS_VERSION,
  day: '2026-11-10',
  dayType: 'weekday',
  generatedAt: '2026-11-11T09:31:00.000Z',
  complete: false,
  coverage: [{ sourceId: 'mta-subway-ace', missingHours: ['03'], rejected: 1, failed: 0 }],
  counts: {
    events: 120,
    trajectories: 30,
    segmentRuns: 25,
    predictionsJudged: 20,
    predictionsUnmatched: 0,
  },
  segments: [
    [
      'bus',
      'M15',
      '0',
      'X1',
      'X2',
      'am-peak',
      25,
      100,
      101.2,
      102.4,
      106,
      112,
      118,
      121.6,
      122.8,
      124,
    ],
  ],
  headways: [['bus', 'M15', '0', 'am-peak', 24, 300, 300, 7200, 2160000, 1]],
  predictions: [['mta-subway-ace', 120, 300, 20, -10, -9, -8, -5, -0.5, 4, 7, 8, 9]],
  stoppages: [['bus', 'M15', 'TRIP-1', 'V1', 1794398460, 1794398820, 360, 'same place']],
  incidents: [['transit-alert', 'service-alert', '*', 3, 2, 1, 600, null]],
  speeds: [['M15', '-23464:18108:0', 'am-peak', 24, 4.5]],
  tracking: [['M15', 30, 45, 120, 35]],
};

const body = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const context = { receivedAt: new Date('2026-11-11T10:00:00.000Z'), previous: undefined };

describe('the source of the Cloudflare recorder statistics', () => {
  it('asks the recorder for its latest day with the read key', () => {
    const request = recorderStatsSource.request({
      credentials: { RECORDER_URL: 'https://recorder.example/', RECORDER_READ_TOKEN: 'k-1' },
      now: new Date(),
    });
    expect(request).toEqual({
      url: 'https://recorder.example/stats/latest',
      headers: { authorization: 'Bearer k-1', accept: 'application/json' },
    });
    expect(recorderStatsSource.integration).toBe('moviq-recorder');
  });

  it('admits the published day, dated when the recorder made it', () => {
    const result = recorderStatsSource.parse(body(stats), context);
    expect(result).toMatchObject({
      ok: true,
      data: stats,
      dataTime: new Date('2026-11-11T09:31:00.000Z'),
      coverage: '2026-11-10: 1 segments, 1 prediction bands, incomplete',
    });
  });

  it('refuses what is not its schema, and a day older than the one served', () => {
    expect(
      recorderStatsSource.parse(body({ ...stats, version: 'other/2' }), context),
    ).toMatchObject({
      ok: false,
      code: 'schema-mismatch',
    });
    expect(recorderStatsSource.parse(new TextEncoder().encode('<html>'), context)).toMatchObject({
      ok: false,
      code: 'not-json',
    });
    const older = { ...stats, generatedAt: '2026-11-10T09:31:00.000Z' };
    expect(recorderStatsSource.check?.(older, stats)).toHaveLength(1);
    expect(recorderStatsSource.check?.(stats, older)).toEqual([]);
  });
});
