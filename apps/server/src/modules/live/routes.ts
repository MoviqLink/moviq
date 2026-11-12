import {
  boundingBoxSchema,
  liveInterestRequestSchema,
  liveLineKeySchema,
  liveModeSchema,
  toInstant,
  type BoundingBox,
  type LiveMode,
  type LiveInterestResponse,
  type LiveVehiclesResponse,
  type LiveVehicleRoute,
} from '@moviq/contracts';
import { Hono } from 'hono';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { AppBindings } from '../../infrastructure/http/context.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import { z } from 'zod';

import { lineKey } from './line-directory.js';
import { interestStore } from '../data-platform/interests.js';
import {
  createLiveCity,
  type CitySnapshot,
  type LiveCity,
  type LiveCityDependencies,
} from './city.js';

/**
 * The routes read either a city of their own, built from the platform's reader, or the city the
 * process keeps warm (`keepCityWarm`), so the estimator learns while nobody looks.
 */
export type LiveRoutesDependencies = {
  readonly db: Database;
  readonly clock: Clock;
} & (LiveCityDependencies | { readonly city: LiveCity });

/** An open Explore keeps its interest alive by asking again within this time. */
const INTEREST_TTL_MS = 2 * 60_000;

/** `west,south,east,north`, or undefined when the parameter is absent; null when it is wrong. */
function boxOf(value: string | undefined): BoundingBox | null | undefined {
  if (value === undefined) return undefined;
  const parsed = boundingBoxSchema.safeParse(value.split(',').map(Number));
  return parsed.success ? parsed.data : null;
}

/** The modes asked for, `bus,subway`; every mode when absent, null when one is unknown. */
function modesOf(value: string | undefined): ReadonlySet<LiveMode> | null | undefined {
  if (value === undefined) return undefined;
  const parsed = liveModeSchema.array().safeParse(value === '' ? [] : value.split(','));
  return parsed.success ? new Set(parsed.data) : null;
}

function linesOf(value: string | undefined): ReadonlySet<string> | null | undefined {
  if (value === undefined) return undefined;
  if (value.length > 100_000) return null;
  try {
    const parsed = z
      .array(liveLineKeySchema)
      .max(2000)
      .safeParse(JSON.parse(value) as unknown);
    return parsed.success ? new Set(parsed.data.map(lineKey)) : null;
  } catch {
    return null;
  }
}

/** What one screen asked for: the box in view and the modes it shows. */
interface View {
  readonly box: BoundingBox | undefined;
  readonly modes: ReadonlySet<LiveMode> | undefined;
  readonly lines: ReadonlySet<string> | undefined;
}

const shows = (view: View, mode: LiveMode, lat: number, lon: number) =>
  (view.modes === undefined || view.modes.has(mode)) &&
  (view.box === undefined ||
    (lon >= view.box[0] && lat >= view.box[1] && lon <= view.box[2] && lat <= view.box[3]));

const LINE_MODES = new Set<LiveMode>(['bus', 'subway', 'rail', 'ferry', 'shuttle']);

function within(snapshot: CitySnapshot, view: View): LiveVehiclesResponse {
  return {
    generatedAt: snapshot.generatedAt,
    bbox: view.box ?? null,
    modes: [...snapshot.modes],
    vehicles: snapshot.vehicles.filter(
      (vehicle) =>
        shows(view, vehicle.mode, vehicle.position.lat, vehicle.position.lon) &&
        (view.lines === undefined ||
          (LINE_MODES.has(vehicle.mode)
            ? vehicle.line !== null &&
              view.lines.has(
                lineKey({
                  mode: vehicle.mode,
                  sourceId: vehicle.sourceId,
                  lineId: vehicle.line.id,
                }),
              )
            : view.modes?.has(vehicle.mode) === true)),
    ),
    stations: snapshot.stations.filter(
      (station) =>
        shows(view, station.mode, station.lat, station.lon) &&
        (view.lines === undefined || view.modes?.has(station.mode) === true),
    ),
    sources: [...snapshot.sources],
  };
}

/**
 * `/api/live`: every vehicle of the city that can be followed, with the state of each mode and
 * of each source, and the interest that keeps those sources hot while someone looks.
 */
export function liveRoutes(deps: LiveRoutesDependencies): Hono<AppBindings> {
  const city = 'city' in deps ? deps.city : createLiveCity(deps);
  const { feeds } = city;
  const routes = new Hono<AppBindings>();

  routes.get('/vehicles', async (c) => {
    const box = boxOf(c.req.query('bbox'));
    if (box === null) {
      return c.json(
        errorBody(c, 'bad_request', 'bbox must be west,south,east,north in degrees.'),
        400,
      );
    }
    const modes = modesOf(c.req.query('modes'));
    if (modes === null) {
      return c.json(errorBody(c, 'bad_request', 'modes must name modes of Explore.'), 400);
    }
    const lines = linesOf(c.req.query('lines'));
    if (lines === null)
      return c.json(
        errorBody(c, 'bad_request', 'lines must be a JSON array of line identities.'),
        400,
      );
    return c.json(within(await city.snapshot(), { box, modes, lines }));
  });

  routes.get('/lines', async (c) => c.json(await city.lines()));

  routes.get('/route', async (c) => {
    const id = c.req.query('vehicle');
    const vehicle = (await city.snapshot()).vehicles.find((item) => item.id === id);
    const result: LiveVehicleRoute =
      vehicle === undefined ? { coordinates: null } : await city.routeDetails(vehicle);
    return c.json(result);
  });

  routes.post('/interest', async (c) => {
    const body = liveInterestRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) {
      return c.json(errorBody(c, 'bad_request', 'Name the modes on screen.'), 400);
    }
    const modes = new Set(body.data.modes);
    const sourceIds = [
      ...new Set(
        feeds.filter((feed) => modes.has(feed.mode)).flatMap((feed) => feed.interestSourceIds),
      ),
    ];
    const now = deps.clock.now();
    await interestStore.register(
      deps.db,
      { kind: 'screen', ref: 'explore', sourceIds, ttlMs: INTEREST_TTL_MS },
      now,
    );
    const answer: LiveInterestResponse = {
      sourceIds,
      expiresAt: toInstant(new Date(now.getTime() + INTEREST_TTL_MS)),
    };
    return c.json(answer);
  });

  return routes;
}
