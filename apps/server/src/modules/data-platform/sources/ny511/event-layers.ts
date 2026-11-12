import type { ProductFeature } from '@moviq/contracts';

import type { SourceDefinition } from '../../definition.js';
import { HOUR, MINUTE } from '../mta/provider.js';
import { parseRoadEvents, roadEventLayerSchema, type RoadEventLayer } from './events.js';
import { NY511_API, NY511_LICENCE, NY511_PROVIDER, ny511Failures } from './provider.js';

const MB = 1024 * 1024;

interface EventLayer {
  readonly id: string;
  readonly title: string;
  /** The query of the layer in 511NY's map configuration, unchanged. */
  readonly query: string;
  readonly rhythm: SourceDefinition['rhythm'];
  readonly freshness: SourceDefinition['freshness'];
  readonly maxBytes: number;
  /** Fewer events than this in the whole state is a cut layer; 0 when an empty layer is real. */
  readonly minimumStatewide: number;
  readonly consumers: readonly ProductFeature[];
}

/**
 * One layer of 511NY road events (TRANSCOM: New York, New Jersey and Connecticut), cut to the
 * city area. The layer carries no time of its own: it is dated by its receipt, and each event
 * keeps the time 511NY last updated it. 511NY's map asks every layer at most once a minute (its
 * `poll`), which no rhythm here goes below.
 */
function eventLayerSource(layer: EventLayer): SourceDefinition<RoadEventLayer> {
  return {
    id: layer.id,
    title: layer.title,
    provider: NY511_PROVIDER,
    licence: NY511_LICENCE,
    kind: 'realtime',
    rhythm: layer.rhythm,
    freshness: layer.freshness,
    limits: { timeoutMs: 30_000, maxBytes: layer.maxBytes },
    dataTimeSource: 'receipt',
    keepVersions: 1,
    dataSchema: roadEventLayerSchema,
    request() {
      return {
        url: `${NY511_API}events/map-features?${layer.query}`,
        headers: { accept: 'application/json' },
      };
    },
    parse(body, { receivedAt }) {
      return parseRoadEvents(body, receivedAt);
    },
    check(data) {
      return data.statewide < layer.minimumStatewide
        ? [`${String(data.statewide)} events statewide, minimum ${String(layer.minimumStatewide)}`]
        : [];
    },
    consumers: layer.consumers,
    failures: ny511Failures(
      layer.minimumStatewide === 0
        ? 'Never: an empty layer is real data'
        : `Fewer than ${String(layer.minimumStatewide)} events in the whole state`,
    ),
  };
}

/** Every minute while a trip is watched, as 511NY's map; minutes old at most when healthy. */
const LIVE_RHYTHM = {
  class: 'warm',
  baseIntervalMs: 2 * MINUTE,
  interestIntervalMs: MINUTE,
} as const;
const LIVE_FRESHNESS = {
  degradedAfterMs: 5 * MINUTE,
  staleAfterMs: 15 * MINUTE,
  unavailableAfterMs: HOUR,
} as const;

/** Roads closed now or within five minutes: 215 statewide, 132 in the city area on 11/11/2026. */
export const ny511Closures = eventLayerSource({
  id: 'ny511-closures',
  title: '511NY road closures',
  query: 'eventClassifications=closures&maxBeginDateOffset=300000',
  rhythm: LIVE_RHYTHM,
  freshness: LIVE_FRESHNESS,
  maxBytes: 8 * MB,
  minimumStatewide: 50,
  consumers: ['live-map', 'trip-watch'],
});

/** Crashes, debris, police activity: 20 statewide and 10 in the city area that night. */
export const ny511Incidents = eventLayerSource({
  id: 'ny511-incidents',
  title: '511NY traffic incidents',
  query: 'eventClassifications=incidents',
  rhythm: LIVE_RHYTHM,
  freshness: LIVE_FRESHNESS,
  maxBytes: 4 * MB,
  minimumStatewide: 0,
  consumers: ['live-map', 'trip-watch'],
});

/**
 * Roadwork under way or starting within five minutes: 803 statewide (3.4 MB), 137 in the city
 * area; the newest had changed 3 minutes before. Every 5 minutes, every 2 while watched.
 */
export const ny511Construction = eventLayerSource({
  id: 'ny511-construction',
  title: '511NY roadwork now',
  query: 'eventClassifications=construction&maxBeginDateOffset=300000',
  rhythm: { class: 'warm', baseIntervalMs: 5 * MINUTE, interestIntervalMs: 2 * MINUTE },
  freshness: { degradedAfterMs: 15 * MINUTE, staleAfterMs: HOUR, unavailableAfterMs: 3 * HOUR },
  maxBytes: 16 * MB,
  minimumStatewide: 200,
  consumers: ['live-map'],
});

/** Roadwork starting in two days or more: 232 statewide, all inactive. Every half hour. */
export const ny511FutureConstruction = eventLayerSource({
  id: 'ny511-future-construction',
  title: '511NY roadwork planned',
  query: 'eventClassifications=construction&minBeginDateOffset=172800000',
  rhythm: { class: 'warm', baseIntervalMs: 30 * MINUTE },
  freshness: { degradedAfterMs: 2 * HOUR, staleAfterMs: 6 * HOUR, unavailableAfterMs: 24 * HOUR },
  maxBytes: 8 * MB,
  minimumStatewide: 50,
  consumers: ['live-map'],
});

/** Games, concerts and parades of the next two weeks: 73 statewide, 67 in the city area. */
export const ny511SpecialEvents = eventLayerSource({
  id: 'ny511-special-events',
  title: '511NY special events',
  query: 'eventClassifications=specialEvents&maxBeginDateOffset=1210000000',
  rhythm: { class: 'warm', baseIntervalMs: 15 * MINUTE, interestIntervalMs: 5 * MINUTE },
  freshness: { degradedAfterMs: HOUR, staleAfterMs: 3 * HOUR, unavailableAfterMs: 12 * HOUR },
  maxBytes: 4 * MB,
  minimumStatewide: 0,
  consumers: ['live-map'],
});

/** Planned work on subway, rail and bus lines: 169 statewide, 154 in the city area. */
export const ny511TransitEvents = eventLayerSource({
  id: 'ny511-transit-events',
  title: '511NY transit service changes',
  query: 'eventClassifications=transitEvents',
  rhythm: { class: 'warm', baseIntervalMs: 5 * MINUTE, interestIntervalMs: 2 * MINUTE },
  freshness: { degradedAfterMs: 15 * MINUTE, staleAfterMs: HOUR, unavailableAfterMs: 3 * HOUR },
  maxBytes: 8 * MB,
  minimumStatewide: 20,
  consumers: ['live-map', 'service-alerts'],
});

/**
 * Weather warnings drawn as areas on 511NY's map, asked every 6 minutes there. None was active
 * on 11/11/2026, so the format of a warning is not seen yet: a warning that does not read as an
 * event is refused as `unexpected-shape` rather than guessed.
 */
export const ny511WeatherWarnings = eventLayerSource({
  id: 'ny511-weather-warnings',
  title: '511NY weather warnings',
  query: 'eventClassifications=weatherWarningsAreaEvents',
  rhythm: { class: 'warm', baseIntervalMs: 10 * MINUTE, interestIntervalMs: 6 * MINUTE },
  freshness: { degradedAfterMs: 30 * MINUTE, staleAfterMs: 2 * HOUR, unavailableAfterMs: 6 * HOUR },
  maxBytes: 4 * MB,
  minimumStatewide: 0,
  consumers: ['weather', 'live-map'],
});
