import { toInstant, type CityItem, type ParkingSignsResponse } from '@moviq/contracts';
import { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { ParkingSignsReader } from '../data-platform/sources/street/parking-signs.js';

/** The dataset's credit, as the street sources credit NYC Open Data. */
const SOURCE = {
  title: 'NYC DOT parking regulation signs',
  attribution: 'Parking Regulation Locations and Signs, NYC DOT (NYC Open Data, nfid-uabd)',
} as const;

/** The five boroughs: a point outside them has no tile of the dataset. */
export const parkingPointSchema = z.object({
  lat: z.coerce.number().min(40.49).max(40.92),
  lon: z.coerce.number().min(-74.27).max(-73.68),
});

type ParkingPoint = z.infer<typeof parkingPointSchema>;

/**
 * The current signs of the tile of 1,000 feet around a point, asked of NYC Open Data at most once
 * a day per tile (`createParkingSignsReader`). Each sign keeps its text: whether parking is
 * allowed now is never worked out from it.
 */
export async function parkingSignsNear(
  signs: ParkingSignsReader,
  clock: Clock,
  point: ParkingPoint,
): Promise<ParkingSignsResponse> {
  const outcome = await signs.near(point);
  const generatedAt = toInstant(clock.now());
  if (!outcome.ok) {
    return {
      generatedAt,
      items: [],
      source: { ...SOURCE, state: outcome.state, evidence: outcome.detail },
    };
  }
  const items = outcome.value.signs.map((sign, index): CityItem => ({
    id: `parking-signs:${sign.order}:${sign.code}:${String(index)}`,
    layer: 'parking-signs',
    sourceId: signs.sourceId,
    title: sign.street ?? sign.code,
    point: [sign.point.lon, sign.point.lat],
    lines: [],
    detail: {
      kind: 'parking-sign',
      code: sign.code,
      text: sign.text,
      street: sign.street,
      side: sign.side,
      arrow: sign.arrow,
      since: sign.since,
    },
  }));
  return {
    generatedAt,
    items,
    source: { ...SOURCE, state: 'healthy', evidence: outcome.provenance.evidence },
  };
}
