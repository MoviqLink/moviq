import { describe, expect, it } from 'vitest';

import {
  fromGtfsDate,
  fromNewYorkWallClock,
  fromNewYorkWallClockText,
  newYorkGtfsDate,
  toNewYorkWallClockText,
  weekdayOfGtfsDate,
} from '../src/infrastructure/clock/new-york.js';

describe('New York time', () => {
  it('converts wall-clock fields on both sides of the daylight-saving changes', () => {
    const at = (month: number, day: number, hour: number) =>
      fromNewYorkWallClock({ year: 2026, month, day, hour, minute: 0, second: 0 })?.toISOString();
    expect(at(11, 11, 12)).toBe('2026-11-11T17:00:00.000Z');
    expect(at(7, 1, 12)).toBe('2026-07-01T16:00:00.000Z');
    expect(at(3, 8, 1)).toBe('2026-03-08T06:00:00.000Z');
    expect(at(3, 8, 3)).toBe('2026-03-08T07:00:00.000Z');
    expect(at(11, 1, 3)).toBe('2026-11-01T08:00:00.000Z');
    expect(
      fromNewYorkWallClock({ year: 2026, month: 2, day: 30, hour: 0, minute: 0, second: 0 }),
    ).toBeUndefined();
  });

  it('reads and writes zone-less text, refusing times that do not exist', () => {
    expect(fromNewYorkWallClockText('2026-11-10T18:07:07.000')?.toISOString()).toBe(
      '2026-11-10T23:07:07.000Z',
    );
    expect(toNewYorkWallClockText(new Date('2026-11-10T23:07:07.000Z'))).toBe(
      '2026-11-10T18:07:07',
    );
    expect(fromNewYorkWallClockText('2026-03-08T02:30:00')).toBeUndefined();
    expect(fromNewYorkWallClockText('2026-11-10 18:07')).toBeUndefined();
  });

  it('handles GTFS service dates in New York, not in UTC', () => {
    expect(fromGtfsDate('20261111')?.toISOString()).toBe('2026-11-11T05:00:00.000Z');
    expect(fromGtfsDate('20260231')).toBeUndefined();
    expect(newYorkGtfsDate(new Date('2026-11-12T03:00:00.000Z'))).toBe('20261111');
    expect(weekdayOfGtfsDate('20261111')).toBe(2);
    expect(weekdayOfGtfsDate('20261115')).toBe(6);
  });
});
