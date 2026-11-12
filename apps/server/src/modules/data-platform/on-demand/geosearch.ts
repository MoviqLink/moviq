import { placeSchema, type Place } from '@moviq/contracts';
import { z } from 'zod';

import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { HttpClient } from '../../../infrastructure/http/client.js';
import type { Geocoder, ProviderOutcome } from '../../journeys/ports.js';
import {
  failure,
  failureFromHttp,
  providerProvenance,
  readJson,
  unexpectedShape,
} from './outcome.js';

const PROVIDER = 'NYC GeoSearch';

/** NYC Planning Labs' Pelias over the city's address database; no key. */
const GEOSEARCH_SEARCH_URL = 'https://geosearch.planninglabs.nyc/v2/search';

const LIMITS = { timeoutMs: 10_000, maxBytes: 512 * 1024 } as const;

/** The parts of a Pelias answer that MovIQ reads: its time, and each match's point and label. */
const geoSearchResponseSchema = z.object({
  geocoding: z.object({ timestamp: z.number().int().positive() }),
  features: z.array(
    z.object({
      geometry: z.object({
        type: z.literal('Point'),
        coordinates: z.tuple([z.number(), z.number()]),
      }),
      properties: z.object({ label: z.string() }),
    }),
  ),
});

type GeoSearchResponse = z.infer<typeof geoSearchResponseSchema>;

interface GeoSearchOptions {
  readonly http: HttpClient;
  readonly clock: Clock;
  /** Matches asked for; GeoSearch returns them best first. */
  readonly size?: number;
}

export function createNycGeoSearch(options: GeoSearchOptions): Geocoder {
  const size = options.size ?? 5;
  return {
    sourceId: 'nyc-geosearch',
    async search(text, signal) {
      const trimmed = text.trim();
      if (trimmed === '')
        return failure('unavailable', 'empty-text', 'There is no text to look up.');
      try {
        const response = await options.http.get({
          url: searchUrl(trimmed, size),
          headers: { accept: 'application/json' },
          ...LIMITS,
          signal,
        });
        return readMatches(response.body, options.clock.now());
      } catch (error) {
        return failureFromHttp(error, PROVIDER);
      }
    },
  };
}

export function searchUrl(text: string, size: number): string {
  const params = new URLSearchParams({ text, size: String(size) });
  return `${GEOSEARCH_SEARCH_URL}?${params.toString()}`;
}

/** The evidence never repeats the text searched: it may be the traveller's home address. */
function readMatches(body: Uint8Array, receivedAt: Date): ProviderOutcome<readonly Place[]> {
  const json = readJson(body, PROVIDER);
  if (!json.ok) return json;
  const parsed = geoSearchResponseSchema.safeParse(json.value);
  if (!parsed.success) return unexpectedShape(parsed.error, PROVIDER);
  const places = placesOf(parsed.data);
  if (places.length === 0) {
    return failure('unavailable', 'no-match', `${PROVIDER} found no address in New York for it.`);
  }
  return {
    ok: true,
    value: places,
    provenance: providerProvenance({
      sourceId: 'nyc-geosearch',
      dataTime: new Date(parsed.data.geocoding.timestamp),
      receivedAt,
      evidence: `${PROVIDER} matched ${String(places.length)} addresses, best first.`,
    }),
  };
}

/** Matches in the New York area, in GeoSearch's order, each point once (aliases share it). */
function placesOf(response: GeoSearchResponse): Place[] {
  const seen = new Set<string>();
  const places: Place[] = [];
  for (const feature of response.features) {
    const [lon, lat] = feature.geometry.coordinates;
    const key = `${String(lon)},${String(lat)}`;
    const parsed = placeSchema.safeParse({
      label: feature.properties.label,
      lat,
      lon,
      kind: 'address',
      stopId: null,
    });
    if (!parsed.success || seen.has(key)) continue;
    seen.add(key);
    places.push(parsed.data);
  }
  return places;
}
