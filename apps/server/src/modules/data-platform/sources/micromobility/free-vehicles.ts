import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { KnownFailure, ParseResult } from '../../definition.js';
import { decodeJson, describeIssue, olderThanServed, refuse } from '../city/parsing.js';
import { MINUTE, count } from '../mta/provider.js';

const KINDS = ['scooter', 'e-bike', 'bike'] as const;
export type VehicleKind = (typeof KINDS)[number];

/**
 * How a system names its vehicles. `stable`: one id per vehicle in every answer. `rotating`: new
 * ids in every answer (none in common between answers 13 and 22 minutes apart on 11/11/2026), so
 * a vehicle can be drawn where it stands but never followed from one answer to the next.
 */
type VehicleIds = 'stable' | 'rotating';

const envelopeSchema = z.object({
  last_updated: z.number().int().positive(),
  ttl: z.number().int().nonnegative(),
  data: z.object({ bikes: z.array(z.unknown()) }),
});

/** GBFS 2.x writes flags as booleans; some systems write 0 and 1. */
const flag = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((value) => value === true || value === 1);

const bikeRow = z.object({
  bike_id: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  is_reserved: flag,
  is_disabled: flag,
  vehicle_type_id: z.string().optional(),
  current_range_meters: z.number().nonnegative().optional(),
  current_fuel_percent: z.number().min(0).max(1).optional(),
  last_reported: z.number().int().positive().optional(),
});

const vehicleSchema = z.object({
  /** Parked where it was left, placed by its own GPS; vehicles on a rental are not listed. */
  located: z.literal('parked'),
  vehicleId: z.string().min(1),
  /** From the `vehicle_types` of the system; null for a type it did not list. */
  kind: z.enum(KINDS).nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  reserved: z.boolean(),
  disabled: z.boolean(),
  rangeMetres: z.number().nonnegative().nullable(),
  /** The battery left, from 0 to 1, where the system gives it. */
  battery: z.number().min(0).max(1).nullable(),
  /** When the vehicle last reported, where the system gives it. */
  reportedAt: instantSchema.nullable(),
});

export const freeVehiclesSchema = z.object({
  updatedAt: instantSchema,
  vehicleIds: z.enum(['stable', 'rotating']),
  vehicles: z.array(vehicleSchema),
  /** Rows without an id or a place, which cannot be shown. */
  leftOut: z.number().int().nonnegative(),
});

export type FreeVehicles = z.infer<typeof freeVehiclesSchema>;
type Vehicle = z.infer<typeof vehicleSchema>;

/** The way a system writes its feed, as read on 11/11/2026. */
export interface FleetDialect {
  readonly vehicleIds: VehicleIds;
  /** `vehicle_type_id` to kind, from the `vehicle_types` file of the system. */
  readonly kinds: ReadonlyMap<string, VehicleKind>;
}

/** Clocks may differ a little; a file dated further ahead than this has a wrong clock. */
const FUTURE_TOLERANCE_MS = 2 * MINUTE;

function vehicleOf(row: unknown, dialect: FleetDialect, updatedAt: number): Vehicle | undefined {
  const parsed = bikeRow.safeParse(row);
  if (!parsed.success) return undefined;
  const bike = parsed.data;
  const reported = bike.last_reported === undefined ? undefined : bike.last_reported * 1000;
  return {
    located: 'parked',
    vehicleId: bike.bike_id,
    kind: dialect.kinds.get(bike.vehicle_type_id ?? '') ?? null,
    latitude: bike.lat,
    longitude: bike.lon,
    reserved: bike.is_reserved,
    disabled: bike.is_disabled,
    rangeMetres: bike.current_range_meters ?? null,
    battery: bike.current_fuel_percent ?? null,
    reportedAt:
      reported === undefined || reported - updatedAt > FUTURE_TOLERANCE_MS
        ? null
        : toInstant(new Date(reported)),
  };
}

/** Reads a GBFS 2.x `free_bike_status` file into the parked vehicles of one system. */
export function parseFreeVehicles(
  body: Uint8Array,
  receivedAt: Date,
  dialect: FleetDialect,
): ParseResult<FreeVehicles> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const envelope = envelopeSchema.safeParse(decoded.value);
  if (!envelope.success) return refuse('unexpected-shape', describeIssue(envelope.error));
  const updatedAt = new Date(envelope.data.last_updated * 1000);
  if (updatedAt.getTime() - receivedAt.getTime() > FUTURE_TOLERANCE_MS) {
    return refuse('future-update', `last_updated ${toInstant(updatedAt)} is after receipt.`);
  }
  const rows = envelope.data.data.bikes;
  const vehicles = rows.flatMap((row) => vehicleOf(row, dialect, updatedAt.getTime()) ?? []);
  const leftOut = rows.length - vehicles.length;
  // A whole city fleet is never without a single parked vehicle: none means a broken export.
  if (vehicles.length === 0) {
    return refuse('no-vehicles', `${String(leftOut)} rows, none with an id and a place.`);
  }
  const ready = vehicles.filter((vehicle) => !vehicle.reserved && !vehicle.disabled).length;
  return {
    ok: true,
    data: { updatedAt: toInstant(updatedAt), vehicleIds: dialect.vehicleIds, vehicles, leftOut },
    dataTime: updatedAt,
    coverage: [
      count(vehicles.length, 'vehicles'),
      count(ready, 'ready to rent'),
      `${String(leftOut)} left out`,
    ].join(', '),
  };
}

/** Older than the data served, or under half of its vehicles: a stale cache or a cut file. */
export function checkFleet(data: FreeVehicles, previous: FreeVehicles | undefined): string[] {
  const reasons = [...olderThanServed(data.updatedAt, previous?.updatedAt)];
  const before = previous?.vehicles.length;
  if (before !== undefined && data.vehicles.length * 2 < before) {
    reasons.push(
      `coverage-drop: ${count(data.vehicles.length, 'vehicles')}, ${String(before)} before`,
    );
  }
  return reasons;
}

/** The failures of reading a file, after the HTTP ones of each system. */
export const FLEET_FAILURES: readonly KnownFailure[] = [
  {
    code: 'not-json',
    detection: 'The body is not JSON, such as an HTML error page of the CDN',
    state: 'degraded',
    remedy: 'Keep the last good vehicles with their age; the next run tries again',
  },
  {
    code: 'unexpected-shape',
    detection: 'No last_updated, ttl or data.bikes: the GBFS envelope changed',
    state: 'misconfigured',
    remedy: 'Compare with the capture and the GBFS reference, then update the reader',
  },
  {
    code: 'future-update',
    detection: 'last_updated is more than 2 minutes after the download',
    state: 'degraded',
    remedy: 'Refused until the provider clock is right again',
  },
  {
    code: 'no-vehicles',
    detection: 'No row with an id and a place: a broken or empty export',
    state: 'degraded',
    remedy: 'Refused; the last good vehicles are served with their age until it runs out',
  },
  {
    code: 'older-than-served',
    detection: 'last_updated is earlier than the one served, as from a stale cache',
    state: 'degraded',
    remedy: 'Keep the newer vehicles; the next run normally brings current ones',
  },
  {
    code: 'coverage-drop',
    detection: 'Fewer than half as many vehicles as the data served',
    state: 'degraded',
    remedy: 'Keep the fuller data while it is fresh; an operator looks at the feed',
  },
];
