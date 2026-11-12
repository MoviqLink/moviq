import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { SourceDefinition } from '../../../src/modules/data-platform/definition.js';
import type { RoadEventLayer } from '../../../src/modules/data-platform/sources/ny511/events.js';
import {
  ny511Closures,
  ny511Construction,
  ny511FutureConstruction,
  ny511Incidents,
  ny511SpecialEvents,
  ny511TransitEvents,
  ny511WeatherWarnings,
} from '../../../src/modules/data-platform/sources/ny511/event-layers.js';
import { ny511Sources } from '../../../src/modules/data-platform/sources/ny511/index.js';
import { RECEIVED, accepted, capture, captureJson, text } from './captures.js';

function parse(source: SourceDefinition<RoadEventLayer>, name: string, receivedAt: Date) {
  return source.parse(capture('ny511', name), { receivedAt, previous: undefined });
}

const layers = [
  [
    ny511Closures,
    'closures.json',
    RECEIVED.closures,
    '6 in the city area of 7 statewide, 3 active now',
  ],
  [
    ny511Incidents,
    'incidents.json',
    RECEIVED.incidents,
    '3 in the city area of 4 statewide, 2 active now',
  ],
  [
    ny511Construction,
    'construction.json',
    RECEIVED.construction,
    '4 in the city area of 5 statewide, 3 active now',
  ],
  [
    ny511FutureConstruction,
    'future-construction.json',
    RECEIVED.futureConstruction,
    '3 in the city area of 4 statewide, 0 active now',
  ],
  [
    ny511SpecialEvents,
    'special-events.json',
    RECEIVED.specialEvents,
    '3 in the city area of 4 statewide, 1 active now',
  ],
  [
    ny511TransitEvents,
    'transit-events.json',
    RECEIVED.transitEvents,
    '3 in the city area of 4 statewide, 2 active now',
  ],
  [
    ny511WeatherWarnings,
    'weather-warnings.json',
    RECEIVED.weatherWarnings,
    '0 in the city area of 0 statewide, 0 active now',
  ],
] as const;

describe('511NY event layers', () => {
  it.each(layers)(
    '%s accepts its capture, dated by receipt, and stores it unchanged',
    (source, name, at, coverage) => {
      const result = accepted(parse(source, name, at));
      expect(result.dataTime).toEqual(at);
      expect(result.coverage).toBe(coverage);
      expect(source.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(result.data);
      expect(source.dataTimeSource).toBe('receipt');
    },
  );

  it('keeps the meaning, the agency and the update time of each event, without its markup', () => {
    const { events } = accepted(parse(ny511Closures, 'closures.json', RECEIVED.closures)).data;
    expect(events.find((event) => event.id === 'TRANSCOM-ORC300605835')).toEqual({
      id: 'TRANSCOM-ORC300605835',
      agency: 'NYSDOT',
      severity: 'urgent',
      headline: 'Road Closed',
      title: 'NORFOLK ST northbound: Road closed.',
      description:
        'Construction on NORFOLK ST, northbound, between GRAND ST (New York) to install conduit for ' +
        'system reliability, Saturday October 24th,2026 thru Saturday November 14th,2026, Saturday, ' +
        '08:00 AM thru 06:00 PM, All lanes closed northbound.',
      road: 'NORFOLK ST',
      place: 'NORFOLK ST northbound: At GRAND ST.',
      active: false,
      startsAt: '2026-10-24T12:00:00.000Z',
      periods: [],
      updatedAt: '2026-11-08T23:00:03.000Z',
      geometry: { type: 'Point', coordinates: [-73.98835082094571, 40.716506023784255] },
    });
  });

  it('cuts each layer to the city area, keeping lines that enter it', () => {
    const { events } = accepted(parse(ny511Closures, 'closures.json', RECEIVED.closures)).data;
    expect(events.map((event) => event.id)).not.toContain('TRANSCOM-ORC300610358');
    expect(events.some((event) => event.geometry.type === 'LineString')).toBe(true);
  });

  it('names the transit line of a transit event as its place', () => {
    const { events } = accepted(
      parse(ny511TransitEvents, 'transit-events.json', RECEIVED.transitEvents),
    ).data;
    expect(events[0]).toMatchObject({
      road: null,
      place: '4 Line: from 167 St to Burnside Av: 4 Line: from 167 St to Burnside Av.',
    });
  });

  it('keeps an area that crosses the city, as weather warnings are drawn', () => {
    const body = z
      .object({ features: z.array(z.record(z.string(), z.unknown())) })
      .parse(captureJson('ny511', 'incidents.json'));
    const area = {
      type: 'Polygon',
      coordinates: [
        [
          [-74.5, 40.5],
          [-73.5, 40.5],
          [-73.5, 41],
          [-74.5, 41],
          [-74.5, 40.5],
        ],
      ],
    };
    const features = body.features.map((feature) => ({ ...feature, geometry: area }));
    const result = accepted(
      ny511WeatherWarnings.parse(text(JSON.stringify({ features })), {
        receivedAt: RECEIVED.incidents,
        previous: undefined,
      }),
    );
    expect(result.data.events).toHaveLength(4);
  });

  it('shows no update time that 511NY dated ahead of our clock', () => {
    const early = new Date('2020-01-01T00:00:00Z');
    const { events } = accepted(parse(ny511Closures, 'closures.json', early)).data;
    expect(events.every((event) => event.updatedAt === null)).toBe(true);
  });

  it('refuses a cut layer, but never an empty layer that can be real', () => {
    const closures = accepted(parse(ny511Closures, 'closures.json', RECEIVED.closures)).data;
    expect(ny511Closures.check?.(closures, undefined)).toEqual(['7 events statewide, minimum 50']);
    const warnings = accepted(
      parse(ny511WeatherWarnings, 'weather-warnings.json', RECEIVED.weatherWarnings),
    ).data;
    expect(ny511WeatherWarnings.check?.(warnings, undefined)).toEqual([]);
  });

  it.each([
    ['not-json', text('<html>502</html>')],
    ['unexpected-shape', text(JSON.stringify({ features: [{ properties: { id: 'x' } }] }))],
  ])('refuses %s', (code, body) => {
    expect(
      ny511Incidents.parse(body, { receivedAt: RECEIVED.incidents, previous: undefined }),
    ).toMatchObject({ ok: false, code });
  });

  it('asks the queries of 511NY map, without a key and never the Waze layer', () => {
    const urls = ny511Sources.map(
      (source) => source.request({ credentials: {}, now: RECEIVED.closures }).url,
    );
    expect(urls).toContain(
      'https://api-511x-nysdot.carsprogram.org/events/map-features?' +
        'eventClassifications=closures&maxBeginDateOffset=300000',
    );
    expect(urls.join(' ')).not.toMatch(/waze|key=/i);
    expect(ny511Closures.consumers).toEqual(['live-map', 'trip-watch']);
    expect(ny511Incidents.consumers).toEqual(['live-map', 'trip-watch']);
  });

  it('never asks a layer more often than 511NY map does (60 s)', () => {
    for (const source of ny511Sources) {
      expect(
        source.rhythm.interestIntervalMs ?? source.rhythm.baseIntervalMs,
      ).toBeGreaterThanOrEqual(60_000);
    }
  });
});
