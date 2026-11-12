import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, refuse } from '../city/parsing.js';
import { HOUR, MINUTE, count } from '../mta/provider.js';
import {
  NY511_API,
  NY511_LICENCE,
  NY511_PROVIDER,
  aheadOf,
  inCityArea,
  ny511Failures,
} from './provider.js';

const signFeatureSchema = z.object({
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.object({
    id: z.string().min(1),
    status: z.string().min(1),
    agencyId: z.string().min(1),
    agencyName: z.string().min(1),
    name: z.string().min(1),
    updated: z.number().int().positive(),
    route: z.string(),
    description: z.string().optional(),
    signFacingDirection: z.string(),
    pages: z.array(z.object({ lines: z.array(z.string()) })),
  }),
});

const signsBodySchema = z.object({ features: z.array(signFeatureSchema) });

const signSchema = z.object({
  id: z.string().min(1),
  agency: z.string().min(1),
  name: z.string().min(1),
  road: z.string(),
  /** Where the sign stands, as `I-278 W at MP 25.4 (New York City)`. */
  place: z.string().nullable(),
  facing: z.string(),
  status: z.string().min(1),
  /** Each page as its lines, exactly as displayed. */
  pages: z.array(z.array(z.string())),
  /** Null for every sign of an agency whose clock was found ahead of ours. */
  updatedAt: instantSchema.nullable(),
  point: z.tuple([z.number(), z.number()]),
});

const messageSignsSchema = z.object({
  readAt: instantSchema,
  statewide: z.number().int().nonnegative(),
  /** Agencies with a sign dated ahead of our clock: none of their times is shown. */
  clockAhead: z.array(z.string()),
  signs: z.array(signSchema),
});

export type MessageSigns = z.infer<typeof messageSignsSchema>;
type SignFeature = z.infer<typeof signFeatureSchema>;

/** 404 signs statewide on 11/11/2026. */
const MINIMUM_STATEWIDE = 150;

/**
 * On 11/11/2026, 48 of the 67 signs of NYSDOT Region 11 (New York City) were dated up to 4.9
 * hours ahead, as if New York time were written as UTC, so even its past times are off. When one
 * sign of an agency is ahead, no time of that agency is trusted.
 */
function agenciesAhead(features: readonly SignFeature[], receivedAt: Date): Set<string> {
  return new Set(
    features
      .filter((feature) => aheadOf(feature.properties.updated, receivedAt))
      .map((feature) => feature.properties.agencyName),
  );
}

function parseSigns(body: Uint8Array, receivedAt: Date): ParseResult<MessageSigns> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const parsed = signsBodySchema.safeParse(decoded.value);
  if (!parsed.success) return refuse('unexpected-shape', describeIssue(parsed.error));
  const features = parsed.data.features;
  const ahead = agenciesAhead(features, receivedAt);
  const signs = features
    .filter((feature) => inCityArea(feature.geometry.coordinates))
    .map(({ geometry, properties }) => ({
      id: properties.id,
      agency: properties.agencyName,
      name: properties.name,
      road: properties.route,
      place: properties.description ?? null,
      facing: properties.signFacingDirection,
      status: properties.status,
      pages: properties.pages.map((page) => page.lines),
      updatedAt: ahead.has(properties.agencyName) ? null : toInstant(new Date(properties.updated)),
      point: geometry.coordinates,
    }));
  return {
    ok: true,
    data: {
      readAt: toInstant(receivedAt),
      statewide: features.length,
      clockAhead: [...ahead].sort(),
      signs,
    },
    dataTime: receivedAt,
    coverage: `${count(signs.length, 'signs')} in the city area, ${String(ahead.size)} agencies ahead`,
  };
}

/**
 * The messages on the variable message signs over the roads. 511NY's map asks every 30 seconds;
 * here every 2 minutes, every minute while a trip is watched. The layer has no time of its own.
 */
export const ny511MessageSigns: SourceDefinition<MessageSigns> = {
  id: 'ny511-message-signs',
  title: '511NY message signs',
  provider: NY511_PROVIDER,
  licence: NY511_LICENCE,
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 2 * MINUTE, interestIntervalMs: MINUTE },
  freshness: { degradedAfterMs: 5 * MINUTE, staleAfterMs: 15 * MINUTE, unavailableAfterMs: HOUR },
  limits: { timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 1,
  dataSchema: messageSignsSchema,
  request() {
    return { url: `${NY511_API}signs/map-features`, headers: { accept: 'application/json' } };
  },
  parse(body, { receivedAt }) {
    return parseSigns(body, receivedAt);
  },
  check(data) {
    return data.statewide < MINIMUM_STATEWIDE
      ? [`${String(data.statewide)} signs statewide, minimum ${String(MINIMUM_STATEWIDE)}`]
      : [];
  },
  consumers: ['live-map'],
  failures: ny511Failures(`Fewer than ${String(MINIMUM_STATEWIDE)} signs in the whole state`),
};
