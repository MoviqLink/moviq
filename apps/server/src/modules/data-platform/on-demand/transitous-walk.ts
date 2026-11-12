import { z } from 'zod';

import { HttpError, type HttpClient } from '../../../infrastructure/http/client.js';
import type {
  StreetPoint,
  StreetWalkAnswer,
  StreetWalkAsk,
  WalkProfile,
} from '../../journeys/engine/street-walks.js';
import { readJson } from './outcome.js';
import { decodePolyline } from './polyline.js';
import { TRANSITOUS_PLAN_URL } from './transitous-request.js';

/** The longest walk asked: an hour, the most `preferencesSchema` lets a traveller walk. */
const MAX_WALK_SECONDS = 3600;

/** A walk answers in about half a second (0.41-0.46 s on 11/11/2026); four is the most waited. */
const LIMITS = { timeoutMs: 4000, maxBytes: 512 * 1024 } as const;

const PROFILES: Readonly<Record<WalkProfile, string>> = { foot: 'FOOT', wheelchair: 'WHEELCHAIR' };

/**
 * A walk between two points on the streets: no transit (`transitModes` empty, "no transit
 * connections will be computed"), the walk as the only direct mode, with the MOTIS profile for
 * a wheelchair on a step-free trip. The answer comes in `direct`.
 */
export function walkUrl(ask: StreetWalkAsk, profile: WalkProfile): string {
  const params = new URLSearchParams({
    fromPlace: place(ask.from),
    toPlace: place(ask.to),
    transitModes: '',
    directModes: 'WALK',
    pedestrianProfile: PROFILES[profile],
    maxDirectTime: String(MAX_WALK_SECONDS),
  });
  return `${TRANSITOUS_PLAN_URL}?${params.toString()}`;
}

function place(point: StreetPoint): string {
  return `${String(point.lat)},${String(point.lon)}`;
}

/** The parts of a MOTIS 2 walk that MovIQ reads (OpenAPI `Leg`, `distance` for street legs). */
const walkLegSchema = z.object({
  mode: z.literal('WALK'),
  duration: z.number().int().nonnegative(),
  distance: z.number().nonnegative(),
  legGeometry: z.object({
    points: z.string(),
    precision: z.number().int().min(1).max(10),
    length: z.number().int().nonnegative(),
  }),
});

const walkAnswerSchema = z.object({
  direct: z.array(
    z.object({ duration: z.number().int().nonnegative(), legs: z.array(z.unknown()).min(1) }),
  ),
});

/** The first direct connection made only of walks, as one answer; none means no way. */
function readWalk(body: Uint8Array): StreetWalkAnswer {
  const json = readJson(body, 'Transitous');
  if (!json.ok) return { kind: 'streets-unavailable' };
  const answer = walkAnswerSchema.safeParse(json.value);
  if (!answer.success) return { kind: 'streets-unavailable' };
  for (const direct of answer.data.direct) {
    const legs = z.array(walkLegSchema).safeParse(direct.legs);
    if (!legs.success) continue;
    const path: [number, number][] = [];
    for (const leg of legs.data) {
      const points = decodePolyline(leg.legGeometry.points, leg.legGeometry.precision);
      if (points?.length !== leg.legGeometry.length) return { kind: 'streets-unavailable' };
      path.push(...points);
    }
    const metres = legs.data.reduce((sum, leg) => sum + leg.distance, 0);
    return { kind: 'walked', seconds: direct.duration, metres, path };
  }
  return { kind: 'no-street-route' };
}

/**
 * One walk asked of Transitous. Any failure (timeout, refused, an answer in another shape) is
 * `streets-unavailable`: the walk then stays estimated. Programming errors are thrown.
 */
export async function askWalk(
  http: HttpClient,
  ask: StreetWalkAsk,
  profile: WalkProfile,
  signal?: AbortSignal,
): Promise<StreetWalkAnswer> {
  try {
    const response = await http.get({
      url: walkUrl(ask, profile),
      headers: { accept: 'application/json' },
      ...LIMITS,
      signal,
    });
    return readWalk(response.body);
  } catch (error) {
    if (error instanceof HttpError) return { kind: 'streets-unavailable' };
    throw error;
  }
}
