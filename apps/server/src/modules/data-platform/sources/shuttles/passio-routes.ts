import { z } from 'zod';

import type { SourceDefinition } from '../../definition.js';
import { decodeJson, refuse } from '../city/parsing.js';
import { encodePolyline } from '../mta/polyline.js';
import { DAY } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';

const systems = { s0: '1007', s1: '7073', s2: '1569', s3: '5082', s4: '466', sA: 5 };
const numeric = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);
const point = z.object({
  lat: numeric.pipe(z.number().min(-90).max(90)),
  lng: numeric.pipe(z.number().min(-180).max(180)),
});
const response = z.object({
  routePoints: z.record(z.string(), z.unknown()),
  routes: z.record(z.string(), z.unknown()),
});
const routeShapes = z.record(
  z.string(),
  z.union([z.string(), z.object({ name: z.string().min(1), shape: z.string() })]),
);

/** Public route contours, keeping a single continuous published segment only. */
export const passioRouteSource: SourceDefinition<z.infer<typeof routeShapes>> = {
  id: 'passio-go-route-shapes',
  title: 'University and district shuttle routes (Passio GO)',
  provider: 'Passio GO public map (Passio Technologies)',
  licence: {
    name: 'No published terms (Passio GO public map)',
    url: 'https://passiogo.com/',
    attribution: 'Shuttle route shapes from Passio GO',
  },
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 2 * DAY, staleAfterMs: 7 * DAY, unavailableAfterMs: 30 * DAY },
  dataTimeSource: 'receipt',
  limits: { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 },
  keepVersions: 3,
  dataSchema: routeShapes,
  needsFullRefresh: (previous) =>
    Object.values(previous).some((route) => typeof route === 'string'),
  request: () => ({
    url:
      'https://passiogo.com/mapGetData.php?getStops=2&withOutdated=1&wBounds=1&json=' +
      encodeURIComponent(JSON.stringify(systems)),
  }),
  parse(body, context) {
    const decoded = decodeJson(body);
    if (!decoded.ok) return decoded;
    const answer = response.safeParse(decoded.value);
    if (!answer.success) return refuse('unexpected-shape', 'Route shapes are missing.');
    const shapes: Record<string, { name: string; shape: string }> = {};
    for (const [id, raw] of Object.entries(answer.data.routePoints)) {
      const route = z
        .tuple([z.string().trim().min(1), z.unknown(), z.unknown()])
        .rest(z.unknown())
        .safeParse(answer.data.routes[id]);
      if (!route.success || route.data[2] === 1 || route.data[2] === '1') continue;
      const segments = z.array(z.array(point).min(2).max(100_000)).length(1).safeParse(raw);
      if (!segments.success) continue;
      const points = segments.data[0];
      if (points === undefined || points.some((p) => p.lat === 0 || p.lng === 0)) continue;
      shapes[id] = {
        name: route.data[0],
        shape: encodePolyline(points.map((p) => ({ lat: p.lat, lon: p.lng }))),
      };
    }
    if (Object.keys(shapes).length === 0)
      return refuse('unexpected-shape', 'No usable route shapes.');
    return {
      ok: true,
      data: shapes,
      dataTime: context.receivedAt,
      coverage: `${String(Object.keys(shapes).length)} route shapes`,
    };
  },
  consumers: ['live-map'],
  failures: [
    ...httpFailures('passiogo.com', 'https://passiogo.com/'),
    {
      code: 'unexpected-shape',
      detection: 'No usable route shapes in the public map response',
      state: 'degraded',
      remedy: 'Keep the last good shapes and inspect the source',
    },
  ],
};
