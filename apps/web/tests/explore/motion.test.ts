import { describe, expect, it } from 'vitest';

import { railTransition } from '../../src/features/explore/map/rail-motion';
import {
  isGliding,
  positionAt,
  retarget,
  turn,
  type Reading,
} from '../../src/features/explore/map/motion';

const reading = (at: readonly [number, number], bearing = 0, id = 'bus:1'): Reading => ({
  id,
  mode: 'bus',
  at,
  bearing,
});
const glide = { glide: true };

describe('a glide between two real readings', () => {
  const first = retarget(new Map(), [reading([-73.76, 40.679])], 0, glide);
  const second = retarget(first, [reading([-73.76, 40.68], 90)], 15_000, glide);
  const track = second.get('bus:1');
  if (track === undefined) throw new Error('The bus needs a track.');

  it('places a new vehicle at once', () => {
    const placed = first.get('bus:1');
    expect(placed && positionAt(placed, 0)).toEqual([-73.76, 40.679]);
    expect(placed && isGliding(placed, 0)).toBe(false);
  });

  it('moves linearly for as long as the vehicle took to report again', () => {
    expect(track.duration).toBe(15_000);
    expect(positionAt(track, 15_000)).toEqual([-73.76, 40.679]);
    expect(positionAt(track, 22_500)[1]).toBeCloseTo(40.6795, 6);
    expect(isGliding(track, 22_500)).toBe(true);
  });

  it('never draws past the latest reading', () => {
    expect(positionAt(track, 30_000)).toEqual([-73.76, 40.68]);
    expect(positionAt(track, 90_000)).toEqual([-73.76, 40.68]);
    expect(isGliding(track, 30_000)).toBe(false);
  });

  it('keeps the glide when the same reading comes back', () => {
    const repeated = retarget(second, [reading([-73.76, 40.68], 90)], 20_000, glide);
    expect(repeated.get('bus:1')).toBe(track);
  });

  it('starts the next glide where the mark is drawn, so it never jumps back', () => {
    const third = retarget(second, [reading([-73.76, 40.681], 90)], 22_500, glide);
    const next = third.get('bus:1');
    expect(next && positionAt(next, 22_500)[1]).toBeCloseTo(40.6795, 6);
  });

  it('places at once a move impossible for the mode, and everything with reduced motion', () => {
    const far = retarget(second, [reading([-73.9, 40.8])], 30_000, glide).get('bus:1');
    expect(far && positionAt(far, 30_000)).toEqual([-73.9, 40.8]);
    const reduced = retarget(first, [reading([-73.76, 40.68])], 15_000, { glide: false });
    const placed = reduced.get('bus:1');
    expect(placed && positionAt(placed, 15_000)).toEqual([-73.76, 40.68]);
  });

  it('drops a vehicle that left the data', () => {
    expect(retarget(second, [reading([-73.8, 40.7], 0, 'bus:2')], 30_000, glide).has('bus:1')).toBe(
      false,
    );
  });
});

describe('course', () => {
  it('turns the short way round', () => {
    expect(turn(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(turn(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(turn(0, 90, 0.5)).toBeCloseTo(45, 6);
  });
});

describe('train movement on a verified shape', () => {
  it('follows a bend instead of crossing the space between its endpoints', () => {
    const route = [
      [-73.95, 40.7],
      [-73.95, 40.71],
      [-73.94, 40.71],
    ] as const;
    const moving = railTransition(route[0], route[2], route);
    expect(moving).not.toBeNull();
    const point = moving?.(0.9);
    expect(point?.[1]).toBeCloseTo(40.71, 5);
    expect(moving?.(1)).toEqual(route[2]);
  });

  it('does not interpolate without a route, far from it, or across a large correction', () => {
    const route = [
      [-73.95, 40.7],
      [-73.95, 40.73],
    ] as const;
    expect(railTransition(route[0], route[1], null)).toBeNull();
    expect(railTransition(route[0], [-73.94, 40.71], route)).toBeNull();
    expect(railTransition(route[0], route[1], route)).toBeNull();
  });
});
