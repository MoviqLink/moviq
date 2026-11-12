import { randomUUID } from 'node:crypto';
import { liveSourceSchema, liveVehicleSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { VirtualBusReading } from '../live/virtual-bus.js';

const stop = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  arrival: z.string().nullable(),
  departure: z.string().nullable(),
});
const snapshotSchema = z.object({
  vehicle: liveVehicleSchema,
  sources: z.array(liveSourceSchema),
  stops: z.array(stop).max(8),
});
const rowSchema = z.object({
  id: z.string(),
  traveller_id: z.string(),
  vehicle_id: z.string(),
  trip_id: z.string(),
  state: z.enum(['following', 'lost', 'ended']),
  snapshot: z.string(),
  updated_at: z.string(),
  journey_id: z.string().nullable(),
});
export type RideRow = z.infer<typeof rowSchema>;
export const parseSnapshot = (row: RideRow) => snapshotSchema.parse(JSON.parse(row.snapshot));

export async function findRide(
  db: Database,
  owner: string,
  id: string,
): Promise<RideRow | undefined> {
  const result = await db.query({
    sql: 'SELECT * FROM virtual_rides WHERE id = ? AND traveller_id = ?',
    args: [id, owner],
  });
  return result.rows[0] === undefined
    ? undefined
    : parseRow(rowSchema, result.rows[0], 'virtual_rides');
}
export async function currentRide(db: Database, owner: string): Promise<RideRow | undefined> {
  const result = await db.query({
    sql: "SELECT * FROM virtual_rides WHERE traveller_id = ? AND state != 'ended'",
    args: [owner],
  });
  return result.rows[0] === undefined
    ? undefined
    : parseRow(rowSchema, result.rows[0], 'virtual_rides');
}
export async function createRide(
  db: Database,
  owner: string,
  reading: VirtualBusReading,
  now: Date,
): Promise<string | null> {
  const id = randomUUID();
  const snapshot = snapshotSchema.parse({
    vehicle: reading.vehicle,
    sources: reading.sources,
    stops: reading.stops.slice(0, 8),
  });
  const result = await db.execute({
    sql: `INSERT INTO virtual_rides
    (id, traveller_id, vehicle_id, trip_id, state, snapshot, updated_at, created_at)
    SELECT ?, ?, ?, ?, 'following', ?, ?, ? WHERE NOT EXISTS
    (SELECT 1 FROM virtual_rides WHERE traveller_id = ? AND state != 'ended')`,
    args: [
      id,
      owner,
      reading.vehicle.id,
      reading.tripId,
      JSON.stringify(snapshot),
      toInstant(now),
      toInstant(now),
      owner,
    ],
  });
  return result.rowsAffected === 1 ? id : null;
}
export async function refreshRide(
  db: Database,
  row: RideRow,
  reading: VirtualBusReading | null,
  now: Date,
): Promise<RideRow | undefined> {
  if (row.state === 'ended') return row;
  if (
    reading !== null &&
    Date.parse(reading.vehicle.position.dataTime) <
      Date.parse(parseSnapshot(row).vehicle.position.dataTime)
  )
    return findRide(db, row.traveller_id, row.id);
  if (reading !== null && reading.tripId !== row.trip_id) {
    await db.execute({
      sql: `UPDATE virtual_rides SET state = 'ended'
      WHERE id = ? AND traveller_id = ? AND state != 'ended' AND updated_at = ?`,
      args: [row.id, row.traveller_id, row.updated_at],
    });
    return findRide(db, row.traveller_id, row.id);
  }
  const snapshot =
    reading === null
      ? row.snapshot
      : JSON.stringify(
          snapshotSchema.parse({
            vehicle: reading.vehicle,
            sources: reading.sources,
            stops: reading.stops.slice(0, 8),
          }),
        );
  await db.execute({
    sql: `UPDATE virtual_rides SET state = ?, snapshot = ?, updated_at = ?
    WHERE id = ? AND traveller_id = ? AND state != 'ended' AND updated_at = ?`,
    args: [
      reading === null ? 'lost' : 'following',
      snapshot,
      reading === null ? row.updated_at : toInstant(now),
      row.id,
      row.traveller_id,
      row.updated_at,
    ],
  });
  return findRide(db, row.traveller_id, row.id);
}
