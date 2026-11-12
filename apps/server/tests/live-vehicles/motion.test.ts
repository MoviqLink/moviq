import { describe, expect, it } from 'vitest';

import { bearingDegrees, distanceMeters, normalBearing } from '../../src/modules/live/geo.js';
import { createMotionTracker } from '../../src/modules/live/motion.js';

const METERS_PER_DEGREE = 111_195;
const at = (seconds: number) => Date.parse('2026-11-11T01:05:10.000Z') + seconds * 1000;
const fix = (seconds: number, metersNorth = 0, metersEast = 0) => ({
  lat: 40.679 + metersNorth / METERS_PER_DEGREE,
  lon: -73.76 + metersEast / (METERS_PER_DEGREE * Math.cos((40.679 * Math.PI) / 180)),
  at: at(seconds),
});

describe('speed and course between two GPS reports', () => {
  it('has none from a single report, nor from the same report seen twice', () => {
    const tracker = createMotionTracker();
    tracker.observe('bus', fix(0));
    expect(tracker.motion('bus')).toBeUndefined();
    tracker.observe('bus', fix(0));
    expect(tracker.motion('bus')).toBeUndefined();
  });

  it('computes the average speed and course of the last two reports', () => {
    const tracker = createMotionTracker();
    tracker.observe('bus', fix(0));
    tracker.observe('bus', fix(30, 125));
    const first = tracker.motion('bus');
    expect(first?.kmh).toBeCloseTo(15, 1);
    expect(first?.overSeconds).toBe(30);
    expect(first?.bearing).toBeCloseTo(0, 1);
    tracker.observe('bus', fix(60, 125, 250));
    expect(tracker.motion('bus')?.kmh).toBeCloseTo(30, 1);
    expect(tracker.motion('bus')?.overSeconds).toBe(30);
    expect(tracker.motion('bus')?.bearing).toBeCloseTo(90, 0);
  });

  it('gives no speed over too short or too long a gap, nor for a GPS jump', () => {
    const tracker = createMotionTracker();
    tracker.observe('short', fix(0));
    tracker.observe('short', fix(3, 10));
    tracker.observe('long', fix(0));
    tracker.observe('long', fix(200, 500));
    tracker.observe('jump', fix(0));
    tracker.observe('jump', fix(10, 1_000));
    expect(tracker.motion('short')).toBeUndefined();
    expect(tracker.motion('long')).toBeUndefined();
    expect(tracker.motion('jump')).toBeUndefined();
  });

  it('keeps the speed of a bus that barely moved but gives it no course', () => {
    const tracker = createMotionTracker();
    tracker.observe('bus', fix(0));
    tracker.observe('bus', fix(30, 5));
    expect(tracker.motion('bus')?.kmh).toBeCloseTo(0.6, 1);
    expect(tracker.motion('bus')?.bearing).toBeNull();
  });

  it('ignores a report older than the last one and forgets buses unseen for 15 minutes', () => {
    const tracker = createMotionTracker();
    tracker.observe('bus', fix(0));
    tracker.observe('bus', fix(30, 125));
    tracker.observe('bus', fix(10, 999));
    expect(tracker.motion('bus')?.kmh).toBeCloseTo(15, 1);
    tracker.forget(at(30 + 15 * 60 + 1));
    tracker.observe('bus', fix(30 + 15 * 60 + 2));
    expect(tracker.motion('bus')).toBeUndefined();
  });
});

describe('distances and bearings on the map', () => {
  it('measures JFK to LaGuardia and the four cardinal bearings', () => {
    const jfk = { lat: 40.639928, lon: -73.778693 };
    const lga = { lat: 40.77725, lon: -73.872611 };
    expect(distanceMeters(jfk, lga) / 1000).toBeCloseTo(17.2, 1);
    const origin = { lat: 40.7, lon: -73.9 };
    expect(bearingDegrees(origin, { lat: 40.8, lon: -73.9 })).toBeCloseTo(0, 5);
    expect(bearingDegrees(origin, { lat: 40.7, lon: -73.8 })).toBeCloseTo(90, 1);
    expect(bearingDegrees(origin, { lat: 40.6, lon: -73.9 })).toBeCloseTo(180, 5);
    expect(bearingDegrees(origin, { lat: 40.7, lon: -74.0 })).toBeCloseTo(270, 1);
  });

  it('folds a reported bearing into [0, 360)', () => {
    expect(normalBearing(343.4)).toBe(343.4);
    expect(normalBearing(360)).toBe(0);
    expect(normalBearing(-90)).toBe(270);
    expect(normalBearing(null)).toBeNull();
    expect(normalBearing(Number.NaN)).toBeNull();
  });
});
