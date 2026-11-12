import { describe, expect, it } from 'vitest';

import { formatDuration, formatLimit, formatMs } from '../src/shared/time/duration';
import { secondsUntil } from '../src/shared/time/instant';

describe('time on screen', () => {
  it('writes a span with its two largest units', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(59.9)).toBe('59 s');
    expect(formatDuration(185)).toBe('3 min 05 s');
    expect(formatDuration(7_830)).toBe('2 h 10 min');
    expect(formatDuration(273_600)).toBe('3 d 4 h');
    expect(formatDuration(-4)).toBe('0 s');
  });

  it('writes a limit in its natural unit', () => {
    expect(formatLimit(60)).toBe('60 s');
    expect(formatLimit(900)).toBe('15 min');
    expect(formatLimit(129_600)).toBe('36 h');
  });

  it('writes latencies in ms, and in seconds from one second on', () => {
    expect(formatMs(420, 'en-US')).toBe('420 ms');
    expect(formatMs(1_380, 'en-US')).toBe('1.4 s');
    expect(formatMs(1_380, 'es-ES')).toBe('1,4 s');
  });

  it('counts down to an instant and goes negative once it has passed', () => {
    const at = '2026-11-11T14:00:30.000Z';
    expect(secondsUntil(at, Date.parse('2026-11-11T14:00:00.000Z'))).toBe(30);
    expect(secondsUntil(at, Date.parse('2026-11-11T14:01:00.000Z'))).toBe(-30);
  });
});
