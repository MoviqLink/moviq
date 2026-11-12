import { describe, expect, it } from 'vitest';

import { gtfsStaticSources } from '../../src/modules/data-platform/sources/mta/gtfs-static.js';
import { createTimetables } from '../../src/modules/live/timetable.js';
import { manualClock } from '../support/manual-clock.js';
import { parsedCapture, readerWith } from './reader.js';

describe('timetable cache', () => {
  it('retries an empty bus index promptly, then keeps an available index for a minute', async () => {
    const at = '2026-11-11T01:10:00.000Z';
    const source = gtfsStaticSources.find((item) => item.id === 'mta-gtfs-bus-manhattan');
    if (source === undefined) throw new Error('Manhattan timetable is missing');
    const clock = manualClock(at);
    const answers = new Map<string, unknown>();
    const timetables = createTimetables(readerWith(answers, at), clock);
    expect((await timetables.current()).bus.route('M5')).toBeUndefined();
    answers.set(source.id, parsedCapture(source, 'mta/gtfs_m.zip', at));
    clock.advance(4_999);
    expect((await timetables.current()).bus.route('M5')).toBeUndefined();
    clock.advance(1);
    expect((await timetables.current()).bus.route('M5')?.shortName).toBe('M5');
    answers.clear();
    clock.advance(59_999);
    expect((await timetables.current()).bus.route('M5')?.shortName).toBe('M5');
    clock.advance(1);
    expect((await timetables.current()).bus.route('M5')).toBeUndefined();
  });
});
