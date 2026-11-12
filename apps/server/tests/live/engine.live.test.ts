import { describe, expect, it } from 'vitest';

import { systemClock } from '../../src/infrastructure/clock/clock.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import type { SourceDefinition } from '../../src/modules/data-platform/definition.js';
import { createTransitousRouting } from '../../src/modules/data-platform/on-demand/transitous.js';
import { gtfsStaticSources } from '../../src/modules/data-platform/sources/mta/gtfs-static.js';
import { subwaySources } from '../../src/modules/data-platform/sources/mta/subway-realtime.js';
import {
  subwayPredictions,
  SUBWAY_TIMETABLE,
} from '../../src/modules/journeys/engine/live-sources.js';
import { createEngineRouting } from '../../src/modules/journeys/engine/provider.js';
import type { RoutedItinerary, RouteQuery } from '../../src/modules/journeys/ports.js';
import { timetableFromGtfs } from '../journeys/engine/gtfs-capture.js';

/**
 * MovIQ's engine against Transitous on one trip: the subway timetable and the 1-7 live feed are
 * downloaded once each from the MTA, then both plan Union Square to Grand Central, arriving
 * within the hour. They must agree on the lines and on the latest departure within 15 minutes;
 * the comparison is written as an annotation.
 */
const http = createHttpClient();

async function download(definition: SourceDefinition | undefined, now: Date): Promise<Uint8Array> {
  if (definition === undefined) throw new Error('source not in the catalogue');
  const request = definition.request({ credentials: {}, now });
  const response = await http.get({
    url: request.url,
    headers: request.headers,
    ...definition.limits,
  });
  return response.body;
}

async function collect<T>(definition: SourceDefinition<T> | undefined, now: Date): Promise<T> {
  const body = await download(definition, now);
  const parsed = definition?.parse(body, { receivedAt: now, previous: undefined });
  if (parsed?.ok !== true) throw new Error(`${definition?.id ?? 'source'} refused the answer`);
  return parsed.data;
}

function transitRoutes(itineraries: readonly RoutedItinerary[]): Set<string> {
  return new Set(
    itineraries.flatMap((itinerary) => itinerary.legs.flatMap((leg) => leg.route?.shortName ?? [])),
  );
}

/** `HH:MM` in UTC. */
function clock(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function describeAll(itineraries: readonly RoutedItinerary[]): string {
  return itineraries
    .map((itinerary) =>
      itinerary.legs
        .map(
          (leg) =>
            `${leg.route?.shortName ?? leg.mode} ${clock(leg.departAt)}-${clock(leg.arriveAt)}` +
            (leg.scheduled ? '' : '*'),
        )
        .join(' > '),
    )
    .join(' | ');
}

describe('the engine against Transitous on the real network', () => {
  it('plans Union Square to Grand Central like Transitous does', async ({ annotate }) => {
    const now = new Date();
    const subwayFile = gtfsStaticSources.find((source) => source.id === SUBWAY_TIMETABLE);
    const timetable = timetableFromGtfs(SUBWAY_TIMETABLE, await download(subwayFile, now), now);
    const live = await collect(
      subwaySources.find((source) => source.id === 'mta-subway-1234567'),
      now,
    );
    const provenance = {
      sourceId: SUBWAY_TIMETABLE,
      dataTime: null,
      receivedAt: now.toISOString(),
      ageSeconds: null,
      state: 'healthy' as const,
      evidence: 'Downloaded for the live test.',
    };
    const engine = createEngineRouting({
      sources: {
        readTimetables: () =>
          Promise.resolve([{ sourceId: SUBWAY_TIMETABLE, version: 'live', provenance, timetable }]),
        readPredictions: () =>
          Promise.resolve([
            {
              sourceId: 'mta-subway-1234567',
              provenance: { ...provenance, sourceId: 'mta-subway-1234567' },
              predictions: subwayPredictions(live),
            },
          ]),
      },
      clock: systemClock,
    });
    const query: RouteQuery = {
      from: { label: 'Union Square', lat: 40.7359, lon: -73.9906, kind: 'address', stopId: null },
      to: { label: 'Grand Central', lat: 40.7527, lon: -73.9772, kind: 'address', stopId: null },
      arriveBy: new Date(now.getTime() + 60 * 60_000),
      modes: ['walk', 'subway'],
      maxWalkMinutes: 15,
      stepFree: false,
      count: 3,
    };
    const ours = await engine.plan(query);
    const theirs = await createTransitousRouting({ http, clock: systemClock }).plan(query);
    expect(ours.ok, ours.ok ? '' : ours.detail).toBe(true);
    expect(theirs.ok, theirs.ok ? '' : theirs.detail).toBe(true);
    if (!ours.ok || !theirs.ok) return;
    await annotate(`MovIQ engine: ${describeAll(ours.value)}`);
    await annotate(`Transitous: ${describeAll(theirs.value)}`);
    for (const itinerary of ours.value) {
      expect(itinerary.legs.at(-1)?.arriveAt.getTime()).toBeLessThanOrEqual(
        query.arriveBy.getTime(),
      );
    }
    const shared = [...transitRoutes(ours.value)].filter((route) =>
      transitRoutes(theirs.value).has(route),
    );
    expect(shared.length, 'no line in common').toBeGreaterThan(0);
    const latest = (list: readonly RoutedItinerary[]): number =>
      Math.max(...list.map((itinerary) => itinerary.legs[0]?.departAt.getTime() ?? 0));
    expect(Math.abs(latest(ours.value) - latest(theirs.value))).toBeLessThanOrEqual(15 * 60_000);
  }, 120_000);
});
