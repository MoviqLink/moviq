import {
  CAMERA_IMAGE_HEADERS,
  boundingBoxSchema,
  cityLayerIdSchema,
  type BoundingBox,
  type CityLayerId,
} from '@moviq/contracts';
import { Hono } from 'hono';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { HttpClient } from '../../infrastructure/http/client.js';
import type { AppBindings } from '../../infrastructure/http/context.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import type { SourceReader } from '../data-platform/reader.js';
import { createParkingSignsReader } from '../data-platform/sources/street/parking-signs.js';
import { createCameraImages } from './camera-images.js';
import { createCityCatalog, type CityCatalogDependencies } from './catalog.js';
import { parkingPointSchema, parkingSignsNear } from './parking-signs.js';
import { pointsOf, restroomsNear } from './restrooms-near.js';

interface CityLayerRoutesDependencies extends CityCatalogDependencies {
  readonly reader: SourceReader;
  readonly clock: Clock;
  /** For the camera pictures and the parking signs, with the generic browser identity. */
  readonly http: HttpClient;
}

/** `west,south,east,north`, or undefined when the parameter is absent; null when it is wrong. */
function boxOf(value: string | undefined): BoundingBox | null | undefined {
  if (value === undefined) return undefined;
  const parsed = boundingBoxSchema.safeParse(value.split(',').map(Number));
  return parsed.success ? parsed.data : null;
}

/** The layers asked for, `cameras,incidents`; none when absent, null when one is unknown. */
function layersOf(value: string | undefined): ReadonlySet<CityLayerId> | null {
  if (value === undefined || value === '') return new Set();
  const parsed = cityLayerIdSchema.array().safeParse(value.split(','));
  return parsed.success ? new Set(parsed.data) : null;
}

/** A camera's id in 511NY's list: digits only, so no address can ever be passed for one. */
const CAMERA_ID = /^\d{1,12}$/;

/**
 * `/api/city`: the city layers of Explore, a camera's still picture asked through MovIQ, the
 * parking signs of the tile around a point and the public restrooms near a few points.
 */
export function cityLayerRoutes(deps: CityLayerRoutesDependencies): Hono<AppBindings> {
  const catalog = createCityCatalog(deps);
  const pictures = createCameraImages(deps);
  const signs = createParkingSignsReader({ http: deps.http, clock: deps.clock });
  const routes = new Hono<AppBindings>();

  routes.get('/layers', async (c) => {
    const box = boxOf(c.req.query('bbox'));
    if (box === null) {
      return c.json(
        errorBody(c, 'bad_request', 'bbox must be west,south,east,north in degrees.'),
        400,
      );
    }
    const layers = layersOf(c.req.query('layers'));
    if (layers === null) {
      return c.json(errorBody(c, 'bad_request', 'layers must name city layers of Explore.'), 400);
    }
    return c.json(await catalog.list({ box, layers }));
  });

  routes.get('/cameras/:id/image', async (c) => {
    const id = c.req.param('id');
    if (!CAMERA_ID.test(id)) {
      return c.json(errorBody(c, 'not_found', 'No camera of the list has this id.'), 404);
    }
    const picture = await pictures.picture(id);
    if (!picture.ok) {
      return picture.status === 404
        ? c.json(errorBody(c, 'not_found', picture.message), 404)
        : c.json(picture.failure, 503);
    }
    const seconds = Math.max(
      0,
      Math.floor((picture.freshUntil - deps.clock.now().getTime()) / 1000),
    );
    return c.body(new Uint8Array(picture.bytes), 200, {
      'content-type': picture.type,
      'cache-control': `private, max-age=${String(seconds)}`,
      'x-content-type-options': 'nosniff',
      [CAMERA_IMAGE_HEADERS.time]: picture.time,
      [CAMERA_IMAGE_HEADERS.basis]: picture.basis,
    });
  });

  routes.get('/parking-signs', async (c) => {
    const point = parkingPointSchema.safeParse({
      lat: c.req.query('lat'),
      lon: c.req.query('lon'),
    });
    if (!point.success) {
      return c.json(errorBody(c, 'bad_request', 'lat and lon must be a point in the city.'), 400);
    }
    return c.json(await parkingSignsNear(signs, deps.clock, point.data));
  });

  routes.get('/restrooms', async (c) => {
    const points = pointsOf(c.req.query('near'));
    if (points === null) {
      return c.json(
        errorBody(c, 'bad_request', 'near must be one to four lat,lon points in the city.'),
        400,
      );
    }
    const stepFree = c.req.query('stepFree') === '1';
    return c.json(await restroomsNear(deps.reader, points, stepFree, deps.clock.now()));
  });

  return routes;
}
