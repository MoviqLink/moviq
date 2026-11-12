import type { Journey } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { project, riskyLegs } from '../src/features/trip/model/projection';
import { buildTimeline } from '../src/features/trip/model/timeline';
import { orderAlternatives, orderItineraries } from '../src/shared/journey/order';
import { ridesLine } from '../src/shared/journey/rides';
import { journeyEn } from '../src/shared/journey/texts';
import { arrivalTiming, departureTiming } from '../src/shared/journey/timing';
import { minutesBetween } from '../src/shared/time/city';
import { journey, plan, scene } from './fixtures/journeys';

const now = Date.parse('2026-11-11T12:00:00.000Z');

describe('order of the options', () => {
  it('puts the recommended itinerary first and keeps the server order for the rest', () => {
    const p = plan(now, 'en');
    expect(p.itineraries.map((i) => i.id)).toEqual(['it-subway', 'it-m60']);
    expect(orderItineraries(p).map((i) => i.id)).toEqual(['it-m60', 'it-subway']);
    expect(orderItineraries({ ...p, recommendedId: null }).map((i) => i.id)).toEqual([
      'it-subway',
      'it-m60',
    ]);
  });

  it('puts the recommended alternative first', () => {
    const { alternatives } = journey(now, 'en', true);
    expect(alternatives.map((a) => a.id)).toEqual(['alt-q70', 'alt-taxi']);
    expect(orderAlternatives(alternatives).map((a) => a.id)).toEqual(['alt-taxi', 'alt-q70']);
  });
});

describe('where each time comes from', () => {
  it('times leaving by the first vehicle and arriving by the last one', () => {
    const [subway, bus] = plan(now, 'en').itineraries;
    expect(subway && departureTiming(subway.legs)).toBe('scheduled');
    expect(bus && departureTiming(bus.legs)).toBe('realtime');
    expect(bus && arrivalTiming(bus.legs)).toBe('realtime');
  });

  it('calls a trip made only on foot an estimate', () => {
    const walk = journey(now, 'en', false).itinerary.legs.filter((leg) => leg.mode === 'walk');
    expect(departureTiming(walk)).toBe('estimated');
    expect(arrivalTiming(walk)).toBe('estimated');
  });

  it('names the rides in MovIQ style, with the mode in words', () => {
    const p = plan(now, 'en');
    expect(p.itineraries.map((i) => ridesLine(i, journeyEn))).toEqual([
      'Subway N → Bus Q70-SBS',
      'Bus M60-SBS',
    ]);
  });
});

describe('margins', () => {
  it('round down, so a margin is never overstated', () => {
    expect(minutesBetween('2026-11-11T12:00:00.000Z', '2026-11-11T12:09:59.000Z')).toBe(9);
    expect(minutesBetween('2026-11-11T12:10:30.000Z', '2026-11-11T12:00:00.000Z')).toBe(-11);
  });

  it('take the arrival the server projected from live data', () => {
    const j = journey(now, 'en', true);
    expect(project(j)).toEqual({
      arriveAt: j.watch.projectedArriveAt,
      source: 'live',
      shiftMinutes: 31,
      spareMinutes: 7,
    });
    expect(Date.parse(project(j).arriveAt)).toBe(scene(now).start + 76 * 60_000);
  });

  it('fall back to the plan, from the timetable, while there is no projection', () => {
    const j = journey(now, 'en', true, false);
    expect(project(j)).toEqual({
      arriveAt: j.itinerary.arriveAt,
      source: 'plan',
      shiftMinutes: 0,
      spareMinutes: 38,
    });
  });

  it('say late with a negative margin', () => {
    const base = journey(now, 'en', true);
    const late = new Date(Date.parse(base.request.arriveBy) + 12 * 60_000).toISOString();
    expect(
      project({ ...base, watch: { ...base.watch, projectedArriveAt: late } }).spareMinutes,
    ).toBe(-12);
  });

  it('mark the legs with an incident as risky', () => {
    const base = journey(now, 'en', true);
    const [incident] = base.incidents;
    if (incident === undefined) throw new Error('fixture without incident');
    const incidents: Journey['incidents'] = [incident, { ...incident, id: 'b', legIndex: 2 }];
    expect(riskyLegs(incidents)).toEqual(new Set([1, 2]));
  });
});

describe('timeline of the plan and the projection', () => {
  it('places each leg as planned, the deadline and the projected arrival on one axis', () => {
    const j = journey(now, 'en', true);
    const tl = buildTimeline(j.itinerary, j.request.arriveBy, j.watch.projectedArriveAt);
    expect(tl.lanes).toHaveLength(3);
    const [walk, bus] = tl.lanes;
    expect(bus?.left).toBeGreaterThan((walk?.left ?? Infinity) + (walk?.width ?? 0) - 0.001);
    expect(tl.expected).not.toBeNull();
    expect(tl.expected).toBeLessThan(tl.deadline);
    expect(tl.ticks.length).toBeGreaterThan(2);
    for (const tick of tl.ticks) {
      expect(new Date(tick.at).getUTCMinutes() % 15).toBe(0);
      expect(tick.left).toBeGreaterThanOrEqual(4);
      expect(tick.left).toBeLessThanOrEqual(96);
    }
  });

  it('draws no projected arrival without a projection', () => {
    const j = journey(now, 'en', false, false);
    expect(buildTimeline(j.itinerary, j.request.arriveBy, null).expected).toBeNull();
  });
});
