import { describe, expect, it } from 'vitest';

import {
  boundsOf,
  pathOf,
  routeFeatures,
  stopsOf,
  trimLine,
  trimRoute,
} from '../src/features/trip/map/geometry';
import { journey } from './fixtures/journeys';

const now = Date.parse('2026-11-11T12:00:00.000Z');

describe('the route on the map', () => {
  it('draws one line per leg, walking apart and the legs with an incident as risky', () => {
    const { itinerary } = journey(now, 'en', true);
    const route = routeFeatures(itinerary, new Set([1]));
    expect(route.features.map((f) => f.properties)).toEqual([
      { kind: 'walk', risk: false },
      { kind: 'ride', risk: true },
      { kind: 'walk', risk: false },
    ]);
  });

  it('joins the two places of a leg with no path from the source', () => {
    const [first] = journey(now, 'en', false).itinerary.legs;
    if (first === undefined) throw new Error('fixture without legs');
    expect(pathOf({ ...first, path: [] })).toEqual([
      [first.from.lon, first.from.lat],
      [first.to.lon, first.to.lat],
    ]);
  });

  it('frames every leg of the itineraries given', () => {
    const { itinerary, alternatives } = journey(now, 'en', true);
    const taxi = alternatives.find((a) => a.id === 'alt-taxi')?.itinerary;
    if (taxi === undefined) throw new Error('fixture without taxi');
    const [[west, south], [east, north]] = boundsOf([itinerary, taxi]) ?? [
      [0, 0],
      [0, 0],
    ];
    expect(west).toBeCloseTo(-73.9395);
    expect(east).toBeCloseTo(-73.8712);
    expect(south).toBeCloseTo(40.7681);
    expect(north).toBeCloseTo(40.8044);
    expect(boundsOf([])).toBeNull();
  });

  it('grows the line from its start to its end, once', () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    expect(trimLine(line, 0)).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(trimLine(line, 0.25)).toEqual([
      [0, 0],
      [0.5, 0],
    ]);
    expect(trimLine(line, 0.75)).toEqual([
      [0, 0],
      [1, 0],
      [1, 0.5],
    ]);
    expect(trimLine(line, 1)).toEqual(line);
  });

  it('draws the legs in order, leaving out those not reached yet', () => {
    const route = routeFeatures(journey(now, 'en', false).itinerary);
    expect(trimRoute(route, 0).features).toHaveLength(0);
    expect(trimRoute(route, 0.5).features).toHaveLength(2);
    expect(trimRoute(route, 1)).toEqual(route);
  });

  it('marks where the trip starts, each boarding after the first leg and the arrival', () => {
    const stops = stopsOf(journey(now, 'en', false).itinerary);
    expect(stops.map((s) => [s.kind, s.label])).toEqual([
      ['start', 'E 125 St & Lexington Av'],
      ['board', 'M60-SBS · Lexington Av / E 125 St'],
      ['end', 'LaGuardia Airport, Terminal B'],
    ]);
  });
});
